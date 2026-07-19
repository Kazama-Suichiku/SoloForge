/**
 * 桌面版云同步服务
 * 实现与 Cloudflare Workers 的双向增量同步
 * 支持自动同步：启动时、发送消息后、定期轮询
 */

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { accountStore } = require('../account/account-store');

// 使用 Node 内置 crypto.randomUUID()，避免引入 uuid 依赖（uuid 未在 package.json 中）
const uuidv4 = () => crypto.randomUUID();

const DEFAULT_SYNC_URL = 'https://soloforge-sync.fengzhongcuizhu.workers.dev';
const SYNC_INTERVAL = 30000; // 30秒轮询一次
const MIN_SYNC_INTERVAL = 5000; // 最小同步间隔5秒

class CloudSyncService {
  constructor() {
    this.syncUrl = DEFAULT_SYNC_URL;
    this.userId = null;
    this.deviceId = null;
    this.lastSyncAt = {};
    this.configPath = path.join(app.getPath('userData'), 'cloud-sync-config.json');
    this.dataPath = null;
    
    this.syncing = false;
    this.lastSyncTime = 0;
    this.syncTimer = null;
    this.listeners = new Set();

    // P0-10：本地软删除墓碑
    // seen  = 上次 collectLocalChanges 时观察到的 id 集合（用于下一次 reconcile）
    // deleted = 已捕获但尚未成功 push 的删除事件 { id, deletedAt }
    // 设计：cloud-history-store 的 deleteConversation 是物理删除（Map.delete），
    // 而 deleteMessages 是软删除（标记 deleted:true）。为避免改动渲染器/store
    // 架构（Phase 0 约束），通过 reconcile 自动捕获物理删除：每次 collectLocalChanges
    // 对比 seen vs current，缺失的 id 记为 tombstone，随 push 上送 deletedIds。
    // 消息走 deleted:true 标志路径（collectLocalChanges 中透传 msg.deleted）。
    this.tombstonesPath = path.join(app.getPath('userData'), 'cloud-sync-tombstones.json');
    this.tombstones = {
      seen: { conversations: [], messages: [], agents: [] },
      deleted: { conversations: [], messages: [], agents: [] },
    };

    // P2-5：push dirty 标记
    // 问题：原 push 每次 collectLocalChanges 全量遍历本地文件并把所有对象上送，
    //   对 agents / bossConfig 尤其浪费（它们 updatedAt=Date.now() 每次都"新"）。
    // 方案：维护一份"上次成功 push 后的对象签名快照"，collectLocalChanges 时只返回
    //   签名变化的 dirty 对象；push 成功后更新快照（等价于清空 dirtyIds）。
    // - 签名 = SHA256(同步相关字段的规范 JSON).slice(0,16)，只比较会被 push 的字段。
    // - 快照持久化到 cloud-sync-dirty-snapshot.json，保证重启后 dirty 状态不丢。
    // - 首次同步（无快照）→ 全部 dirty，等价于旧行为，确保不丢数据。
    // - push 失败不更新快照 → dirty 对象下次重传。
    // - 删除仍由 tombstones 机制（deletedIds）独立处理，不受 dirty 过滤影响。
    // 注意：collectLocalChanges 内部仍全量遍历（reconcile tombstones 需要完整 seen），
    //   只是在返回前用 dirty 过滤 data；不改本地存储格式，纯 cloud-sync.js 内部维护。
    this.dirtySnapshotPath = path.join(app.getPath('userData'), 'cloud-sync-dirty-snapshot.json');
    this.dirtySnapshot = {
      conversations: {},  // id -> signature
      messages: {},       // id -> signature
      agents: {},         // id -> signature
      boss: null,         // single signature (boss is singleton per user)
    };
    // P2-5：待提交的 dirty 快照（collectLocalChanges 后暂存，push 成功后提交）
    this._pendingDirtySnapshot = null;
  }

  /**
   * 初始化同步服务
   */
  async initialize(dataPath) {
    this.dataPath = dataPath;
    this.loadConfig();
    this.loadTombstones();
    this.loadDirtySnapshot();

    if (!this.deviceId) {
      this.deviceId = `desktop-${uuidv4().substring(0, 8)}`;
      this.saveConfig();
    }

    // 如果配置中已有用户ID，启动自动同步
    if (this.userId) {

      // 启动自动同步
      this.startAutoSync();
    }
  }

  /**
   * P0-10：加载本地软删除墓碑
   */
  loadTombstones() {
    try {
      if (fs.existsSync(this.tombstonesPath)) {
        const raw = JSON.parse(fs.readFileSync(this.tombstonesPath, 'utf-8'));
        if (raw && typeof raw === 'object') {
          this.tombstones = {
            seen: {
              conversations: Array.isArray(raw.seen?.conversations) ? raw.seen.conversations : [],
              messages: Array.isArray(raw.seen?.messages) ? raw.seen.messages : [],
              agents: Array.isArray(raw.seen?.agents) ? raw.seen.agents : [],
            },
            deleted: {
              conversations: Array.isArray(raw.deleted?.conversations) ? raw.deleted.conversations : [],
              messages: Array.isArray(raw.deleted?.messages) ? raw.deleted.messages : [],
              agents: Array.isArray(raw.deleted?.agents) ? raw.deleted.agents : [],
            },
          };
        }
      }
    } catch (error) {
      console.error('[CloudSync] 加载墓碑失败:', error);
    }
  }

  /**
   * P0-10：保存本地软删除墓碑
   */
  saveTombstones() {
    try {
      fs.writeFileSync(this.tombstonesPath, JSON.stringify(this.tombstones, null, 2));
    } catch (error) {
      console.error('[CloudSync] 保存墓碑失败:', error);
    }
  }

  /**
   * P2-5：加载 dirty 快照（上次成功 push 后的对象签名）
   */
  loadDirtySnapshot() {
    try {
      if (fs.existsSync(this.dirtySnapshotPath)) {
        const raw = JSON.parse(fs.readFileSync(this.dirtySnapshotPath, 'utf-8'));
        if (raw && typeof raw === 'object') {
          this.dirtySnapshot = {
            conversations: (raw.conversations && typeof raw.conversations === 'object') ? raw.conversations : {},
            messages: (raw.messages && typeof raw.messages === 'object') ? raw.messages : {},
            agents: (raw.agents && typeof raw.agents === 'object') ? raw.agents : {},
            boss: raw.boss || null,
          };
        }
      }
    } catch (error) {
      console.error('[CloudSync] 加载 dirty 快照失败:', error);
    }
  }

  /**
   * P2-5：保存 dirty 快照
   */
  saveDirtySnapshot() {
    try {
      fs.writeFileSync(this.dirtySnapshotPath, JSON.stringify(this.dirtySnapshot, null, 2));
    } catch (error) {
      console.error('[CloudSync] 保存 dirty 快照失败:', error);
    }
  }

  /**
   * P2-5：计算对象签名（同步相关字段的规范哈希）
   * 只取会被 push 的字段，避免本地时间戳/自增序号等噪声触发误 dirty。
   * 返回 16 字符 hex 摘要；输入为 null/undefined 时返回 null。
   */
  _signature(obj) {
    if (!obj) return null;
    // 规范化：按 key 排序的 JSON，排除 updatedAt（每次 collect 都=Date.now()）
    const stable = {};
    for (const key of Object.keys(obj).sort()) {
      if (key === 'updatedAt') continue; // updatedAt 由服务端覆盖，不参与 dirty 判定
      const v = obj[key];
      if (v === undefined || v === null) continue;
      // departments 等数组需稳定序列化
      stable[key] = Array.isArray(v) ? JSON.stringify(v) : v;
    }
    return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 16);
  }

  /**
   * P2-5：判断对象是否 dirty（签名与快照不同）
   * 首次同步（快照为空对象）→ 全部 dirty，等价于旧行为。
   */
  _isDirty(type, id, obj) {
    const sig = this._signature(obj);
    const snap = this.dirtySnapshot[type];
    if (snap === null || snap === undefined) return true; // boss 首次
    if (typeof snap !== 'object') return true;
    // 对象消失（被删除）由 tombstone 处理；这里只判定存在的对象
    const prev = snap[id];
    if (prev === undefined) return true; // 快照中无此 id → 新对象 → dirty
    return prev !== sig;
  }

  /**
   * 启动自动同步
   */
  startAutoSync() {
    if (!this.userId) {
      console.log('[CloudSync] 未登录，跳过自动同步');
      return;
    }

    // P0-12：token 缺失或过期时，不启动轮询（避免 30 秒持续 401）
    // 旧云端账号无 token / token 过期都会在这里被拦下，等待用户重新登录。
    if (accountStore.needsReauth(this.userId)) {
      console.warn('[CloudSync] 账号需要重新登录（token 缺失或过期），跳过自动同步');
      this.notifyListeners({
        type: 'reauth-required',
        success: false,
        error: '登录已过期，请重新登录以恢复云同步',
        userId: this.userId,
      });
      return;
    }

    // 立即同步一次
    this.syncSilent();

    // 定期同步
    if (!this.syncTimer) {
      this.syncTimer = setInterval(() => {
        this.syncSilent();
      }, SYNC_INTERVAL);
      console.log('[CloudSync] 自动同步已启动，间隔', SYNC_INTERVAL / 1000, '秒');
    }
  }

  /**
   * 停止自动同步
   */
  stopAutoSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    console.log('[CloudSync] 自动同步已停止');
  }

  /**
   * 添加同步监听器
   */
  addListener(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 通知所有监听器
   */
  notifyListeners(result) {
    this.listeners.forEach(listener => {
      try {
        listener(result);
      } catch (e) {
        console.error('[CloudSync] 监听器错误:', e);
      }
    });
  }

  /**
   * 配置同步服务
   */
  configure(options) {
    if (options.syncUrl) this.syncUrl = options.syncUrl;
    if (options.userId) this.userId = options.userId;
    this.saveConfig();

    // 配置后启动自动同步
    if (this.userId) {
      this.startAutoSync();
    }
  }

  /**
   * 获取配置
   */
  getConfig() {
    return {
      syncUrl: this.syncUrl,
      userId: this.userId,
      deviceId: this.deviceId,
      lastSyncAt: this.lastSyncAt,
      isConfigured: !!this.userId,
    };
  }

  /**
   * 加载配置
   */
  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        this.syncUrl = config.syncUrl || DEFAULT_SYNC_URL;
        this.userId = config.userId || null;
        this.deviceId = config.deviceId || null;
        this.lastSyncAt = config.lastSyncAt || {};
      }
    } catch (error) {
      console.error('加载云同步配置失败:', error);
    }
  }

  /**
   * 保存配置
   */
  saveConfig() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify({
        syncUrl: this.syncUrl,
        userId: this.userId,
        deviceId: this.deviceId,
        lastSyncAt: this.lastSyncAt,
      }, null, 2));
    } catch (error) {
      console.error('保存云同步配置失败:', error);
    }
  }

  /**
   * 静默同步（不抛出错误，用于自动同步）
   */
  async syncSilent() {
    try {
      return await this.sync();
    } catch (error) {
      console.error('[CloudSync] 静默同步失败:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * 快速同步消息（发送消息后调用）
   */
  async syncMessages() {
    const now = Date.now();
    if (now - this.lastSyncTime < MIN_SYNC_INTERVAL) {
      return;
    }
    await this.syncSilent();
  }

  /**
   * 执行完整同步（先拉后推）
   */
  async sync() {
    if (!this.syncUrl || !this.userId) {
      return { success: false, error: '云同步未配置' };
    }

    // 防止并发同步
    if (this.syncing) {
      console.log('[CloudSync] 同步进行中，跳过');
      return { success: false, error: '同步进行中' };
    }

    // 防止频繁同步
    const now = Date.now();
    if (now - this.lastSyncTime < MIN_SYNC_INTERVAL) {
      return { success: true };
    }

    this.syncing = true;
    this.lastSyncTime = now;

    try {
      console.log('[CloudSync] 开始同步...');

      // 1. 先拉取远程变更
      const pullResult = await this.pull();

      // P0-12：pull 因 token 问题被跳过时，不再继续 push，直接返回跳过结果
      // （_handle401 已停止自动同步并通知监听器，这里不重复通知）
      if (pullResult && pullResult.skipped) {
        console.warn('[CloudSync] 同步被跳过:', pullResult.reason);
        const result = {
          success: false,
          skipped: true,
          reason: pullResult.reason,
          pulled: pullResult,
        };
        // 401/403 场景 _handle401 已通知；no-token 场景通知一次
        if (pullResult.reason === 'no-token') {
          this.notifyListeners({
            type: 'reauth-required',
            success: false,
            error: '未登录或登录已过期，请重新登录以恢复云同步',
            userId: this.userId,
          });
        }
        return result;
      }

      // 2. 再推送本地变更
      const pushResult = await this.push();

      // P0-12：push 被跳过时同样直接返回
      if (pushResult && pushResult.skipped) {
        console.warn('[CloudSync] push 被跳过:', pushResult.reason);
        // P2-5：no-changes 是正常情况（无 dirty 数据），视为同步成功而非失败
        if (pushResult.reason === 'no-changes') {
          const result = {
            success: true,
            pulled: pullResult,
            pushed: pushResult,
          };
          this.notifyListeners(result);
          return result;
        }
        const result = {
          success: false,
          skipped: true,
          reason: pushResult.reason,
          pulled: pullResult,
          pushed: pushResult,
        };
        if (pushResult.reason === 'no-token') {
          this.notifyListeners({
            type: 'reauth-required',
            success: false,
            error: '未登录或登录已过期，请重新登录以恢复云同步',
            userId: this.userId,
          });
        }
        return result;
      }

      console.log('[CloudSync] 同步完成:', { pulled: pullResult, pushed: pushResult });

      const result = {
        success: true,
        pulled: pullResult,
        pushed: pushResult,
      };

      this.notifyListeners(result);
      return result;
    } catch (error) {
      console.error('[CloudSync] 同步失败:', error);
      const result = { success: false, error: String(error) };
      this.notifyListeners(result);
      return result;
    } finally {
      this.syncing = false;
    }
  }

  /**
   * 拉取远程变更
   */
  async pull() {
    const since = Math.min(
      this.lastSyncAt.messages || 0,
      this.lastSyncAt.conversations || 0,
      this.lastSyncAt.agents || 0,
      this.lastSyncAt.boss || 0
    );

    // P0-12：带 token 鉴权
    const headers = await this._getAuthHeaders();
    if (!headers) {
      // token 缺失或过期，跳过本次同步（不抛错，避免 30 秒轮询持续报错）
      console.warn('[CloudSync] pull: token 缺失或已过期，跳过同步');
      return { skipped: true, reason: 'no-token' };
    }

    const response = await fetch(`${this.syncUrl}/sync/pull`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        userId: this.userId,
        deviceId: this.deviceId,
        since,
      }),
    });

    // P0-12：处理 401（token 无效/过期）
    if (response.status === 401) {
      await this._handle401();
      return { skipped: true, reason: 'unauthorized' };
    }
    if (response.status === 403) {
      // token userId 与请求 userId 不一致，通常是本地数据错乱
      console.error('[CloudSync] pull 403: token userId 与请求 userId 不一致');
      await this._handle401();
      return { skipped: true, reason: 'forbidden' };
    }

    if (!response.ok) {
      throw new Error(`拉取失败: ${response.status}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || '拉取失败');
    }

    // 合并远程数据到本地
    const merged = await this.mergeRemoteData(result.data);
    
    // 更新同步时间
    this.lastSyncAt = {
      messages: result.serverTime,
      conversations: result.serverTime,
      agents: result.serverTime,
      boss: result.serverTime,
    };
    this.saveConfig();

    return merged;
  }

  /**
   * 推送本地变更
   */
  async push() {
    const data = await this.collectLocalChanges();

    // P0-10：从墓碑中提取待推送的已删除 id 列表（删除信号）
    const deletedIds = {
      conversations: this.tombstones.deleted.conversations.map(t => t.id),
      messages: this.tombstones.deleted.messages.map(t => t.id),
      agents: this.tombstones.deleted.agents.map(t => t.id),
    };

    // P2-5：若既无 dirty 数据也无待推送删除，跳过本次 push（减少空请求）
    const hasDirtyData =
      (data.conversations?.length || 0) > 0 ||
      (data.messages?.length || 0) > 0 ||
      (data.agents?.length || 0) > 0 ||
      data.bossConfig != null;
    const hasDeletedIds =
      (deletedIds.conversations?.length || 0) > 0 ||
      (deletedIds.messages?.length || 0) > 0 ||
      (deletedIds.agents?.length || 0) > 0;
    if (!hasDirtyData && !hasDeletedIds) {
      // 仍需提交 dirty 快照（把"全部干净"的状态落盘，避免下次重复计算）
      this._commitDirtySnapshot();
      return { conversations: 0, messages: 0, agents: 0, boss: 0, skipped: true, reason: 'no-changes' };
    }

    // P0-12：带 token 鉴权
    const headers = await this._getAuthHeaders();
    if (!headers) {
      console.warn('[CloudSync] push: token 缺失或已过期，跳过同步');
      return { skipped: true, reason: 'no-token' };
    }

    const response = await fetch(`${this.syncUrl}/sync/push`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        userId: this.userId,
        deviceId: this.deviceId,
        deviceType: 'desktop',
        data,
        // P0-10：删除信号独立字段，服务端对这些 id 执行软删除
        deletedIds,
      }),
    });

    // P0-12：处理 401/403
    if (response.status === 401) {
      await this._handle401();
      return { skipped: true, reason: 'unauthorized' };
    }
    if (response.status === 403) {
      console.error('[CloudSync] push 403: token userId 与请求 userId 不一致');
      await this._handle401();
      return { skipped: true, reason: 'forbidden' };
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`推送失败: ${response.status} - ${text}`);
    }

    const result = await response.json();
    if (!result.success && result.errors?.length) {
      console.warn('[CloudSync] 部分数据推送失败:', result.errors);
    }

    // P0-10：push 成功后清空已推送的墓碑删除事件（保留 seen）
    // P2-5：push 成功后提交 dirty 快照（等价于清空 dirtyIds）
    if (result.success) {
      this.tombstones.deleted = { conversations: [], messages: [], agents: [] };
      this.saveTombstones();
      this._commitDirtySnapshot();
    }

    // 更新同步时间
    this.lastSyncAt = {
      messages: result.syncedAt,
      conversations: result.syncedAt,
      agents: result.syncedAt,
      boss: result.syncedAt,
    };
    this.saveConfig();

    return result.stats || { conversations: 0, messages: 0, agents: 0, boss: 0 };
  }

  /**
   * 收集本地变更数据
   */
  async collectLocalChanges() {
    const data = {
      messages: [],
      conversations: [],
      agents: [],
      bossConfig: null,
      // P2-6：扩展同步范围 —— operations/projects/budgets 作为整体文档同步
      documents: [],
    };

    if (!this.dataPath) return data;

    // P0-10：本次观察到的 id 集合，用于 reconcile 检测物理删除
    const seenNow = { conversations: [], messages: [], agents: [] };

    // 读取聊天历史
    const chatHistoryPath = path.join(this.dataPath, 'chat-history.json');
    if (fs.existsSync(chatHistoryPath)) {
      try {
        const chatHistory = JSON.parse(fs.readFileSync(chatHistoryPath, 'utf-8'));
        
        if (chatHistory.state?.conversations) {
          for (const [convId, conv] of Object.entries(chatHistory.state.conversations)) {
            const agentId = conv.participants?.find(p => p !== 'user') || convId.replace('private-', '');
            data.conversations.push({
              id: convId,
              agentId,
              title: conv.name || agentId,
              createdAt: conv.createdAt || Date.now(),
              updatedAt: conv.lastMessage?.timestamp || Date.now(),
            });
            seenNow.conversations.push(convId);
          }
        }

        if (chatHistory.state?.messagesByConversation) {
          for (const [convId, messages] of Object.entries(chatHistory.state.messagesByConversation)) {
            if (!Array.isArray(messages)) continue;
            for (const msg of messages) {
              data.messages.push({
                id: msg.id,
                conversationId: convId,
                role: msg.senderType === 'user' || msg.senderId === 'user' ? 'user' : 'assistant',
                content: msg.content || '',
                timestamp: msg.timestamp || Date.now(),
                updatedAt: msg.timestamp || Date.now(),
                // P0-10：透传软删除标志（chat-store.js 的 deleteMessages 会标记 deleted:true）
                deleted: msg.deleted ? true : undefined,
              });
              seenNow.messages.push(msg.id);
            }
          }
        }
      } catch (error) {
        console.error('读取聊天历史失败:', error);
      }
    }

    // 读取 Agent 配置
    const agentConfigPath = path.join(this.dataPath, 'agent-configs.json');
    if (fs.existsSync(agentConfigPath)) {
      try {
        const agents = JSON.parse(fs.readFileSync(agentConfigPath, 'utf-8'));
        for (const [id, agent] of Object.entries(agents)) {
          data.agents.push({
            id,
            name: agent.name,
            title: agent.title,
            role: agent.role,
            level: agent.level,
            department: agent.department,
            departments: agent.departments,
            avatar: agent.avatar,
            avatarThumb: agent.avatarThumb,
            avatarFull: agent.avatarFull,
            description: agent.description,
            model: agent.model,
            status: agent.status || 'active',
            updatedAt: Date.now(),
          });
          seenNow.agents.push(id);
        }
      } catch (error) {
        console.error('读取 Agent 配置失败:', error);
      }
    }

    // 读取 Boss 配置
    const bossConfigPath = path.join(this.dataPath, 'boss-config.json');
    if (fs.existsSync(bossConfigPath)) {
      try {
        const boss = JSON.parse(fs.readFileSync(bossConfigPath, 'utf-8'));
        data.bossConfig = {
          name: boss.name || '老板',
          avatar: boss.avatar,
          avatarThumb: boss.avatarThumb,
          avatarFull: boss.avatarFull,
          updatedAt: Date.now(),
        };
      } catch (error) {
        console.error('读取 Boss 配置失败:', error);
      }
    }

    // P2-6：读取 operations / projects / budgets 作为整体文档同步
    // 每类一条记录，id = {userId}:{companyId|''}:{dataType}，content 为整个 JSON 字符串
    // companyId 从 dataPath 末段提取（dataPath = ~/.soloforge/data/{accountId}/{companyId}）
    const pathSegments = (this.dataPath || '').split('/').filter(Boolean);
    const companyIdFromPath = pathSegments[pathSegments.length - 1] || '';
    const docTypes = ['operations', 'projects', 'budgets'];
    for (const dataType of docTypes) {
      const filePath = path.join(this.dataPath, `${dataType}.json`);
      if (!fs.existsSync(filePath)) continue;
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        // 用文件 mtime 作为 updatedAt（比解析 JSON 内部时间更可靠，且不需要约定字段）
        const stat = fs.statSync(filePath);
        const docId = `${this.userId}:${companyIdFromPath}:${dataType}`;
        data.documents.push({
          id: docId,
          dataType,
          content: raw,
          updatedAt: stat.mtimeMs || Date.now(),
          companyId: companyIdFromPath,
        });
      } catch (error) {
        console.error(`读取 ${dataType}.json 失败:`, error);
      }
    }

    // P0-10：reconcile —— 用 seenNow 对比上次的 seen，检测物理删除并追加 tombstone
    // （chat-store.js 的 deleteConversation 是物理删除 Map.delete；deleteMessages 是软删除，
    //   软删除消息通过 msg.deleted 标志随常规数据上送，无需走 tombstone 路径）
    const deletedAt = Date.now();
    const types = ['conversations', 'messages', 'agents'];
    for (const t of types) {
      const seenSet = new Set(this.tombstones.seen[t] || []);
      const nowSet = new Set(seenNow[t]);
      // 之前看过、现在看不到了 = 被物理删除
      const disappeared = [...seenSet].filter(id => !nowSet.has(id));
      // 排除已在待推送墓碑中的重复项（避免幂等性下重复 push）
      const alreadyPending = new Set(this.tombstones.deleted[t].map(e => e.id));
      for (const id of disappeared) {
        if (!alreadyPending.has(id)) {
          this.tombstones.deleted[t].push({ id, deletedAt });
        }
      }
      // 更新 seen 快照
      this.tombstones.seen[t] = seenNow[t];
    }
    this.saveTombstones();

    // P2-5：dirty 过滤 —— 只保留签名变化的对象，避免全量 push。
    // 流程：
    // 1) 先用当前全量对象计算 nextSnapshot（push 成功后提交的"已干净"快照）。
    // 2) 再用 _isDirty 过滤出 dirty 子集作为 push 载荷。
    // 3) nextSnapshot 暂存在 this._pendingDirtySnapshot，push 成功后提交。
    // 注：被标记 deleted 的对象仍需上送（软删除信号），不参与 dirty 过滤；
    //     deleted 对象的签名也写入 nextSnapshot，下次 collect 若仍 deleted 则不再 dirty。
    const nextSnapshot = {
      conversations: {},
      messages: {},
      agents: {},
      boss: null,
      documents: {}, // P2-6：文档类 dirty 快照
    };
    for (const o of data.conversations) nextSnapshot.conversations[o.id] = this._signature(o);
    for (const o of data.messages) nextSnapshot.messages[o.id] = this._signature(o);
    for (const o of data.agents) nextSnapshot.agents[o.id] = this._signature(o);
    nextSnapshot.boss = this._signature(data.bossConfig);
    for (const o of data.documents) nextSnapshot.documents[o.id] = this._signature(o);
    this._pendingDirtySnapshot = nextSnapshot; // push 成功后由 _commitDirtySnapshot() 提交

    const filterDirty = (arr, type) => arr.filter(o =>
      o?.deleted === true || this._isDirty(type, o.id, o)
    );
    data.conversations = filterDirty(data.conversations, 'conversations');
    data.messages = filterDirty(data.messages, 'messages');
    data.agents = filterDirty(data.agents, 'agents');
    // P2-6：documents 走 dirty 过滤（整体文档，按 id 比签名）
    data.documents = filterDirty(data.documents, 'documents');
    // boss 是单例：用单独的 boss 槽位
    if (data.bossConfig && (this.dirtySnapshot.boss === null || this._signature(data.bossConfig) !== this.dirtySnapshot.boss)) {
      // dirty → 保留
    } else {
      data.bossConfig = null;
    }

    return data;
  }

  /**
   * P2-5：提交 dirty 快照（push 成功后调用）
   * 将 _pendingDirtySnapshot 设为当前快照并持久化，等价于清空 dirtyIds。
   * 失败时不调用 → 下次 collect 仍会检出同样的 dirty 对象。
   */
  _commitDirtySnapshot() {
    if (this._pendingDirtySnapshot) {
      this.dirtySnapshot = this._pendingDirtySnapshot;
      this._pendingDirtySnapshot = null;
      this.saveDirtySnapshot();
    }
  }

  /**
   * 合并远程数据到本地
   */
  async mergeRemoteData(remoteData) {
    const stats = { conversations: 0, messages: 0, agents: 0, boss: 0, documents: 0 };
    if (!this.dataPath) return stats;

    // 合并会话和消息
    const chatHistoryPath = path.join(this.dataPath, 'chat-history.json');
    let chatHistory = { state: { conversations: {}, messagesByConversation: {} } };
    
    if (fs.existsSync(chatHistoryPath)) {
      try {
        chatHistory = JSON.parse(fs.readFileSync(chatHistoryPath, 'utf-8'));
        if (!chatHistory.state) {
          chatHistory.state = { conversations: {}, messagesByConversation: {} };
        }
      } catch (error) {
        console.error('读取本地聊天历史失败:', error);
      }
    }

    // 合并会话
    if (remoteData.conversations?.length) {
      for (const conv of remoteData.conversations) {
        if (conv.deleted) {
          delete chatHistory.state.conversations[conv.id];
        } else {
          const existing = chatHistory.state.conversations[conv.id];
          if (!existing || conv.updatedAt > (existing.lastMessage?.timestamp || 0)) {
            chatHistory.state.conversations[conv.id] = {
              ...existing,
              name: conv.title,
              participants: ['user', conv.agentId],
              createdAt: conv.createdAt,
              lastMessage: existing?.lastMessage || { timestamp: conv.updatedAt },
            };
            stats.conversations++;
          }
        }
      }
    }

    // 合并消息
    if (remoteData.messages?.length) {
      for (const msg of remoteData.messages) {
        if (!chatHistory.state.messagesByConversation[msg.conversationId]) {
          chatHistory.state.messagesByConversation[msg.conversationId] = [];
        }
        
        const messages = chatHistory.state.messagesByConversation[msg.conversationId];
        const existingIndex = messages.findIndex(m => m.id === msg.id);
        
        if (msg.deleted) {
          if (existingIndex !== -1) {
            messages.splice(existingIndex, 1);
          }
        } else {
          const newMsg = {
            id: msg.id,
            senderId: msg.role === 'user' ? 'user' : msg.conversationId.replace('private-', ''),
            senderType: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
          };
          
          if (existingIndex !== -1) {
            if (msg.updatedAt > messages[existingIndex].timestamp) {
              messages[existingIndex] = newMsg;
            }
          } else {
            messages.push(newMsg);
          }
          stats.messages++;
        }
      }
      
      // 按时间排序消息
      for (const convId of Object.keys(chatHistory.state.messagesByConversation)) {
        chatHistory.state.messagesByConversation[convId].sort((a, b) => a.timestamp - b.timestamp);
      }
    }

    // 保存聊天历史
    fs.writeFileSync(chatHistoryPath, JSON.stringify(chatHistory, null, 2));

    // 合并 Agents
    if (remoteData.agents?.length) {
      const agentConfigPath = path.join(this.dataPath, 'agent-configs.json');
      let agents = {};
      
      if (fs.existsSync(agentConfigPath)) {
        try {
          agents = JSON.parse(fs.readFileSync(agentConfigPath, 'utf-8'));
        } catch (error) {
          console.error('读取本地 Agent 配置失败:', error);
        }
      }

      for (const agent of remoteData.agents) {
        if (agent.deleted) {
          delete agents[agent.id];
        } else {
          const existing = agents[agent.id];
          if (!existing || agent.updatedAt > (existing.updatedAt || 0)) {
            agents[agent.id] = {
              ...existing,
              ...agent,
            };
            stats.agents++;
          }
        }
      }

      fs.writeFileSync(agentConfigPath, JSON.stringify(agents, null, 2));
    }

    // 合并 Boss 配置
    if (remoteData.bossConfig) {
      const bossConfigPath = path.join(this.dataPath, 'boss-config.json');
      let boss = { name: '老板', avatar: '👑' };
      
      if (fs.existsSync(bossConfigPath)) {
        try {
          boss = JSON.parse(fs.readFileSync(bossConfigPath, 'utf-8'));
        } catch (error) {
          console.error('读取本地 Boss 配置失败:', error);
        }
      }

      if (remoteData.bossConfig.updatedAt > (boss.updatedAt || 0)) {
        boss = { ...boss, ...remoteData.bossConfig };
        fs.writeFileSync(bossConfigPath, JSON.stringify(boss, null, 2));
        stats.boss = 1;
      }
    }

    // P2-6：合并文档类数据（operations / projects / budgets）
    // 策略：仅当本地文件不存在，或远程 updatedAt 更新时写入，避免覆盖本地更新的数据。
    // 用原子写入避免与主进程 store 的并发写冲突。
    if (remoteData.documents?.length) {
      const { atomicWrite } = require('../utils/atomic-write');
      for (const doc of remoteData.documents) {
        if (!doc.dataType || !doc.content) continue;
        const filePath = path.join(this.dataPath, `${doc.dataType}.json`);
        // 判断是否需要写入：本地不存在，或远程更新时间更新
        let needWrite = true;
        if (fs.existsSync(filePath)) {
          try {
            const stat = fs.statSync(filePath);
            const localMtime = stat.mtimeMs || 0;
            // 远程 updatedAt 更新才写入（LWW 基于文件 mtime）
            if ((doc.updatedAt || 0) <= localMtime) needWrite = false;
          } catch { /* 读取失败则保守写入 */ }
        }
        if (needWrite) {
          try {
            await atomicWrite(filePath, doc.content);
            stats.documents++;
          } catch (error) {
            console.error(`写入 ${doc.dataType}.json 失败:`, error);
          }
        }
      }
    }

    return stats;
  }

  /**
   * 获取同步状态
   */
  async getStatus() {
    if (!this.syncUrl || !this.userId) {
      return { configured: false };
    }

    try {
      // P0-12：带 token 鉴权
      const headers = await this._getAuthHeaders();
      if (!headers) {
        return { configured: true, needsReauth: true };
      }

      const response = await fetch(
        `${this.syncUrl}/sync/status?userId=${encodeURIComponent(this.userId)}&deviceId=${encodeURIComponent(this.deviceId)}`,
        { method: 'GET', headers }
      );

      // P0-12：处理 401/403
      if (response.status === 401 || response.status === 403) {
        await this._handle401();
        return { needsReauth: true };
      }

      if (!response.ok) {
        throw new Error(`状态查询失败: ${response.status}`);
      }

      const result = await response.json();
      // P0-12：附带 token 状态，便于 UI 判断
      result.needsReauth = false;
      return result;
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * P0-12：构建带 Authorization 头的请求 headers
   * 从 accountStore 取当前用户 token；缺失/过期返回 null（调用方应跳过同步）。
   * 本地账号（isCloud=false）不返回带 token 的 headers —— 调用方不应在本地账号模式下调用受保护端点。
   */
  async _getAuthHeaders() {
    if (!this.userId) return null;
    const token = accountStore.getToken(this.userId);
    if (!token) {
      // token 缺失或已过期；若账号需要重新登录，确保标记
      if (accountStore.needsReauth(this.userId)) {
        // 已标记，无需重复
      }
      return null;
    }
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
  }

  /**
   * P0-12：处理 401 响应
   * - 清除本地 token（标记账号需要重新登录）
   * - 停止自动同步（避免 30 秒轮询持续 401）
   * - 通知监听器（渲染进程可据此弹出重新登录提示）
   */
  async _handle401() {
    console.warn('[CloudSync] 收到 401/403，token 无效或过期，停止自动同步并通知重新登录');
    this.stopAutoSync();
    if (this.userId) {
      try {
        accountStore.clearToken(this.userId);
      } catch (e) {
        console.error('[CloudSync] clearToken 失败:', e);
      }
    }
    this.notifyListeners({
      type: 'reauth-required',
      success: false,
      error: 'Token 无效或已过期，请重新登录',
      userId: this.userId,
    });
  }
}

const cloudSync = new CloudSyncService();
module.exports = { cloudSync };

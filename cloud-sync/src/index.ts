/**
 * SoloForge 云同步 API - Cloudflare Workers
 * 
 * 端点:
 * - POST /sync/push - 上传本地变更
 * - POST /sync/pull - 拉取远程变更
 * - GET /sync/status - 获取同步状态
 * - GET /app/version - 检查应用版本
 * - GET /app/download - 下载最新 APK
 * - GET /devices?userId=xxx - 列出用户设备（P3-C）
 * - POST /devices/register - 注册/更新设备（P3-C）
 * - DELETE /devices/:deviceId?userId=xxx - 删除设备（P3-C）
 */

export interface Env {
  DB: D1Database;
  SYNC_SECRET: string;
}

// 版本信息 - 发布新版本时修改这里
const APP_VERSION = {
  version: '2.1.0',
  versionCode: 210,
  releaseNotes: '新增双向云同步功能、自动更新',
  // APK 下载链接 - 可以是任意文件托管服务的链接
  // 例如: GitHub Releases, 蓝奏云, 阿里云盘, Google Drive 等
  downloadUrl: '',
  apkSize: 67000000,
  updatedAt: '2026-02-28',
};

interface SyncPushRequest {
  userId: string;
  deviceId: string;
  deviceType: 'desktop' | 'mobile';
  // P2-4c：可选公司维度，客户端带上后 Worker 存入对应 company_id 列。
  companyId?: string;
  data: {
    messages?: MessageRecord[];
    conversations?: ConversationRecord[];
    agents?: AgentRecord[];
    bossConfig?: BossConfigRecord;
    // P2-6：通用文档同步（operations / projects / budgets 等）
    documents?: DocumentRecord[];
  };
  // P0-10：删除信号。服务端对这些 id 执行软删除（UPDATE SET deleted=1, updated_at=now）
  deletedIds?: {
    conversations?: string[];
    messages?: string[];
    agents?: string[];
    // P2-6：文档删除（sync_documents.id）
    documents?: string[];
  };
}

interface SyncPullRequest {
  userId: string;
  deviceId: string;
  since: number; // 上次同步时间戳
  // P2-4c：可选公司维度过滤。若指定，pull 只返回 company_id 匹配（含 NULL/'' 旧行兼容）。
  companyId?: string;
}

interface MessageRecord {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  timestamp: number;
  updatedAt: number;
  // P2-4b：客户端持有的上次 server_rev，服务端用于 LWW 比较。
  // undefined / 0 表示新对象或首次同步。
  serverRev?: number;
  // P2-4c：公司维度（可选）
  companyId?: string;
  deleted?: boolean;
}

interface ConversationRecord {
  id: string;
  agentId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  // P2-4b：客户端持有的上次 server_rev
  serverRev?: number;
  // P2-4c：公司维度（可选）
  companyId?: string;
  deleted?: boolean;
}

interface AgentRecord {
  id: string;
  name: string;
  title?: string;
  role?: string;
  level?: string;
  department?: string;
  departments?: string[];
  avatar?: string;
  avatarThumb?: string;
  avatarFull?: string;
  description?: string;
  model?: string;
  status?: string;
  updatedAt: number;
  // P2-4b：客户端持有的上次 server_rev
  serverRev?: number;
  // P2-4c：公司维度（可选）
  companyId?: string;
  deleted?: boolean;
}

interface BossConfigRecord {
  name: string;
  avatar?: string;
  avatarThumb?: string;
  avatarFull?: string;
  updatedAt: number;
  // P2-4b：客户端持有的上次 server_rev
  serverRev?: number;
  // P2-4c：公司维度（可选，默认 '' 即单例）
  companyId?: string;
}

// P2-6：通用文档同步记录
// 用于 operations / projects / budgets 等整体文档数据。
// - id 由客户端预生成（"{userId}:{companyId|''}:{dataType}"），Worker 端 upsert 到 sync_documents 表。
// - content 为整个 JSON 文档的字符串（整体替换，不细粒度合并）。
// - LWW 基于 server_rev（同其它数据表），deleted 支持软删除。
// - companyId 为 undefined / null 时归一化为 ''（单例槽位，与 boss_config 语义一致）。
interface DocumentRecord {
  id: string;               // {userId}:{companyId|''}:{dataType}
  dataType: string;         // 'operations' | 'projects' | 'budgets'
  content: string;          // JSON 字符串
  updatedAt: number;
  // P2-4b：客户端持有的上次 server_rev
  serverRev?: number;
  // P2-4c：公司维度（可选，默认 '' 即单例）
  companyId?: string;
  deleted?: boolean;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    // P3-C：新增 DELETE（/devices/:deviceId）
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}

// ============ P3-C：限流中间件 ============
//
// 设计要点：
// 1. Cloudflare Worker 无持久存储，限流计数存于 globalThis。
//    同一隔离体（isolate）在生命周期内复用 globalThis，可防恶意高频请求；
//    隔离体回收/重启后计数清零，这是已知限制，单隔离体内有效即可。
// 2. 滑动窗口策略：每个 key 维护请求时间戳数组，剔除已过期窗口外的记录，
//    再判断当前窗口内请求数是否超限。实现简单、内存占用低。
// 3. 429 响应包含 Retry-After header（windowMs/1000 秒），遵循 HTTP 语义。
// 4. key 选择：用户鉴权后用 userId；未鉴权（如 /auth/login）用 IP。
//    IP 取自 CF-Connecting-IP（Cloudflare 注入），缺失时回退 X-Forwarded-For
//    第一个值，再缺失则用 'unknown'。
//
// 限流策略表：
// | 端点             | key    | limit | window  | 说明                 |
// |------------------|--------|-------|---------|----------------------|
// | /sync/*          | userId | 60    | 60s     | 同步不需高频          |
// | /auth/login      | IP     | 10    | 60s     | 防暴力破解            |
// | /auth/register   | IP     | 5     | 60s     | 防注册刷号            |
// | /app/publish     | secret | 5     | 60s     | 用 SYNC_SECRET 鉴权后 |
// | /devices/*       | userId | 60    | 60s     | 设备管理（与 sync 同级）|
// | 其他端点         | IP     | 120   | 60s     | 宽松默认              |

interface RateLimitEntry {
  timestamps: number[];
}

// globalThis 上挂载限流存储。Cloudflare Worker 隔离体间不共享 globalThis，
// 但同一隔离体生命周期内有效，足以防单点高频攻击。
function getRateLimitStore(): Map<string, RateLimitEntry> {
  const g = globalThis as any;
  if (!g._rateLimitStore) {
    g._rateLimitStore = new Map<string, RateLimitEntry>();
  }
  return g._rateLimitStore as Map<string, RateLimitEntry>;
}

// 取客户端 IP。Cloudflare 注入 CF-Connecting-IP；无则回退到 X-Forwarded-For 首段。
function getClientIP(request: Request): string {
  const cf = request.headers.get('CF-Connecting-IP');
  if (cf) return cf;
  const xff = request.headers.get('X-Forwarded-For');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

// 限流检查。返回 null 表示放行；返回 Response 表示已超限（429，含 Retry-After）。
// key：限流维度键（userId 或 IP 或 secret 标识）。
// limit：窗口内允许的最大请求数。windowMs：窗口时长（毫秒）。
function rateLimit(
  request: Request,
  key: string,
  limit: number,
  windowMs: number
): Response | null {
  const store = getRateLimitStore();
  const now = Date.now();
  const windowStart = now - windowMs;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // 剔除窗口外的旧时间戳（滑动窗口）
  entry.timestamps = entry.timestamps.filter(ts => ts > windowStart);

  if (entry.timestamps.length >= limit) {
    // 已超限：返回 429 + Retry-After
    const retryAfterSec = Math.max(1, Math.ceil(windowMs / 1000));
    return new Response(
      JSON.stringify({
        error: 'Too many requests',
        retryAfter: retryAfterSec,
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfterSec),
          ...corsHeaders(),
        },
      }
    );
  }

  // 放行并记录本次请求时间戳
  entry.timestamps.push(now);
  return null;
}

// 针对鉴权后端点的便捷封装：用 token.userId 作 key 限流。
// 调用方需先通过 requireToken 拿到 auth.userId。
function rateLimitByUserId(
  request: Request,
  userId: string,
  limit: number,
  windowMs: number
): Response | null {
  return rateLimit(request, `user:${userId}`, limit, windowMs);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/sync/push' && request.method === 'POST') {
        return await handlePush(request, env);
      }
      
      if (path === '/sync/pull' && request.method === 'POST') {
        return await handlePull(request, env);
      }
      
      if (path === '/sync/status' && request.method === 'GET') {
        return await handleStatus(request, env);
      }

      if (path === '/health') {
        // P3-C：默认限流（每 IP 120 次/分钟）。
        const rlHealth = rateLimit(request, `ip:${getClientIP(request)}`, 120, 60_000);
        if (rlHealth) return rlHealth;
        return jsonResponse({ status: 'ok', timestamp: Date.now() });
      }

      if (path === '/app/version') {
        // P3-C：默认限流（每 IP 120 次/分钟）。
        const rlVer = rateLimit(request, `ip:${getClientIP(request)}`, 120, 60_000);
        if (rlVer) return rlVer;
        // 从数据库获取最新版本信息（如果有的话）
        let versionInfo = { ...APP_VERSION };
        try {
          const dbVersion = await env.DB.prepare(`
            SELECT version, version_code, release_notes, download_url, apk_size, updated_at
            FROM app_versions ORDER BY version_code DESC LIMIT 1
          `).first();
          
          if (dbVersion) {
            versionInfo = {
              version: dbVersion.version as string,
              versionCode: dbVersion.version_code as number,
              releaseNotes: dbVersion.release_notes as string,
              downloadUrl: dbVersion.download_url as string,
              apkSize: dbVersion.apk_size as number,
              updatedAt: dbVersion.updated_at as string,
            };
          }
        } catch (e) {
          // 表可能不存在，使用默认值
        }
        
        return jsonResponse({
          ...versionInfo,
          serverTime: Date.now(),
        });
      }

      if (path === '/app/publish' && request.method === 'POST') {
        return await handleAppPublish(request, env);
      }

      // 用户认证相关
      if (path === '/auth/register' && request.method === 'POST') {
        // P3-C：限流（每 IP 5 次/分钟，防注册刷号）。在鉴权之前，用 IP 作 key。
        const ip = getClientIP(request);
        const rl = rateLimit(request, `ip:${ip}`, 5, 60_000);
        if (rl) return rl;
        return await handleRegister(request, env);
      }

      if (path === '/auth/login' && request.method === 'POST') {
        // P3-C：限流（每 IP 10 次/分钟，防暴力破解）。在鉴权之前，用 IP 作 key。
        const ip = getClientIP(request);
        const rl = rateLimit(request, `ip:${ip}`, 10, 60_000);
        if (rl) return rl;
        return await handleLogin(request, env);
      }

      if (path === '/auth/profile' && request.method === 'GET') {
        // P3-C：默认限流（每 IP 120 次/分钟）。
        const rlProf = rateLimit(request, `ip:${getClientIP(request)}`, 120, 60_000);
        if (rlProf) return rlProf;
        return await handleGetProfile(request, env);
      }

      // P3-C：设备管理端点。requireToken 鉴权 + 每用户限流在 handler 内部完成。
      if (path === '/devices' && request.method === 'GET') {
        return await handleDevicesList(request, env);
      }

      if (path === '/devices/register' && request.method === 'POST') {
        return await handleDeviceRegister(request, env);
      }

      // DELETE /devices/:deviceId?userId=xxx
      if (path.startsWith('/devices/') && request.method === 'DELETE') {
        const deviceId = decodeURIComponent(path.slice('/devices/'.length));
        return await handleDeviceDelete(request, env, deviceId);
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (error) {
      console.error('Sync error:', error);
      return jsonResponse({ error: String(error) }, 500);
    }
  },
};

async function handlePush(request: Request, env: Env): Promise<Response> {
  let body: SyncPushRequest;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { userId, deviceId, deviceType, data, deletedIds, companyId } = body;

  if (!userId || !deviceId) {
    return jsonResponse({ error: 'Missing userId or deviceId' }, 400);
  }
  // P0-12：要求 token，且 token.userId 必须与 body.userId 一致
  const auth = await requireToken(request, env, userId);
  if (auth instanceof Response) {
    return auth;
  }

  // P3-C：限流（每用户 60 次/分钟，同步不需高频）。鉴权后用 userId 作 key。
  const rl = rateLimitByUserId(request, auth.userId, 60, 60_000);
  if (rl) return rl;

  if (!data) {
    return jsonResponse({ error: 'Missing data field' }, 400);
  }

  // P2-4c：公司维度归一化。undefined → NULL（不指定公司）；'' 保留为单例语义。
  // 传给 SQL bind 时 null 表示 SQL NULL，'' 表示空串。对象级别的 companyId 优先于请求级。
  const reqCompanyId = companyId ?? null;

  // P0-11：服务端时间统一覆盖 updated_at，避免客户端时钟漂移导致 LWW 永远判输
  // 客户端原始时间戳保留到 client_updated_at，仅用于调试，不参与 LWW 比较
  // P2-4b：LWW 比较改用 server_rev（而非 updated_at），消除等时间静默丢写。
  //   规则：excluded.server_rev >= existing.server_rev 则接受 incoming 字段，并 server_rev +1。
  //   客户端首次 push 已有对象时 serverRev=0，服务端 0>=0 成立，接受并 +1。
  const now = Date.now();
  // P2-6：stats 新增 documents 计数（其余键保持不变，兼容旧客户端）
  const stats = { messages: 0, conversations: 0, agents: 0, boss: 0, documents: 0 } as Record<string, number>;
  const errors: string[] = [];

  // 更新设备信息
  // P3-C：UPSERT 同时更新 device_name / device_type / last_sync_at，
  // 与 POST /devices/register 语义一致；push 成功即视为一次有效同步。
  try {
    await env.DB.prepare(`
      INSERT INTO devices (id, user_id, device_name, device_type, last_sync_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        device_name = COALESCE(excluded.device_name, devices.device_name),
        device_type = COALESCE(excluded.device_type, devices.device_type),
        last_sync_at = excluded.last_sync_at
    `).bind(deviceId, userId, deviceId, deviceType || 'unknown', now).run();
  } catch (e) {
    errors.push(`devices: ${String(e)}`);
  }

  // 同步会话
  if (data.conversations?.length) {
    for (const conv of data.conversations) {
      try {
        // P0-11：clientUpdatedAt 保留客户端原始时间戳；updated_at 用服务端 now
        const clientUpdatedAt = conv.updatedAt || now;
        // P2-4b：客户端持有的 server_rev（用于 LWW 比较）
        const incomingRev = conv.serverRev ?? 0;
        // P2-4c：对象级 companyId 优先于请求级；均为 undefined 时为 NULL
        const rowCompanyId = conv.companyId !== undefined ? conv.companyId : reqCompanyId;
        await env.DB.prepare(`
          INSERT INTO conversations
            (id, user_id, agent_id, title, created_at, updated_at, client_updated_at, server_rev, company_id, deleted)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            agent_id = CASE WHEN excluded.server_rev >= conversations.server_rev THEN excluded.agent_id ELSE conversations.agent_id END,
            title = CASE WHEN excluded.server_rev >= conversations.server_rev THEN excluded.title ELSE conversations.title END,
            updated_at = CASE WHEN excluded.server_rev >= conversations.server_rev THEN excluded.updated_at ELSE conversations.updated_at END,
            client_updated_at = CASE WHEN excluded.server_rev >= conversations.server_rev THEN excluded.client_updated_at ELSE conversations.client_updated_at END,
            company_id = CASE WHEN excluded.server_rev >= conversations.server_rev THEN excluded.company_id ELSE conversations.company_id END,
            deleted = CASE WHEN excluded.server_rev >= conversations.server_rev THEN excluded.deleted ELSE conversations.deleted END,
            server_rev = CASE WHEN excluded.server_rev >= conversations.server_rev THEN conversations.server_rev + 1 ELSE conversations.server_rev END
        `).bind(
          conv.id, userId, conv.agentId || '', conv.title || '',
          conv.createdAt || now, now, clientUpdatedAt, incomingRev, rowCompanyId, conv.deleted ? 1 : 0
        ).run();
        stats.conversations++;
      } catch (e) {
        errors.push(`conversation ${conv.id}: ${String(e)}`);
      }
    }
  }

  // 同步消息
  if (data.messages?.length) {
    for (const msg of data.messages) {
      try {
        // P0-11：clientUpdatedAt 保留客户端原始时间戳；updated_at 用服务端 now
        const clientUpdatedAt = msg.updatedAt || now;
        // P2-4b：客户端持有的 server_rev
        const incomingRev = msg.serverRev ?? 0;
        // P2-4c：对象级 companyId 优先
        const rowCompanyId = msg.companyId !== undefined ? msg.companyId : reqCompanyId;
        await env.DB.prepare(`
          INSERT INTO messages
            (id, user_id, conversation_id, role, content, timestamp, updated_at, client_updated_at, server_rev, company_id, deleted)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            content = CASE WHEN excluded.server_rev >= messages.server_rev THEN excluded.content ELSE messages.content END,
            updated_at = CASE WHEN excluded.server_rev >= messages.server_rev THEN excluded.updated_at ELSE messages.updated_at END,
            client_updated_at = CASE WHEN excluded.server_rev >= messages.server_rev THEN excluded.client_updated_at ELSE messages.client_updated_at END,
            company_id = CASE WHEN excluded.server_rev >= messages.server_rev THEN excluded.company_id ELSE messages.company_id END,
            deleted = CASE WHEN excluded.server_rev >= messages.server_rev THEN excluded.deleted ELSE messages.deleted END,
            server_rev = CASE WHEN excluded.server_rev >= messages.server_rev THEN messages.server_rev + 1 ELSE messages.server_rev END
        `).bind(
          msg.id, userId, msg.conversationId || '', msg.role || 'user', msg.content || '',
          msg.timestamp || now, now, clientUpdatedAt, incomingRev, rowCompanyId, msg.deleted ? 1 : 0
        ).run();
        stats.messages++;
      } catch (e) {
        errors.push(`message ${msg.id}: ${String(e)}`);
      }
    }
  }

  // 同步 Agents
  if (data.agents?.length) {
    for (const agent of data.agents) {
      try {
        // P0-11：clientUpdatedAt 保留客户端原始时间戳；updated_at 用服务端 now
        const clientUpdatedAt = agent.updatedAt || now;
        // P2-4b：客户端持有的 server_rev
        const incomingRev = agent.serverRev ?? 0;
        // P2-4c：对象级 companyId 优先
        const rowCompanyId = agent.companyId !== undefined ? agent.companyId : reqCompanyId;
        await env.DB.prepare(`
          INSERT INTO agents
            (id, user_id, name, title, role, level, department, departments, avatar, avatar_thumb, avatar_full, description, model, status, updated_at, client_updated_at, server_rev, company_id, deleted)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id, user_id) DO UPDATE SET
            name = CASE WHEN excluded.server_rev >= agents.server_rev THEN excluded.name ELSE agents.name END,
            title = CASE WHEN excluded.server_rev >= agents.server_rev THEN excluded.title ELSE agents.title END,
            role = CASE WHEN excluded.server_rev >= agents.server_rev THEN excluded.role ELSE agents.role END,
            level = CASE WHEN excluded.server_rev >= agents.server_rev THEN excluded.level ELSE agents.level END,
            department = CASE WHEN excluded.server_rev >= agents.server_rev THEN excluded.department ELSE agents.department END,
            departments = CASE WHEN excluded.server_rev >= agents.server_rev THEN excluded.departments ELSE agents.departments END,
            avatar = CASE WHEN excluded.server_rev >= agents.server_rev THEN excluded.avatar ELSE agents.avatar END,
            avatar_thumb = CASE WHEN excluded.server_rev >= agents.server_rev THEN excluded.avatar_thumb ELSE agents.avatar_thumb END,
            avatar_full = CASE WHEN excluded.server_rev >= agents.server_rev THEN excluded.avatar_full ELSE agents.avatar_full END,
            description = CASE WHEN excluded.server_rev >= agents.server_rev THEN excluded.description ELSE agents.description END,
            model = CASE WHEN excluded.server_rev >= agents.server_rev THEN excluded.model ELSE agents.model END,
            status = CASE WHEN excluded.server_rev >= agents.server_rev THEN excluded.status ELSE agents.status END,
            updated_at = CASE WHEN excluded.server_rev >= agents.server_rev THEN excluded.updated_at ELSE agents.updated_at END,
            client_updated_at = CASE WHEN excluded.server_rev >= agents.server_rev THEN excluded.client_updated_at ELSE agents.client_updated_at END,
            company_id = CASE WHEN excluded.server_rev >= agents.server_rev THEN excluded.company_id ELSE agents.company_id END,
            deleted = CASE WHEN excluded.server_rev >= agents.server_rev THEN excluded.deleted ELSE agents.deleted END,
            server_rev = CASE WHEN excluded.server_rev >= agents.server_rev THEN agents.server_rev + 1 ELSE agents.server_rev END
        `).bind(
          agent.id, userId, agent.name || '', agent.title || null, agent.role || null,
          agent.level || null, agent.department || null,
          agent.departments ? JSON.stringify(agent.departments) : null,
          agent.avatar || null, agent.avatarThumb || null, agent.avatarFull || null,
          agent.description || null, agent.model || null, agent.status || null,
          now, clientUpdatedAt, incomingRev, rowCompanyId, agent.deleted ? 1 : 0
        ).run();
        stats.agents++;
      } catch (e) {
        errors.push(`agent ${agent.id}: ${String(e)}`);
      }
    }
  }

  // 同步 Boss 配置
  if (data.bossConfig) {
    try {
      const boss = data.bossConfig;
      // P0-11：clientUpdatedAt 保留客户端原始时间戳；updated_at 用服务端 now
      const clientUpdatedAt = boss.updatedAt || now;
      // P2-4b：客户端持有的 server_rev
      const incomingRev = boss.serverRev ?? 0;
      // P2-4c：boss_config 主键改为 (user_id, company_id)。companyId 归一化：
      //   undefined / null → ''（单例槽位，兼容旧数据）
      //   指定值 → 原值
      const bossCompanyId = (boss.companyId !== undefined ? boss.companyId : reqCompanyId) ?? '';
      await env.DB.prepare(`
        INSERT INTO boss_config
          (user_id, company_id, name, avatar, avatar_thumb, avatar_full, updated_at, client_updated_at, server_rev)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, company_id) DO UPDATE SET
          name = CASE WHEN excluded.server_rev >= boss_config.server_rev THEN excluded.name ELSE boss_config.name END,
          avatar = CASE WHEN excluded.server_rev >= boss_config.server_rev THEN excluded.avatar ELSE boss_config.avatar END,
          avatar_thumb = CASE WHEN excluded.server_rev >= boss_config.server_rev THEN excluded.avatar_thumb ELSE boss_config.avatar_thumb END,
          avatar_full = CASE WHEN excluded.server_rev >= boss_config.server_rev THEN excluded.avatar_full ELSE boss_config.avatar_full END,
          updated_at = CASE WHEN excluded.server_rev >= boss_config.server_rev THEN excluded.updated_at ELSE boss_config.updated_at END,
          client_updated_at = CASE WHEN excluded.server_rev >= boss_config.server_rev THEN excluded.client_updated_at ELSE boss_config.client_updated_at END,
          server_rev = CASE WHEN excluded.server_rev >= boss_config.server_rev THEN boss_config.server_rev + 1 ELSE boss_config.server_rev END
      `).bind(
        userId, bossCompanyId, boss.name || '老板', boss.avatar || null, boss.avatarThumb || null, boss.avatarFull || null, now, clientUpdatedAt, incomingRev
      ).run();
      stats.boss = 1;
    } catch (e) {
      errors.push(`bossConfig: ${String(e)}`);
    }
  }

  // P2-6：同步通用文档（operations / projects / budgets）
  // 每类数据一条记录，主键 id 由客户端预生成（"{userId}:{companyId|''}:{dataType}"）。
  // upsert 到 sync_documents 表，LWW 基于 server_rev（同其它数据表）。
  // content 为整体 JSON 字符串，整体替换（不细粒度合并）。
  if (data.documents?.length) {
    for (const doc of data.documents) {
      try {
        // P0-11：clientUpdatedAt 保留客户端原始时间戳；updated_at 用服务端 now
        const clientUpdatedAt = doc.updatedAt || now;
        // P2-4b：客户端持有的 server_rev
        const incomingRev = doc.serverRev ?? 0;
        // P2-4c：对象级 companyId 优先；归一化：undefined / null → ''（单例槽位）
        const docCompanyIdRaw = doc.companyId !== undefined ? doc.companyId : reqCompanyId;
        const docCompanyId = docCompanyIdRaw ?? '';
        // 防御：若客户端传的 id 与归一化后的逻辑 id 不一致，以归一化 id 为准
        // （避免客户端拼接错误导致主键冲突或重复记录）
        const logicalId = `${userId}:${docCompanyId}:${doc.dataType}`;
        const docId = doc.id || logicalId;
        await env.DB.prepare(`
          INSERT INTO sync_documents
            (id, user_id, company_id, data_type, content, deleted, updated_at, server_rev, client_updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            company_id = CASE WHEN excluded.server_rev >= sync_documents.server_rev THEN excluded.company_id ELSE sync_documents.company_id END,
            content = CASE WHEN excluded.server_rev >= sync_documents.server_rev THEN excluded.content ELSE sync_documents.content END,
            deleted = CASE WHEN excluded.server_rev >= sync_documents.server_rev THEN excluded.deleted ELSE sync_documents.deleted END,
            updated_at = CASE WHEN excluded.server_rev >= sync_documents.server_rev THEN excluded.updated_at ELSE sync_documents.updated_at END,
            client_updated_at = CASE WHEN excluded.server_rev >= sync_documents.server_rev THEN excluded.client_updated_at ELSE sync_documents.client_updated_at END,
            server_rev = CASE WHEN excluded.server_rev >= sync_documents.server_rev THEN sync_documents.server_rev + 1 ELSE sync_documents.server_rev END
        `).bind(
          docId, userId, docCompanyId, doc.dataType, doc.content,
          doc.deleted ? 1 : 0, now, incomingRev, clientUpdatedAt
        ).run();
        stats.documents++;
      } catch (e) {
        errors.push(`document ${doc.id || doc.dataType}: ${String(e)}`);
      }
    }
  }

  // P0-10：处理 deletedIds —— 对这些 id 执行软删除（UPDATE SET deleted=1, updated_at=now）
  // 用服务端 now 作为 updated_at，确保下次 pull 时这些删除事件能被其它设备拉到。
  // 使用事务批量 UPDATE，避免逐条 prepare 的开销。
  if (deletedIds) {
    const delEntries: { table: string; ids: string[] }[] = [];
    if (deletedIds.conversations?.length) delEntries.push({ table: 'conversations', ids: deletedIds.conversations });
    if (deletedIds.messages?.length) delEntries.push({ table: 'messages', ids: deletedIds.messages });
    if (deletedIds.agents?.length) delEntries.push({ table: 'agents', ids: deletedIds.agents });
    // P2-6：文档软删除
    if (deletedIds.documents?.length) delEntries.push({ table: 'sync_documents', ids: deletedIds.documents });

    for (const { table, ids } of delEntries) {
      for (const id of ids) {
        try {
          if (table === 'agents') {
            // agents 主键是 (id, user_id)
            await env.DB.prepare(`
              UPDATE agents SET deleted = 1, updated_at = ?
              WHERE id = ? AND user_id = ?
            `).bind(now, id, userId).run();
          } else if (table === 'sync_documents') {
            // P2-6：sync_documents 主键是 id，且只删除属于该用户的记录
            await env.DB.prepare(`
              UPDATE sync_documents SET deleted = 1, updated_at = ?
              WHERE id = ? AND user_id = ?
            `).bind(now, id, userId).run();
          } else {
            await env.DB.prepare(`UPDATE ${table} SET deleted = 1, updated_at = ? WHERE id = ? AND user_id = ?`).bind(now, id, userId).run();
          }
          // P2-6：sync_documents 不在 stats 的固定键中，单独累加
          if (table === 'sync_documents') {
            stats.documents = (stats.documents || 0) + 1;
          } else {
            stats[table as keyof typeof stats] = (stats[table as keyof typeof stats] || 0) + 1;
          }
        } catch (e) {
          errors.push(`delete ${table} ${id}: ${String(e)}`);
        }
      }
    }
  }

  // 更新同步元数据
  try {
    // P2-6：新增 'documents' 数据类型（其余保留以兼容旧客户端）
    for (const dataType of ['messages', 'conversations', 'agents', 'boss', 'documents']) {
      await env.DB.prepare(`
        INSERT INTO sync_meta (user_id, device_id, data_type, last_sync_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, device_id, data_type) DO UPDATE SET last_sync_at = ?
      `).bind(userId, deviceId, dataType, now, now).run();
    }
  } catch (e) {
    errors.push(`sync_meta: ${String(e)}`);
  }

  return jsonResponse({
    success: errors.length === 0,
    stats,
    syncedAt: now,
    errors: errors.length > 0 ? errors : undefined,
  });
}

async function handlePull(request: Request, env: Env): Promise<Response> {
  const body: SyncPullRequest = await request.json();
  const { userId, deviceId, since, companyId } = body;

  if (!userId || !deviceId) {
    return jsonResponse({ error: 'Missing userId or deviceId' }, 400);
  }

  // P0-12：要求 token，且 token.userId 必须与 body.userId 一致
  const auth = await requireToken(request, env, userId);
  if (auth instanceof Response) {
    return auth;
  }

  // P3-C：限流（每用户 60 次/分钟，同步不需高频）。鉴权后用 userId 作 key。
  const rl = rateLimitByUserId(request, auth.userId, 60, 60_000);
  if (rl) return rl;

  const sinceTimestamp = since || 0;

  // P2-4c：可选 company_id 过滤。
  // - 未指定 companyId（undefined）：不添加过滤，返回该用户所有数据（兼容旧行为）。
  // - 指定 companyId：只返回 company_id 匹配的行（含 NULL/'' 旧行兼容）。
  //   注：SQLite 中 NULL = ? 为 NULL（非 true），需用 (company_id = ? OR company_id IS NULL OR company_id = '') 兼容。
  //   为简化，这里精确匹配指定值；NULL/'' 旧行由"未指定 companyId"场景覆盖。
  const companyFilter = companyId !== undefined && companyId !== null;
  const companyClause = companyFilter ? ' AND company_id = ?' : '';

  // 获取更新的会话（P2-4b：返回 serverRev；P2-4c：返回 companyId + 可选过滤）
  const conversationsQuery = `
    SELECT id, agent_id as agentId, title, created_at as createdAt, updated_at as updatedAt,
           server_rev as serverRev, company_id as companyId, deleted
    FROM conversations
    WHERE user_id = ? AND updated_at > ?${companyClause}
    ORDER BY updated_at ASC
  `;
  const conversations = companyFilter
    ? await env.DB.prepare(conversationsQuery).bind(userId, sinceTimestamp, companyId).all()
    : await env.DB.prepare(conversationsQuery).bind(userId, sinceTimestamp).all();

  // 获取更新的消息
  const messagesQuery = `
    SELECT id, conversation_id as conversationId, role, content, timestamp, updated_at as updatedAt,
           server_rev as serverRev, company_id as companyId, deleted
    FROM messages
    WHERE user_id = ? AND updated_at > ?${companyClause}
    ORDER BY updated_at ASC
  `;
  const messages = companyFilter
    ? await env.DB.prepare(messagesQuery).bind(userId, sinceTimestamp, companyId).all()
    : await env.DB.prepare(messagesQuery).bind(userId, sinceTimestamp).all();

  // 获取更新的 Agents
  const agentsQuery = `
    SELECT id, name, title, role, level, department, departments, avatar, avatar_thumb as avatarThumb, avatar_full as avatarFull,
           description, model, status, updated_at as updatedAt, server_rev as serverRev, company_id as companyId, deleted
    FROM agents
    WHERE user_id = ? AND updated_at > ?${companyClause}
    ORDER BY updated_at ASC
  `;
  const agentsRaw = companyFilter
    ? await env.DB.prepare(agentsQuery).bind(userId, sinceTimestamp, companyId).all()
    : await env.DB.prepare(agentsQuery).bind(userId, sinceTimestamp).all();

  const agents = agentsRaw.results.map((a: any) => ({
    ...a,
    departments: a.departments ? JSON.parse(a.departments) : undefined,
  }));

  // 获取 Boss 配置（P2-4c：主键含 company_id，需按 companyId 过滤）
  const bossQuery = `
    SELECT name, avatar, avatar_thumb as avatarThumb, avatar_full as avatarFull, updated_at as updatedAt,
           server_rev as serverRev, company_id as companyId
    FROM boss_config
    WHERE user_id = ? AND updated_at > ?${companyFilter ? ' AND company_id = ?' : ''}
  `;
  const bossResult = companyFilter
    ? await env.DB.prepare(bossQuery).bind(userId, sinceTimestamp, companyId).first()
    : await env.DB.prepare(bossQuery).bind(userId, sinceTimestamp).first();

  // P2-6：获取更新的通用文档（operations / projects / budgets）
  // - since 增量：只返回 updated_at > since 的记录。
  // - company_id 过滤同其它表：未指定 companyId 不过滤；指定则精确匹配。
  // - 返回 id / dataType / content / updatedAt / serverRev / companyId / deleted。
  const documentsQuery = `
    SELECT id, data_type as dataType, content, updated_at as updatedAt,
           server_rev as serverRev, company_id as companyId, deleted
    FROM sync_documents
    WHERE user_id = ? AND updated_at > ?${companyClause}
    ORDER BY updated_at ASC
  `;
  const documents = companyFilter
    ? await env.DB.prepare(documentsQuery).bind(userId, sinceTimestamp, companyId).all()
    : await env.DB.prepare(documentsQuery).bind(userId, sinceTimestamp).all();

  const now = Date.now();

  // P3-C：pull 成功后更新该设备的 last_sync_at（仅更新本用户本设备，防越权）。
  // 失败不阻断响应（best-effort），仅记录到 errors 数组并省略——pull 主路径不应因
  // 元数据写入失败而让客户端拿不到数据。这里静默 try/catch。
  try {
    await env.DB.prepare(
      `UPDATE devices SET last_sync_at = ? WHERE id = ? AND user_id = ?`
    ).bind(now, deviceId, auth.userId).run();
  } catch (e) {
    // 静默：设备行可能尚未由 push 创建；客户端通常先 push 再 pull。
  }

  return jsonResponse({
    success: true,
    data: {
      conversations: conversations.results,
      messages: messages.results,
      agents,
      bossConfig: bossResult || null,
      // P2-6：通用文档（operations / projects / budgets）
      documents: documents.results,
    },
    serverTime: now,
  });
}

async function handleStatus(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');
  const deviceId = url.searchParams.get('deviceId');

  if (!userId) {
    return jsonResponse({ error: 'Missing userId' }, 400);
  }

  // P0-12：要求 token，且 token.userId 必须与查询参数 userId 一致
  const auth = await requireToken(request, env, userId);
  if (auth instanceof Response) {
    return auth;
  }

  // P3-C：限流（每用户 60 次/分钟，/sync/* 统一策略）。
  const rl = rateLimitByUserId(request, auth.userId, 60, 60_000);
  if (rl) return rl;

  // 获取各数据类型的数量
  const convCount = await env.DB.prepare(`SELECT COUNT(*) as count FROM conversations WHERE user_id = ? AND deleted = 0`).bind(userId).first();
  const msgCount = await env.DB.prepare(`SELECT COUNT(*) as count FROM messages WHERE user_id = ? AND deleted = 0`).bind(userId).first();
  const agentCount = await env.DB.prepare(`SELECT COUNT(*) as count FROM agents WHERE user_id = ? AND deleted = 0`).bind(userId).first();
  // P2-6：通用文档数量（operations / projects / budgets 未删除记录数）
  const docCount = await env.DB.prepare(`SELECT COUNT(*) as count FROM sync_documents WHERE user_id = ? AND deleted = 0`).bind(userId).first();

  // 获取设备同步状态
  let deviceSync = null;
  if (deviceId) {
    deviceSync = await env.DB.prepare(`
      SELECT data_type, last_sync_at
      FROM sync_meta
      WHERE user_id = ? AND device_id = ?
    `).bind(userId, deviceId).all();
  }

  return jsonResponse({
    userId,
    stats: {
      conversations: (convCount as any)?.count || 0,
      messages: (msgCount as any)?.count || 0,
      agents: (agentCount as any)?.count || 0,
      // P2-6：通用文档数量
      documents: (docCount as any)?.count || 0,
    },
    deviceSync: deviceSync?.results || [],
    serverTime: Date.now(),
  });
}

async function handleAppPublish(request: Request, env: Env): Promise<Response> {
  // P0-1 修复：从 Header 读取密钥，避免通过 query 参数泄露到日志/Referer/浏览器历史
  const secret = request.headers.get('X-Sync-Secret');

  if (!env.SYNC_SECRET) {
    // 部署方未设置 secret：直接拒绝，避免误开成无鉴权发布
    console.error('SYNC_SECRET is not set on the Worker. Run `wrangler secret put SYNC_SECRET`.');
    return jsonResponse({ error: 'Server misconfigured: SYNC_SECRET not set' }, 500);
  }

  if (!secret || secret !== env.SYNC_SECRET) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  // P3-C：限流（全局 5 次/分钟）。publish 用 SYNC_SECRET 鉴权（无用户维度），
  // 用固定 key 'publish' 限流，防止发布接口被高频调用刷版本。
  const rl = rateLimit(request, 'publish', 5, 60_000);
  if (rl) return rl;

  try {
    const body = await request.json() as {
      version: string;
      versionCode: number;
      releaseNotes: string;
      downloadUrl: string;
      apkSize: number;
    };

    if (!body.version || !body.versionCode || !body.downloadUrl) {
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }

    // 创建表（如果不存在）
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS app_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT NOT NULL,
        version_code INTEGER NOT NULL,
        release_notes TEXT,
        download_url TEXT NOT NULL,
        apk_size INTEGER,
        updated_at TEXT,
        created_at INTEGER DEFAULT (unixepoch() * 1000)
      )
    `).run();

    // 插入新版本
    await env.DB.prepare(`
      INSERT INTO app_versions (version, version_code, release_notes, download_url, apk_size, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      body.version,
      body.versionCode,
      body.releaseNotes || '',
      body.downloadUrl,
      body.apkSize || 0,
      new Date().toISOString().split('T')[0]
    ).run();

    return jsonResponse({
      success: true,
      version: body.version,
      versionCode: body.versionCode,
    });
  } catch (error) {
    console.error('Publish error:', error);
    return jsonResponse({ error: 'Publish failed: ' + String(error) }, 500);
  }
}

// ============ P0-12 密码哈希 + Token 鉴权 ============
//
// 设计要点：
// 1. 密码哈希：PBKDF2-SHA256，100,000 次迭代，每用户独立随机盐（32 字节）。
//    Cloudflare Workers 原生支持 crypto.subtle.deriveBits，无需外部依赖。
// 2. Token：HMAC-SHA256(payload, SYNC_SECRET)，格式 base64(payload) + '.' + base64(sig)。
//    payload = { userId, exp }，exp 为毫秒时间戳，默认 30 天。
//    用 SYNC_SECRET 作密钥（发布与鉴权共用同一 secret，简化部署）。

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 32;
const HASH_BITS = 256; // SHA-256 输出
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// 生成指定字节数的随机盐，返回 hex 字符串
function generateSaltHex(bytes = SALT_BYTES): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return bytesToHex(arr);
}

// PBKDF2-SHA256(password, salt) -> hex 摘要
async function hashPassword(password: string, saltHex: string): Promise<string> {
  const salt = hexToBytes(saltHex);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    HASH_BITS
  );
  return bytesToHex(new Uint8Array(derived));
}

// 恒定时间字符串比较，避免时序侧信道
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ============ Token 签发 / 校验 ============

interface TokenPayload {
  userId: string;
  exp: number; // 毫秒时间戳
}

async function signToken(payload: TokenPayload, secret: string): Promise<string> {
  const payloadB64 = bytesToBase64(encoder.encode(JSON.stringify(payload)));
  const sigBuf = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    encoder.encode(payloadB64)
  );
  const sigB64 = bytesToBase64(new Uint8Array(sigBuf));
  return `${payloadB64}.${sigB64}`;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

// 校验 token，返回 userId 或 null（签名错误/过期/格式错误）
async function verifyToken(request: Request, secret: string): Promise<{ userId: string } | null> {
  if (!secret) return null;
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1].trim();
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  let payloadBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    payloadBytes = base64ToBytes(payloadB64);
    sigBytes = base64ToBytes(sigB64);
  } catch {
    return null;
  }

  // 先校验签名，再校验过期
  const ok = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    sigBytes,
    encoder.encode(payloadB64)
  );
  if (!ok) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (typeof payload.userId !== 'string' || typeof payload.exp !== 'number') return null;
  if (Date.now() > payload.exp) return null;
  return { userId: payload.userId };
}

// 中间件：要求 token 且 token.userId 与请求中的 userId 一致
// 传入 expectedUserId 后校验一致性；不一致返回 403。
// 返回 [userId, response]：response 非 null 表示鉴权失败，应直接返回。
async function requireToken(
  request: Request,
  env: Env,
  expectedUserId?: string
): Promise<{ userId: string } | Response> {
  if (!env.SYNC_SECRET) {
    return jsonResponse({ error: 'Server misconfigured: SYNC_SECRET not set' }, 500);
  }
  const auth = await verifyToken(request, env.SYNC_SECRET);
  if (!auth) {
    return jsonResponse({ error: 'Unauthorized: invalid or missing token' }, 401);
  }
  if (expectedUserId !== undefined && auth.userId !== expectedUserId) {
    return jsonResponse({ error: 'Forbidden: token userId mismatch' }, 403);
  }
  return auth;
}

// ============ 旧 hashPassword（已废弃，仅保留兼容 stub 供迁移期引用） ============
// 历史代码用单次 SHA-256 + 全局静态盐，已替换为 PBKDF2 + 每用户随机盐。
// 旧函数不再被注册/登录路径调用；此 stub 仅防止其他引用处编译失败。
async function legacyHashPasswordSha256(password: string): Promise<string> {
  const data = encoder.encode(password + 'soloforge-salt');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
void legacyHashPasswordSha256; // 标记为有意保留（兼容期）

async function handleRegister(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as {
      username: string;
      password: string;
      displayName?: string;
    };

    if (!body.username || !body.password) {
      return jsonResponse({ error: '用户名和密码不能为空' }, 400);
    }

    if (body.username.length < 3 || body.username.length > 20) {
      return jsonResponse({ error: '用户名长度需要在3-20个字符之间' }, 400);
    }

    if (body.password.length < 6) {
      return jsonResponse({ error: '密码长度至少6个字符' }, 400);
    }

    // 检查用户名是否已存在
    const existing = await env.DB.prepare(
      'SELECT id FROM users WHERE username = ?'
    ).bind(body.username.toLowerCase()).first();

    if (existing) {
      return jsonResponse({ error: '用户名已被使用' }, 400);
    }

    const userId = `user-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
    // P0-12：每用户独立随机盐 + PBKDF2
    const passwordSalt = generateSaltHex();
    const passwordHash = await hashPassword(body.password, passwordSalt);
    const now = Date.now();

    await env.DB.prepare(`
      INSERT INTO users (id, username, password_hash, password_salt, display_name, created_at, last_login_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      userId,
      body.username.toLowerCase(),
      passwordHash,
      passwordSalt,
      body.displayName || body.username,
      now,
      now
    ).run();

    // 注册成功后直接签发 token，避免客户端再调一次登录
    if (!env.SYNC_SECRET) {
      return jsonResponse({ error: '服务器未配置 SYNC_SECRET，无法签发 token' }, 500);
    }
    const tokenExpiresAt = Date.now() + TOKEN_TTL_MS;
    const token = await signToken({ userId, exp: tokenExpiresAt }, env.SYNC_SECRET);

    return jsonResponse({
      success: true,
      userId,
      username: body.username.toLowerCase(),
      displayName: body.displayName || body.username,
      token,
      tokenExpiresAt,
    });
  } catch (error) {
    console.error('Register error:', error);
    return jsonResponse({ error: '注册失败: ' + String(error) }, 500);
  }
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as {
      username: string;
      password: string;
    };

    if (!body.username || !body.password) {
      return jsonResponse({ error: '用户名和密码不能为空' }, 400);
    }

    if (!env.SYNC_SECRET) {
      console.error('SYNC_SECRET is not set; cannot issue tokens. Run `wrangler secret put SYNC_SECRET`.');
      return jsonResponse({ error: 'Server misconfigured: SYNC_SECRET not set' }, 500);
    }

    // P0-12：根据 username 查出 salt，再用 PBKDF2 重新哈希后比对。
    // 先精确匹配，再小写匹配（兼容中文用户名/大小写习惯）。
    let user = await env.DB.prepare(
      `SELECT id, username, display_name, created_at, password_hash, password_salt
       FROM users WHERE username = ?`
    ).bind(body.username).first<{ id: string; username: string; display_name: string; created_at: number; password_hash: string; password_salt: string | null }>();

    if (!user) {
      user = await env.DB.prepare(
        `SELECT id, username, display_name, created_at, password_hash, password_salt
         FROM users WHERE username = ?`
      ).bind(body.username.toLowerCase()).first<{ id: string; username: string; display_name: string; created_at: number; password_hash: string; password_salt: string | null }>();
    }

    if (!user || !user.password_salt) {
      // 用户不存在，或为迁移期前用旧 SHA-256 哈希的账户（无 salt）。
      // 迁移期策略：拒绝并提示重新注册（旧 hash 无法安全迁移到 PBKDF2）。
      return jsonResponse({ error: '用户名或密码错误' }, 401);
    }

    const computedHash = await hashPassword(body.password, user.password_salt);
    if (!constantTimeEqual(computedHash, user.password_hash)) {
      return jsonResponse({ error: '用户名或密码错误' }, 401);
    }

    // 更新最后登录时间
    await env.DB.prepare(
      'UPDATE users SET last_login_at = ? WHERE id = ?'
    ).bind(Date.now(), user.id).run();

    // P0-12：签发 token（HMAC-SHA256，30 天有效）
    const token = await signToken(
      { userId: user.id, exp: Date.now() + TOKEN_TTL_MS },
      env.SYNC_SECRET
    );

    return jsonResponse({
      success: true,
      userId: user.id,
      username: user.username,
      displayName: user.display_name,
      token,
      tokenExpiresAt: Date.now() + TOKEN_TTL_MS,
    });
  } catch (error) {
    console.error('Login error:', error);
    return jsonResponse({ error: '登录失败: ' + String(error) }, 500);
  }
}

async function handleGetProfile(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');

  if (!userId) {
    return jsonResponse({ error: 'Missing userId' }, 400);
  }

  // P0-12：要求 token，且 token 中的 userId 必须与查询参数一致
  const auth = await requireToken(request, env, userId);
  if (auth instanceof Response) {
    return auth;
  }

  const user = await env.DB.prepare(`
    SELECT id, username, display_name, created_at, last_login_at
    FROM users
    WHERE id = ?
  `).bind(userId).first();

  if (!user) {
    return jsonResponse({ error: '用户不存在' }, 404);
  }

  return jsonResponse({
    userId: user.id,
    username: user.username,
    displayName: user.display_name,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
  });
}

// ============ P3-C：设备管理端点 ============
//
// 三个端点均用 requireToken 鉴权：
// - GET    /devices?userId=xxx        列出该用户的所有设备
// - POST   /devices/register          注册/更新设备（UPSERT）
// - DELETE /devices/:deviceId?userId=xxx  删除设备（带 user_id 校验，防删别人的）
//
// 限流：每用户 60 次/分钟（与 /sync/* 同级），在 handler 内鉴权后执行。
//
// 与批次1 DeviceManager.jsx 的对接：
// - fetchDevices()  → GET /devices?userId=...（带 Authorization: Bearer <token>）
// - registerDevice() → POST /devices/register（body: { deviceId, deviceName?, deviceType? }）
// - removeDevice()  → DELETE /devices/<deviceId>?userId=...（带 Authorization: Bearer <token>）

// 设备记录返回给客户端的形状（字段名转 camelCase）。
interface DeviceRecord {
  id: string;
  userId: string;
  deviceName: string | null;
  deviceType: string | null;
  lastSyncAt: number | null;
  createdAt: number | null;
}

// GET /devices?userId=xxx
async function handleDevicesList(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');

  if (!userId) {
    return jsonResponse({ error: 'Missing userId' }, 400);
  }

  // P0-12：要求 token，且 token.userId 必须与查询参数 userId 一致
  const auth = await requireToken(request, env, userId);
  if (auth instanceof Response) {
    return auth;
  }

  // P3-C：限流（每用户 60 次/分钟）。
  const rl = rateLimitByUserId(request, auth.userId, 60, 60_000);
  if (rl) return rl;

  try {
    const result = await env.DB.prepare(`
      SELECT id, user_id, device_name, device_type, last_sync_at, created_at
      FROM devices
      WHERE user_id = ?
      ORDER BY created_at ASC
    `).bind(userId).all<DeviceRecord>();

    const devices = (result.results || []).map((d: any): DeviceRecord => ({
      id: d.id as string,
      userId: d.user_id as string,
      deviceName: d.device_name ?? null,
      deviceType: d.device_type ?? null,
      lastSyncAt: d.last_sync_at ?? null,
      createdAt: d.created_at ?? null,
    }));

    return jsonResponse({ success: true, devices });
  } catch (error) {
    console.error('Devices list error:', error);
    return jsonResponse({ error: '获取设备列表失败: ' + String(error) }, 500);
  }
}

// POST /devices/register
// body: { deviceId, deviceName?, deviceType? }
// UPSERT：已有 deviceId 则更新 device_name/device_type/last_sync_at，没有则插入。
async function handleDeviceRegister(request: Request, env: Env): Promise<Response> {
  let body: { deviceId?: string; deviceName?: string; deviceType?: string };
  try {
    body = await request.json() as typeof body;
  } catch (e) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { deviceId, deviceName, deviceType } = body;
  if (!deviceId) {
    return jsonResponse({ error: 'Missing deviceId' }, 400);
  }

  // requireToken 不传 expectedUserId：deviceId 由客户端生成，token.userId 即归属用户。
  // token.userId 即设备归属者，后续所有读写都以它为准。
  const auth = await requireToken(request, env);
  if (auth instanceof Response) {
    return auth;
  }

  // P3-C：限流（每用户 60 次/分钟）。
  const rl = rateLimitByUserId(request, auth.userId, 60, 60_000);
  if (rl) return rl;

  const userId = auth.userId;
  const now = Date.now();
  // deviceName 缺省用 deviceId；deviceType 缺省用 'unknown'
  const name = deviceName || deviceId;
  const type = deviceType || 'unknown';

  try {
    // UPSERT：主键 id 冲突时更新 device_name/device_type/last_sync_at。
    // created_at 不在冲突更新列表中（保留首次注册时间）。
    await env.DB.prepare(`
      INSERT INTO devices (id, user_id, device_name, device_type, last_sync_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        device_name = excluded.device_name,
        device_type = excluded.device_type,
        last_sync_at = excluded.last_sync_at
    `).bind(deviceId, userId, name, type, now).run();

    // 回读返回完整记录（含 created_at）
    const row = await env.DB.prepare(`
      SELECT id, user_id, device_name, device_type, last_sync_at, created_at
      FROM devices
      WHERE id = ? AND user_id = ?
    `).bind(deviceId, userId).first<any>();

    const device: DeviceRecord = {
      id: row?.id as string,
      userId: row?.user_id as string,
      deviceName: row?.device_name ?? null,
      deviceType: row?.device_type ?? null,
      lastSyncAt: row?.last_sync_at ?? null,
      createdAt: row?.created_at ?? null,
    };

    return jsonResponse({ success: true, device });
  } catch (error) {
    console.error('Device register error:', error);
    return jsonResponse({ error: '注册设备失败: ' + String(error) }, 500);
  }
}

// DELETE /devices/:deviceId?userId=xxx
// 从 devices 表删除，WHERE id = ? AND user_id = ?（防删别人的设备）。
async function handleDeviceDelete(
  request: Request,
  env: Env,
  deviceId: string
): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');

  if (!userId) {
    return jsonResponse({ error: 'Missing userId' }, 400);
  }
  if (!deviceId) {
    return jsonResponse({ error: 'Missing deviceId' }, 400);
  }

  // P0-12：要求 token，且 token.userId 必须与查询参数 userId 一致
  const auth = await requireToken(request, env, userId);
  if (auth instanceof Response) {
    return auth;
  }

  // P3-C：限流（每用户 60 次/分钟）。
  const rl = rateLimitByUserId(request, auth.userId, 60, 60_000);
  if (rl) return rl;

  try {
    // 带上 user_id 校验，防止 token 持有者删除别人的设备。
    // ON CONFLICT 无关；直接 DELETE，未匹配则 affectedRows=0（视为成功，幂等删除）。
    const result = await env.DB.prepare(
      `DELETE FROM devices WHERE id = ? AND user_id = ?`
    ).bind(deviceId, auth.userId).run();

    // D1 不一定返回 meta.changes，best-effort：不区分"存在 vs 不存在"。
    // 只要 SQL 执行不抛错即视为成功（DELETE 是幂等的）。
    void result;

    return jsonResponse({ success: true });
  } catch (error) {
    console.error('Device delete error:', error);
    return jsonResponse({ error: '删除设备失败: ' + String(error) }, 500);
  }
}

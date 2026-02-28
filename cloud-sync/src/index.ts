/**
 * SoloForge 云同步 API - Cloudflare Workers
 * 
 * 端点:
 * - POST /sync/push - 上传本地变更
 * - POST /sync/pull - 拉取远程变更
 * - GET /sync/status - 获取同步状态
 * - GET /app/version - 检查应用版本
 * - GET /app/download - 下载最新 APK
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
  data: {
    messages?: MessageRecord[];
    conversations?: ConversationRecord[];
    agents?: AgentRecord[];
    bossConfig?: BossConfigRecord;
  };
}

interface SyncPullRequest {
  userId: string;
  deviceId: string;
  since: number; // 上次同步时间戳
}

interface MessageRecord {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  timestamp: number;
  updatedAt: number;
  deleted?: boolean;
}

interface ConversationRecord {
  id: string;
  agentId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
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
  deleted?: boolean;
}

interface BossConfigRecord {
  name: string;
  avatar?: string;
  avatarThumb?: string;
  avatarFull?: string;
  updatedAt: number;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
        return jsonResponse({ status: 'ok', timestamp: Date.now() });
      }

      if (path === '/app/version') {
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

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (error) {
      console.error('Sync error:', error);
      return jsonResponse({ error: String(error) }, 500);
    }
  },
};

async function handlePush(request: Request, env: Env): Promise<Response> {
  const body: SyncPushRequest = await request.json();
  const { userId, deviceId, deviceType, data } = body;

  if (!userId || !deviceId) {
    return jsonResponse({ error: 'Missing userId or deviceId' }, 400);
  }

  const now = Date.now();
  const stats = { messages: 0, conversations: 0, agents: 0, boss: 0 };

  // 更新设备信息
  await env.DB.prepare(`
    INSERT INTO devices (id, user_id, device_name, device_type, last_sync_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET last_sync_at = ?
  `).bind(deviceId, userId, deviceId, deviceType, now, now).run();

  // 同步会话
  if (data.conversations?.length) {
    for (const conv of data.conversations) {
      await env.DB.prepare(`
        INSERT INTO conversations (id, user_id, agent_id, title, created_at, updated_at, deleted)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          agent_id = CASE WHEN excluded.updated_at > conversations.updated_at THEN excluded.agent_id ELSE conversations.agent_id END,
          title = CASE WHEN excluded.updated_at > conversations.updated_at THEN excluded.title ELSE conversations.title END,
          updated_at = MAX(excluded.updated_at, conversations.updated_at),
          deleted = CASE WHEN excluded.updated_at > conversations.updated_at THEN excluded.deleted ELSE conversations.deleted END
      `).bind(
        conv.id, userId, conv.agentId, conv.title,
        conv.createdAt, conv.updatedAt, conv.deleted ? 1 : 0
      ).run();
      stats.conversations++;
    }
  }

  // 同步消息
  if (data.messages?.length) {
    for (const msg of data.messages) {
      await env.DB.prepare(`
        INSERT INTO messages (id, user_id, conversation_id, role, content, timestamp, updated_at, deleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          content = CASE WHEN excluded.updated_at > messages.updated_at THEN excluded.content ELSE messages.content END,
          updated_at = MAX(excluded.updated_at, messages.updated_at),
          deleted = CASE WHEN excluded.updated_at > messages.updated_at THEN excluded.deleted ELSE messages.deleted END
      `).bind(
        msg.id, userId, msg.conversationId, msg.role, msg.content,
        msg.timestamp, msg.updatedAt, msg.deleted ? 1 : 0
      ).run();
      stats.messages++;
    }
  }

  // 同步 Agents
  if (data.agents?.length) {
    for (const agent of data.agents) {
      await env.DB.prepare(`
        INSERT INTO agents (id, user_id, name, title, role, level, department, departments, avatar, avatar_thumb, avatar_full, description, model, status, updated_at, deleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id, user_id) DO UPDATE SET
          name = CASE WHEN excluded.updated_at > agents.updated_at THEN excluded.name ELSE agents.name END,
          title = CASE WHEN excluded.updated_at > agents.updated_at THEN excluded.title ELSE agents.title END,
          role = CASE WHEN excluded.updated_at > agents.updated_at THEN excluded.role ELSE agents.role END,
          level = CASE WHEN excluded.updated_at > agents.updated_at THEN excluded.level ELSE agents.level END,
          department = CASE WHEN excluded.updated_at > agents.updated_at THEN excluded.department ELSE agents.department END,
          departments = CASE WHEN excluded.updated_at > agents.updated_at THEN excluded.departments ELSE agents.departments END,
          avatar = CASE WHEN excluded.updated_at > agents.updated_at THEN excluded.avatar ELSE agents.avatar END,
          avatar_thumb = CASE WHEN excluded.updated_at > agents.updated_at THEN excluded.avatar_thumb ELSE agents.avatar_thumb END,
          avatar_full = CASE WHEN excluded.updated_at > agents.updated_at THEN excluded.avatar_full ELSE agents.avatar_full END,
          description = CASE WHEN excluded.updated_at > agents.updated_at THEN excluded.description ELSE agents.description END,
          model = CASE WHEN excluded.updated_at > agents.updated_at THEN excluded.model ELSE agents.model END,
          status = CASE WHEN excluded.updated_at > agents.updated_at THEN excluded.status ELSE agents.status END,
          updated_at = MAX(excluded.updated_at, agents.updated_at),
          deleted = CASE WHEN excluded.updated_at > agents.updated_at THEN excluded.deleted ELSE agents.deleted END
      `).bind(
        agent.id, userId, agent.name, agent.title || null, agent.role || null,
        agent.level || null, agent.department || null,
        agent.departments ? JSON.stringify(agent.departments) : null,
        agent.avatar || null, agent.avatarThumb || null, agent.avatarFull || null,
        agent.description || null, agent.model || null, agent.status || null,
        agent.updatedAt, agent.deleted ? 1 : 0
      ).run();
      stats.agents++;
    }
  }

  // 同步 Boss 配置
  if (data.bossConfig) {
    const boss = data.bossConfig;
    await env.DB.prepare(`
      INSERT INTO boss_config (user_id, name, avatar, avatar_thumb, avatar_full, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        name = CASE WHEN excluded.updated_at > boss_config.updated_at THEN excluded.name ELSE boss_config.name END,
        avatar = CASE WHEN excluded.updated_at > boss_config.updated_at THEN excluded.avatar ELSE boss_config.avatar END,
        avatar_thumb = CASE WHEN excluded.updated_at > boss_config.updated_at THEN excluded.avatar_thumb ELSE boss_config.avatar_thumb END,
        avatar_full = CASE WHEN excluded.updated_at > boss_config.updated_at THEN excluded.avatar_full ELSE boss_config.avatar_full END,
        updated_at = MAX(excluded.updated_at, boss_config.updated_at)
    `).bind(
      userId, boss.name, boss.avatar || null, boss.avatarThumb || null, boss.avatarFull || null, boss.updatedAt
    ).run();
    stats.boss = 1;
  }

  // 更新同步元数据
  for (const dataType of ['messages', 'conversations', 'agents', 'boss']) {
    await env.DB.prepare(`
      INSERT INTO sync_meta (user_id, device_id, data_type, last_sync_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, device_id, data_type) DO UPDATE SET last_sync_at = ?
    `).bind(userId, deviceId, dataType, now, now).run();
  }

  return jsonResponse({
    success: true,
    stats,
    syncedAt: now,
  });
}

async function handlePull(request: Request, env: Env): Promise<Response> {
  const body: SyncPullRequest = await request.json();
  const { userId, deviceId, since } = body;

  if (!userId || !deviceId) {
    return jsonResponse({ error: 'Missing userId or deviceId' }, 400);
  }

  const sinceTimestamp = since || 0;

  // 获取更新的会话
  const conversations = await env.DB.prepare(`
    SELECT id, agent_id as agentId, title, created_at as createdAt, updated_at as updatedAt, deleted
    FROM conversations
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, sinceTimestamp).all();

  // 获取更新的消息
  const messages = await env.DB.prepare(`
    SELECT id, conversation_id as conversationId, role, content, timestamp, updated_at as updatedAt, deleted
    FROM messages
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, sinceTimestamp).all();

  // 获取更新的 Agents
  const agentsRaw = await env.DB.prepare(`
    SELECT id, name, title, role, level, department, departments, avatar, avatar_thumb as avatarThumb, avatar_full as avatarFull, description, model, status, updated_at as updatedAt, deleted
    FROM agents
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC
  `).bind(userId, sinceTimestamp).all();

  const agents = agentsRaw.results.map((a: any) => ({
    ...a,
    departments: a.departments ? JSON.parse(a.departments) : undefined,
  }));

  // 获取 Boss 配置
  const bossResult = await env.DB.prepare(`
    SELECT name, avatar, avatar_thumb as avatarThumb, avatar_full as avatarFull, updated_at as updatedAt
    FROM boss_config
    WHERE user_id = ? AND updated_at > ?
  `).bind(userId, sinceTimestamp).first();

  const now = Date.now();

  return jsonResponse({
    success: true,
    data: {
      conversations: conversations.results,
      messages: messages.results,
      agents,
      bossConfig: bossResult || null,
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

  // 获取各数据类型的数量
  const convCount = await env.DB.prepare(`SELECT COUNT(*) as count FROM conversations WHERE user_id = ? AND deleted = 0`).bind(userId).first();
  const msgCount = await env.DB.prepare(`SELECT COUNT(*) as count FROM messages WHERE user_id = ? AND deleted = 0`).bind(userId).first();
  const agentCount = await env.DB.prepare(`SELECT COUNT(*) as count FROM agents WHERE user_id = ? AND deleted = 0`).bind(userId).first();

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
    },
    deviceSync: deviceSync?.results || [],
    serverTime: Date.now(),
  });
}

async function handleAppPublish(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret');
  
  if (secret !== env.SYNC_SECRET) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

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

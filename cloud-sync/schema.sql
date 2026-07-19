-- SoloForge 云同步数据库 Schema
--
-- 历史版本：
-- - P0-12：users 表新增 password_salt 列支持 PBKDF2 + 每用户随机盐（见 0001 迁移）
-- - P0-11：各数据表新增 client_updated_at 列（见 0002 迁移）
-- - P2-4a：messages / conversations / agents 新增 (user_id, updated_at) 复合索引（见 0003 迁移）
-- - P2-4b：conversations / messages / agents / boss_config 新增 server_rev 列（见 0004 迁移）
-- - P2-4c：conversations / messages / agents / boss_config 新增 company_id 列；
--          boss_config 主键改为 (user_id, company_id) 复合主键（见 0005 迁移）
-- - P2-6：新增 sync_documents 通用文档同步表（operations / projects / budgets 整体文档同步，见 0006 迁移）
--
-- 注：本 schema.sql 是"全量建表"语句（CREATE TABLE IF NOT EXISTS），用于全新部署。
--     已部署的库需按编号执行 migrations/ 下的增量迁移。

-- 用户表（P0-12 修复：新增 password_salt 列支持 PBKDF2 + 每用户随机盐）
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,      -- PBKDF2-SHA256 输出（hex）
  password_salt TEXT NOT NULL,      -- 每用户随机盐（hex，32 字节）
  display_name TEXT,
  created_at INTEGER,
  last_login_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- 用户/设备表
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_name TEXT,
  device_type TEXT, -- 'desktop' | 'mobile'
  last_sync_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

-- 会话表
-- P2-4b：新增 server_rev INTEGER DEFAULT 0（服务端单调修订号，用于 LWW）
-- P2-4c：新增 company_id TEXT（公司维度，默认 NULL 兼容旧数据）
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  title TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  client_updated_at INTEGER,  -- P0-11：客户端原始时间戳，仅用于调试
  server_rev INTEGER DEFAULT 0,  -- P2-4b：服务端单调修订号，LWW 判定依据
  company_id TEXT,            -- P2-4c：公司维度（NULL 表示未归属公司）
  deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at);
-- P2-4a：复合索引，优化 pull 的 WHERE user_id=? AND updated_at>? 查询
CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at);

-- 消息表
-- P2-4b：新增 server_rev INTEGER DEFAULT 0
-- P2-4c：新增 company_id TEXT
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL, -- 'user' | 'assistant' | 'system'
  content TEXT,
  timestamp INTEGER,
  updated_at INTEGER,
  client_updated_at INTEGER,  -- P0-11：客户端原始时间戳，仅用于调试
  server_rev INTEGER DEFAULT 0,  -- P2-4b：服务端单调修订号
  company_id TEXT,            -- P2-4c：公司维度
  deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_updated ON messages(updated_at);
-- P2-4a：复合索引，优化 pull 的 WHERE user_id=? AND updated_at>? 查询
CREATE INDEX IF NOT EXISTS idx_messages_user_updated ON messages(user_id, updated_at);

-- Agent 配置表
-- P2-4b：新增 server_rev INTEGER DEFAULT 0
-- P2-4c：新增 company_id TEXT
CREATE TABLE IF NOT EXISTS agents (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT,
  title TEXT,
  role TEXT,
  level TEXT,
  department TEXT,
  departments TEXT, -- JSON array
  avatar TEXT,
  avatar_thumb TEXT,
  avatar_full TEXT,
  description TEXT,
  model TEXT,
  status TEXT,
  config TEXT, -- JSON for extra fields
  updated_at INTEGER,
  client_updated_at INTEGER,  -- P0-11：客户端原始时间戳，仅用于调试
  server_rev INTEGER DEFAULT 0,  -- P2-4b：服务端单调修订号
  company_id TEXT,            -- P2-4c：公司维度
  deleted INTEGER DEFAULT 0,
  PRIMARY KEY (id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_agents_user ON agents(user_id);
CREATE INDEX IF NOT EXISTS idx_agents_updated ON agents(updated_at);
-- P2-4a：复合索引，优化 pull 的 WHERE user_id=? AND updated_at>? 查询
CREATE INDEX IF NOT EXISTS idx_agents_user_updated ON agents(user_id, updated_at);

-- Boss 配置表
-- P2-4b：新增 server_rev INTEGER DEFAULT 0
-- P2-4c：主键从 user_id 单例改为 (user_id, company_id) 复合主键
--        company_id NOT NULL DEFAULT ''（旧数据统一归一化为 '' 保持单例语义）
CREATE TABLE IF NOT EXISTS boss_config (
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL DEFAULT '',
  name TEXT,
  avatar TEXT,
  avatar_thumb TEXT,
  avatar_full TEXT,
  config TEXT, -- JSON for extra fields
  updated_at INTEGER,
  client_updated_at INTEGER,  -- P0-11：客户端原始时间戳，仅用于调试
  server_rev INTEGER DEFAULT 0,  -- P2-4b：服务端单调修订号
  PRIMARY KEY (user_id, company_id)
);

-- 同步元数据表
CREATE TABLE IF NOT EXISTS sync_meta (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  data_type TEXT NOT NULL, -- 'messages' | 'conversations' | 'agents' | 'boss' | 'documents'
  last_sync_at INTEGER,
  PRIMARY KEY (user_id, device_id, data_type)
);

-- 通用文档同步表（P2-6）
-- 用途：把高价值"整体文档"类数据加入云同步（operations / projects / budgets 等），
--       避免为每类数据单独建表。每类数据以 (user_id, company_id, data_type) 为主键单条记录，
--       content 字段存整体 JSON 字符串，LWW 基于 server_rev（同其它数据表）。
-- data_type 枚举：'operations' | 'projects' | 'budgets'（可扩展）
CREATE TABLE IF NOT EXISTS sync_documents (
  id TEXT PRIMARY KEY,          -- {user_id}:{company_id}:{data_type}（company_id 为空时用 ''）
  user_id TEXT NOT NULL,
  company_id TEXT,
  data_type TEXT NOT NULL,      -- 'operations' | 'projects' | 'budgets'
  content TEXT NOT NULL,        -- JSON 字符串
  deleted INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL,
  server_rev INTEGER DEFAULT 0,
  client_updated_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_sync_docs_user_updated ON sync_documents(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_sync_docs_user_type ON sync_documents(user_id, data_type);

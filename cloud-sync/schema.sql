-- SoloForge 云同步数据库 Schema

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
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  title TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at);

-- 消息表
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL, -- 'user' | 'assistant' | 'system'
  content TEXT,
  timestamp INTEGER,
  updated_at INTEGER,
  deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_updated ON messages(updated_at);

-- Agent 配置表
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
  deleted INTEGER DEFAULT 0,
  PRIMARY KEY (id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_agents_user ON agents(user_id);
CREATE INDEX IF NOT EXISTS idx_agents_updated ON agents(updated_at);

-- Boss 配置表
CREATE TABLE IF NOT EXISTS boss_config (
  user_id TEXT PRIMARY KEY,
  name TEXT,
  avatar TEXT,
  avatar_thumb TEXT,
  avatar_full TEXT,
  config TEXT, -- JSON for extra fields
  updated_at INTEGER
);

-- 同步元数据表
CREATE TABLE IF NOT EXISTS sync_meta (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  data_type TEXT NOT NULL, -- 'messages' | 'conversations' | 'agents' | 'boss'
  last_sync_at INTEGER,
  PRIMARY KEY (user_id, device_id, data_type)
);

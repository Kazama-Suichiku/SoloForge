-- P2-4c 迁移：为 conversations / messages / agents / boss_config 添加 company_id 列
--
-- 用途：支持公司（组织）维度数据隔离。
-- - conversations / messages / agents：company_id TEXT（默认 NULL，兼容旧数据，表示未归属公司）。
-- - boss_config：从 user_id 单例主键改为 (user_id, company_id) 复合主键。
--   为使复合主键正确生效（SQLite 中 NULL 不参与唯一约束），boss_config 的 company_id
--   使用 NOT NULL DEFAULT ''，已有数据在迁移时 NULL → ''。
--
-- 运行方式：
--   npx wrangler d1 execute soloforge-sync --remote --file=./migrations/0005_add_company_id.sql
--   npx wrangler d1 execute soloforge-sync --local   --file=./migrations/0005_add_company_id.sql
--
-- 说明：
-- - conversations/messages/agents 的 ALTER TABLE ADD COLUMN 可安全重跑（重复执行会报
--   "duplicate column name"，不影响数据；可忽略或用 IF NOT EXISTS 逻辑包裹）。
-- - boss_config 的主键变更需要重建表（SQLite 不支持 ALTER TABLE 修改主键），
--   采用"建新表 → 拷贝 → 删旧表 → 重命名"标准模式。
-- - 该迁移应在 0004（server_rev）之后执行，确保新表包含 server_rev 列。

-- 1. 为 conversations / messages / agents 添加 company_id（nullable，兼容旧数据）
ALTER TABLE conversations ADD COLUMN company_id TEXT;
ALTER TABLE messages      ADD COLUMN company_id TEXT;
ALTER TABLE agents        ADD COLUMN company_id TEXT;

-- 2. boss_config：重建表以修改主键
--    新表使用 (user_id, company_id) 复合主键，company_id NOT NULL DEFAULT ''
--    已有数据中 NULL company_id 归一化为 ''，保持单例语义。
CREATE TABLE IF NOT EXISTS boss_config_new (
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL DEFAULT '',
  name TEXT,
  avatar TEXT,
  avatar_thumb TEXT,
  avatar_full TEXT,
  config TEXT,
  updated_at INTEGER,
  client_updated_at INTEGER,
  server_rev INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, company_id)
);

-- 拷贝已有数据：旧表无 company_id 列，统一填 ''（保持单例语义）
INSERT OR IGNORE INTO boss_config_new
  (user_id, company_id, name, avatar, avatar_thumb, avatar_full, config, updated_at, client_updated_at, server_rev)
SELECT
  user_id,
  '',
  name, avatar, avatar_thumb, avatar_full, config, updated_at, client_updated_at,
  COALESCE(server_rev, 0)
FROM boss_config;

-- 删除旧表，重命名新表
DROP TABLE boss_config;
ALTER TABLE boss_config_new RENAME TO boss_config;

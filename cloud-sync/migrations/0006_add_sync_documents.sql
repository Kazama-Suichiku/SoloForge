-- P2-6 迁移：新增 sync_documents 通用文档同步表
--
-- 用途：把高价值"整体文档"类数据加入云同步（operations / projects / budgets）。
--   每类数据以 (user_id, company_id, data_type) 为主键单条记录，content 存整体 JSON。
--   LWW 基于 server_rev（同其它数据表），deleted 支持软删除，client_updated_at 保留客户端时间戳。
--   id = "{user_id}:{company_id|''}:{data_type}"，由 Worker 端生成。
--
-- 运行方式：
--   npx wrangler d1 execute soloforge-sync --remote --file=./migrations/0006_add_sync_documents.sql
--   npx wrangler d1 execute soloforge-sync --local   --file=./migrations/0006_add_sync_documents.sql
--
-- 说明：
-- - 本迁移只新建表和索引，不影响已有数据。
-- - CREATE TABLE/INDEX IF NOT EXISTS 可安全重跑（重复执行不会报错，也不改已存在表结构）。
-- - 该迁移应在 0005（company_id）之后执行。

CREATE TABLE IF NOT EXISTS sync_documents (
  id TEXT PRIMARY KEY,          -- {user_id}:{company_id|''}:{data_type}
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

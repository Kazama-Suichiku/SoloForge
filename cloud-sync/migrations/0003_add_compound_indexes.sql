-- P2-4a 迁移：为 messages / conversations / agents 添加 (user_id, updated_at) 复合索引
--
-- 用途：优化 pull 的 WHERE user_id=? AND updated_at>? 查询。
-- 原有的 idx_*_user + idx_*_updated 是两个独立索引，SQLite 查询规划器只能选其一；
-- 复合索引 (user_id, updated_at) 可同时满足两个过滤条件，避免全表扫描。
--
-- 运行方式：
--   npx wrangler d1 execute soloforge-sync --remote --file=./migrations/0003_add_compound_indexes.sql
--   npx wrangler d1 execute soloforge-sync --local   --file=./migrations/0003_add_compound_indexes.sql
--
-- 说明：
-- - IF NOT EXISTS 确保重复执行不报错。
-- - 索引建立是只读操作，不修改表数据，安全可重跑。

CREATE INDEX IF NOT EXISTS idx_messages_user_updated ON messages(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_agents_user_updated ON agents(user_id, updated_at);

-- P0-11 迁移：为 conversations / messages / agents / boss_config 添加 client_updated_at 列
--
-- 运行方式：
--   npx wrangler d1 execute soloforge-sync --remote --file=./migrations/0002_add_client_updated_at.sql
--   npx wrangler d1 execute soloforge-sync --local   --file=./migrations/0002_add_client_updated_at.sql
--
-- 说明：
-- - P0-11 修复后，服务端用 Date.now() 覆盖 updated_at，不再信任客户端时钟。
-- - 客户端原始时间戳保留到 client_updated_at，仅用于调试，不参与 LWW 比较。
-- - 所有列允许为 NULL，兼容已有数据。

ALTER TABLE conversations ADD COLUMN client_updated_at INTEGER;
ALTER TABLE messages      ADD COLUMN client_updated_at INTEGER;
ALTER TABLE agents        ADD COLUMN client_updated_at INTEGER;
ALTER TABLE boss_config   ADD COLUMN client_updated_at INTEGER;

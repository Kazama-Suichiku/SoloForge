-- P2-4b 迁移：为 conversations / messages / agents / boss_config 添加 server_rev 列
--
-- 用途：服务端单调修订号，用于 LWW（Last-Writer-Wins）冲突判断。
-- - 每次 upsert 成功（incoming server_rev >= existing server_rev）时 server_rev + 1。
-- - LWW 比较从 updated_at >= updated_at 改为 server_rev >= server_rev，
--   消除"同毫秒写入导致等时间静默丢写"问题。
-- - updated_at 仍保留，用于 pull 的 since 增量游标。
-- - 客户端从 pull 响应获取每个对象的 serverRev，下次 push 时带上；
--   服务端用 excluded.server_rev >= conversations.server_rev 判断是否接受。
--
-- 运行方式：
--   npx wrangler d1 execute soloforge-sync --remote --file=./migrations/0004_add_server_rev.sql
--   npx wrangler d1 execute soloforge-sync --local   --file=./migrations/0004_add_server_rev.sql
--
-- 说明：
-- - DEFAULT 0 兼容已有数据（已有行 server_rev = 0，即"初始版本"）。
-- - 客户端首次 push 已有对象时带 serverRev=0，服务端比较 0>=0 成立，接受并 +1。

ALTER TABLE conversations ADD COLUMN server_rev INTEGER DEFAULT 0;
ALTER TABLE messages      ADD COLUMN server_rev INTEGER DEFAULT 0;
ALTER TABLE agents        ADD COLUMN server_rev INTEGER DEFAULT 0;
ALTER TABLE boss_config   ADD COLUMN server_rev INTEGER DEFAULT 0;

-- P0-12 迁移：为 users 表添加 password_salt 列
-- 适用于已部署的数据库（首次同步功能上线时 users 表已存在但无 password_salt 列）
--
-- 运行方式：
--   npx wrangler d1 execute soloforge-sync --remote --file=./migrations/0001_add_password_salt.sql
--   npx wrangler d1 execute soloforge-sync --local --file=./migrations/0001_add_password_salt.sql
--
-- 说明：
-- - 旧用户记录的 password_hash 用单次 SHA-256 + 全局静态盐生成，无法直接迁移到 PBKDF2。
-- - 该列允许为空，便于旧记录暂时存在；但旧用户将无法用 PBKDF2 逻辑登录，
--   需要重新注册或通过 "忘记密码" 流程重置（待客户端支持后实现）。
-- - 强烈建议执行后清空或重建 users 表（如果有旧测试账户）：
--     DELETE FROM users;
--   然后让所有真实用户重新注册。

ALTER TABLE users ADD COLUMN password_salt TEXT;

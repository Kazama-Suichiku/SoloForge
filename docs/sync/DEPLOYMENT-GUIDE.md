# SoloForge 云同步部署指南

## 1. 创建 Supabase 项目

1. 访问 https://app.supabase.com
2. 点击 "New Project"
3. 填写项目信息:
   - Name: soloforge
   - Database Password: 设置强密码
   - Region: 选择最近的区域
4. 等待项目创建完成(约 2 分钟)

## 2. 配置数据库

1. 进入项目后,点击左侧 "SQL Editor"
2. 点击 "New Query"
3. 复制 `docs/sync/supabase-schema.sql` 的内容
4. 粘贴到编辑器并点击 "Run"
5. 确认所有表和策略创建成功

## 3. 获取 API 密钥

1. 点击左侧 "Settings" > "API"
2. 找到以下信息:
   - Project URL: `https://xxxxx.supabase.co`
   - anon public key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
3. 复制这两个值

## 4. 配置应用

编辑 `.env` 文件:

```env
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## 5. 启用邮箱认证

1. 点击 "Authentication" > "Providers"
2. 确保 "Email" 已启用
3. 配置邮件模板(可选):
   - 点击 "Email Templates"
   - 自定义注册确认邮件

## 6. 测试

1. 重启应用: `npm run dev`
2. 在设置页面点击"登录"
3. 注册新账号
4. 检查邮箱确认邮件
5. 登录并测试同步功能

## 7. 生产环境配置

### 自定义域名(可选)

1. 点击 "Settings" > "Custom Domains"
2. 添加自己的域名
3. 配置 DNS 记录

### 备份策略

1. 点击 "Database" > "Backups"
2. 启用自动备份
3. 设置备份保留时间

### 监控告警

1. 点击 "Settings" > "Integrations"
2. 配置 Webhook 或邮件告警
3. 监控 API 使用量和错误率

## 常见问题

### Q: 注册后收不到确认邮件?
A: 检查 Supabase 邮件配置,或使用自定义 SMTP

### Q: RLS 策略不生效?
A: 确保已执行 SQL 脚本中的所有 POLICY 语句

### Q: 同步失败?
A: 检查网络连接和 API 密钥是否正确

### Q: 如何迁移现有数据?
A: 使用 `sync:push` 手动推送本地数据到云端

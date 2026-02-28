# SoloForge 云同步服务部署指南

## 前置条件

1. Cloudflare 账号
2. Node.js 18+

## 部署步骤

### 1. 登录 Cloudflare

```bash
cd cloud-sync
npx wrangler login
```

这会打开浏览器让你授权 Wrangler CLI。

### 2. 创建 D1 数据库

```bash
npx wrangler d1 create soloforge-sync
```

执行后会输出类似：

```
[[d1_databases]]
binding = "DB"
database_name = "soloforge-sync"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**重要**: 复制 `database_id` 并更新 `wrangler.toml` 中的 `database_id` 值。

### 3. 初始化数据库表

```bash
npx wrangler d1 execute soloforge-sync --remote --file=./schema.sql
```

### 4. 部署 Worker

```bash
npx wrangler deploy
```

部署成功后会显示 Worker URL，类似：
```
https://soloforge-sync.your-subdomain.workers.dev
```

### 5. 配置客户端

#### 移动端

1. 打开 SoloForge Mobile 设置页面
2. 在「双向云同步」部分填写：
   - 同步服务器地址: `https://soloforge-sync.your-subdomain.workers.dev`
   - 用户 ID: 自定义（如 `my-user-123`），两端保持一致
3. 点击「保存配置」
4. 点击「立即同步」

#### 桌面端

在桌面版设置中配置相同的同步服务器地址和用户 ID。

## 验证部署

访问 Worker 健康检查端点：

```bash
curl https://soloforge-sync.your-subdomain.workers.dev/health
```

应返回：
```json
{"status":"ok","timestamp":1234567890}
```

## 故障排除

### 查看日志

```bash
npx wrangler tail
```

### 查看数据库内容

```bash
npx wrangler d1 execute soloforge-sync --remote --command "SELECT COUNT(*) FROM messages"
```

## 安全建议

1. 在生产环境中，建议修改 `wrangler.toml` 中的 `SYNC_SECRET`
2. 可以在 Worker 中添加 API Key 验证
3. 考虑使用 Cloudflare Access 保护 API

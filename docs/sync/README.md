# SoloForge 云同步功能

## 概述

SoloForge 云同步功能基于 Supabase 实现，提供跨设备的数据同步能力。

## 核心特性

✅ **用户认证**
- 邮箱注册/登录
- 会话持久化
- 自动恢复登录状态

✅ **数据同步**
- Agent 配置同步
- 权限配置同步
- 运营数据同步
- 聊天记录同步
- 协作记录同步

✅ **同步策略**
- 自动同步(每 5 分钟)
- 手动同步
- 实时推送
- 离线队列

✅ **冲突解决**
- Last Write Wins
- 版本号控制
- 冲突检测

✅ **安全性**
- Row Level Security (RLS)
- 数据隔离
- 加密传输

## 快速开始

### 1. 部署后端

参考 [部署指南](./DEPLOYMENT-GUIDE.md)

### 2. 配置应用

编辑 `.env`:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

### 3. 启动应用

```bash
npm run dev
```

### 4. 使用功能

1. 打开设置页面
2. 点击"登录/注册"
3. 创建账号并登录
4. 数据将自动同步到云端

## 文档

- [架构设计](./CLOUD-SYNC-ARCHITECTURE.md)
- [部署指南](./DEPLOYMENT-GUIDE.md)
- [使用示例](./USAGE-EXAMPLE.md)
- [数据库 Schema](./supabase-schema.sql)

## 技术栈

- **后端**: Supabase (PostgreSQL + Auth + Realtime)
- **SDK**: @supabase/supabase-js
- **存储**: electron-store (本地会话)
- **通信**: Electron IPC

## 目录结构

```
src/main/sync/
├── index.js                    # 模块入口
├── supabase-client.js          # Supabase 客户端
├── auth-manager.js             # 认证管理
├── sync-manager.js             # 同步核心
├── sync-ipc-handlers.js        # IPC 处理
└── data-adapters/              # 数据适配器
    ├── base-adapter.js
    └── agent-config-adapter.js

src/renderer/components/sync/
├── LoginDialog.jsx             # 登录对话框
└── SyncStatus.jsx              # 同步状态

docs/sync/
├── README.md                   # 本文档
├── CLOUD-SYNC-ARCHITECTURE.md  # 架构设计
├── DEPLOYMENT-GUIDE.md         # 部署指南
├── USAGE-EXAMPLE.md            # 使用示例
└── supabase-schema.sql         # 数据库 Schema
```

## API 参考

### 渲染进程 API

```javascript
// 初始化
await window.electron.sync.init({ supabaseUrl, supabaseKey });

// 注册
await window.electron.sync.register({ email, password });

// 登录
await window.electron.sync.login({ email, password });

// 登出
await window.electron.sync.logout();

// 获取用户
await window.electron.sync.getUser();

// 手动同步
await window.electron.sync.manualSync();

// 拉取数据
await window.electron.sync.pull();

// 推送数据
await window.electron.sync.push();

// 获取状态
await window.electron.sync.getStatus();

// 设置自动同步
await window.electron.sync.setAutoSync(true);
```

## 常见问题

### Q: 如何禁用云同步?
A: 不配置 SUPABASE_URL 和 SUPABASE_ANON_KEY 即可

### Q: 数据存储在哪里?
A: 本地数据在 ~/.soloforge/，云端数据在 Supabase

### Q: 如何备份数据?
A: Supabase 提供自动备份，也可以手动导出

### Q: 支持多账号吗?
A: 支持，登出后可以登录其他账号

## 贡献

欢迎提交 Issue 和 PR！

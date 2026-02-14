# SoloForge 云同步架构设计

## 技术选型

**后端服务**: Supabase
- PostgreSQL 数据库
- 内置用户认证（Auth）
- 实时订阅（Realtime）
- Row Level Security (RLS)
- RESTful API + SDK

## 数据模型

### 1. 用户表 (users)
Supabase Auth 自动管理

### 2. 同步数据表

#### agent_configs
```sql
- id: UUID (主键)
- user_id: UUID (外键)
- agent_id: TEXT
- config: JSONB
- updated_at: TIMESTAMP
- version: INTEGER
```

#### permissions, operations, chat_history, collaboration
类似结构，支持 JSONB 存储

## 同步策略

- **Last Write Wins**: 使用 updated_at 时间戳
- **版本号**: version 字段实现乐观锁
- **实时同步**: 本地修改后立即推送
- **离线支持**: 队列机制 + 自动重试

## 安全策略

Row Level Security (RLS) 确保用户只能访问自己的数据

## 目录结构

```
src/main/sync/
├── supabase-client.js
├── auth-manager.js
├── sync-manager.js
├── data-adapters/
└── sync-ipc-handlers.js
```

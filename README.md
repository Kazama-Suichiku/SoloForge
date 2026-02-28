# SoloForge Mobile

SoloForge 的移动端版本，使用 React Native 前端 + Express.js 云服务后端。

## 项目结构

```
SoloForge-Mobile/
├── server/                     # Express.js 后端
│   ├── package.json
│   ├── src/
│   │   ├── index.js           # 入口
│   │   ├── routes/            # API 路由
│   │   │   ├── chat.js        # 聊天 API
│   │   │   ├── agents.js      # Agent 管理 API
│   │   │   └── config.js      # 配置 API
│   │   ├── core/              # 核心业务
│   │   │   ├── chat/          # 聊天逻辑
│   │   │   ├── llm/           # LLM 提供者
│   │   │   ├── config/        # 配置存储
│   │   │   └── tools/         # 精简工具集
│   │   └── utils/
│   └── data/                  # JSON 数据存储
│
└── mobile/                    # React Native 前端
    ├── package.json
    ├── App.tsx
    ├── src/
    │   ├── screens/           # 页面
    │   │   ├── ChatScreen.tsx
    │   │   └── AgentsScreen.tsx
    │   ├── components/        # 组件
    │   │   ├── MessageList.tsx
    │   │   ├── ChatInput.tsx
    │   │   └── AgentAvatar.tsx
    │   ├── store/             # Zustand 状态
    │   │   └── chatStore.ts
    │   ├── services/          # API 服务
    │   │   └── api.ts
    │   └── types/
    └── assets/
```

## 功能特性

### 已实现
- 与 Agent 聊天对话（流式输出）
- 多 Agent 支持（CEO/CTO/CFO/CHRO/Secretary）
- LLM 调用（DeepSeek/OpenAI）
- Agent 工具调用系统

### 可用工具（11 个）

**协作工具：**
- `send_to_agent` - 发送消息给其他同事
- `delegate_task` - 委派任务给同事
- `my_tasks` - 查看我的任务列表
- `list_colleagues` - 查看同事列表
- `communication_history` - 查看通信历史
- `collaboration_stats` - 查看协作统计
- `notify_boss` - 向老板发送汇报
- `cancel_delegated_task` - 取消委派的任务

**网络工具：**
- `web_search` - 搜索互联网
- `fetch_webpage` - 获取网页内容

**计算工具：**
- `calculator` - 数学计算器

### 已移除（相比桌面版）
- Shell 命令执行
- 文件读写操作
- Git 操作
- 语音转文字
- 项目管理
- 预算系统

## 快速开始

### 1. 启动后端服务

```bash
cd server
npm install
cp .env.example .env
# 编辑 .env 添加 LLM API Key

npm run dev
```

服务将在 http://localhost:3001 启动

### 2. 启动移动端

```bash
cd mobile
npm install

# 使用 Expo 启动
npm start
```

然后使用 Expo Go App 扫描二维码，或按 `i` 打开 iOS 模拟器，按 `a` 打开 Android 模拟器。

## API 端点

### 聊天 API
- `POST /api/chat/send` - 发送消息（SSE 流式响应）
- `GET /api/chat/conversations` - 获取所有会话
- `GET /api/chat/history/:conversationId` - 获取会话历史

### Agent API
- `GET /api/agents` - 获取所有 Agent
- `GET /api/agents/:id` - 获取单个 Agent
- `GET /api/agents/active` - 获取活跃 Agent

### 配置 API
- `GET /api/config` - 获取系统配置

## 环境变量

```env
# server/.env

# LLM API Keys
DEEPSEEK_API_KEY=your_deepseek_key
OPENAI_API_KEY=your_openai_key

# Server Config
PORT=3001
```

## 打包 APK

### 方式 1：使用 EAS Build（推荐）

```bash
cd mobile

# 安装 EAS CLI
npm install -g eas-cli

# 登录 Expo 账号
eas login

# 配置项目
eas build:configure

# 构建 APK
eas build -p android --profile preview
```

构建完成后会提供下载链接。

### 方式 2：本地构建

需要安装 Android SDK，然后：

```bash
cd mobile

# 生成 Android 原生项目
npx expo prebuild -p android

# 进入 android 目录构建
cd android
./gradlew assembleRelease
```

APK 会生成在 `android/app/build/outputs/apk/release/`

### 生产环境配置

打包前需要修改 `mobile/src/config.ts`，将 API 地址改为你的服务器：

```typescript
// 生产环境配置
return 'https://your-actual-server.com/api';
```

## 技术栈

### 后端
- Express.js
- Node.js
- OpenAI/DeepSeek API

### 移动端
- React Native
- Expo
- TypeScript
- Zustand (状态管理)
- React Navigation

# Phase 3 进度 Ledger

## 全局约束
- 并行子代理文件范围严格不重叠
- 子代理产出用 file handoff（brief/report 文件）
- 验证：esbuild/tsc/node -c + 加载冒烟
- 不碰已提交的 Phase 0/1/2 代码（除非任务明确要求）

## 任务清单

### 批次 1（并行 3）— COMPLETE
- [x] P3-A 同步状态 UI + 冲突 diff（sync-store 325 + SyncPanel 300 + ConflictDiff 242 + SyncStatus 156 + SyncProgressBar 63）
- [x] P3-B 设备管理（device-manager 297 + device-ipc 87 + DeviceManager 429 + preload +19）
- [x] P3-D 群聊路由强制（发现并修复 2 个漏洞：postToDepartment 无发送者校验 + mentions 无成员校验）
- 集成：设备 IPC 注册到 ipc-bootstrap、SyncPanel + DeviceManager 挂载到 Settings 页面

### 批次 2（并行 2）— COMPLETE
- [x] P3-C Worker 限流 + 设备端点（/devices GET/POST/DELETE + 限流中间件 8 端点 + last_sync_at 更新）
- [x] P3-E DI 容器（app-context 97→220行 register/get/override/restore + DEPENDENCIES 映射 + lifecycle/ipc-bootstrap 适配 + 向后兼容）
- 集成：device-manager.js fetchDevices/removeDevice 对接 Worker /devices 端点（从占位变真实远程调用）

### 批次 3 — 暂缓
- [~] P3-F i18n：47 个 renderer 文件含中文，范围太广不宜并行，建议单独任务后续做
- [~] P3-G 移动端入库：移动端 repo 有 53K+ tracked 文件（含 build 产物和 APK），需先整理 .gitignore 清理，不宜自动入库

## 前端重构（Linear 风格 + emil 精修）

### 批次 1（Linear token 换色）— COMPLETE
- [x] A: globals.css + tailwind + 字体
- [x] B: ChatView + ConversationList + NewChatDialog
- [x] C: MessageBubble + ChatInput

### 批次 2（Linear 风格组件重构）— COMPLETE
- [x] D: Dashboard + dashboard 子组件
- [x] E: Settings + AgentSettings
- [x] F: 登录页 + 公司选择页 + 通用组件 + 同步面板 + 设备管理

### emil 精修批次（unseen details compound）— RUNNING (deleg_d6b52d69)
- [ ] A: globals.css + ui 组件—— 压迫反馈/缓动曲线/starting-style
- [ ] B: 聊天界面系列 —— 入场动画/微交互质感
- [ ] C: 页面类组件 —— 入场动画/微交互质感

## 完成记录
Phase 3 批次 1+2 完成（commit + push），Worker 重新部署（/devices + 限流）。
i18n 和移动端入库暂缓，作为后续独立任务。

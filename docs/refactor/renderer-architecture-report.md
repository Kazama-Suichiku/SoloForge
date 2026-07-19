# SoloForge 渲染进程架构诊断报告

> 诊断范围：`src/renderer/`（47 个文件，约 1.47 万行）
> 技术栈：Electron + React 18 + Vite 5 + Tailwind 3 + Zustand 5 + react-markdown
> 诊断方式：只读静态分析，未修改任何源码

---

## 0. 总览速读

| 文件 | 行数 | 主要问题 |
|---|---|---|
| `pages/Dashboard.jsx` | **2059** | 单文件巨型组件，10+ 子组件混编，3 套独立 setInterval 轮询 |
| `components/chat/MessageList.jsx` | **932** | 无虚拟化长列表，`MessageBubble` 未 memo，流式 chunk 全量重渲染 |
| `components/chat/ChatInput.jsx` | **763** | 录音编码 (WAV/PCM) + @mention + 拖拽 + 粘贴 + 发送全揉在一起 |
| `components/chat/ToolCallCard.jsx` | **758** | `formatToolResult` 500+ 行硬编码 if-else 工具结果格式化 |
| `hooks/useChatAgent.js` | **800** | 9 个 useEffect，业务逻辑与 IPC 订阅高度耦合 |
| `store/chat-store.js` | **847** | 41 次 `new Map/new Set` 浅拷贝，流式追加 O(N) findIndex |
| `pages/AgentSettings.jsx` | **887** | `AgentCard` + `EditPanel` + 页面三合一，表单逻辑复制 |
| `components/chat/ConversationList.jsx` | 552 | 三种联系人卡片高度重复（ContactItem/DepartmentItem/GroupItem） |
| `App.jsx.backup` | 203 | 残留备份文件，与 `App.jsx` 同名同功能 |

**严重度分布**：高 6 项 / 中 8 项 / 低 4 项

---

## 1. 组件设计缺陷

### 🔴 高 | 巨型单文件组件

**Dashboard.jsx 2059 行**（`src/renderer/pages/Dashboard.jsx`）

一个文件里塞进了 10+ 个组件：`ChevronIcon`、`DetailField`、`EmptyState`、`Pagination`、`ProgressBar`、`StatCard`、`Panel`、`GoalsList`、`TasksList`、`KPIsList`、`ActivityTimeline`、`RecruitmentList`、`TerminationApprovalPanel`、`BudgetApprovalPanel`、`CollaborationActivity`、`ProjectsPanel`、`AgentTaskPanel`、`Dashboard`。其中 `TerminationApprovalPanel`（L1108-1357）一个组件就 250 行，`CollaborationActivity`（L1364-1580）216 行。

```js
// L1809-1861 主组件同时管理 8 块数据 + 轮询 + 过滤
export default function Dashboard({ onBack, onOpenCFO, isActive = true }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ summary, goals, tasks, kpis,
    recruitRequests, terminationRequests, activityLog, collaboration, projects });
  // ...
  const [summary, goals, tasks, kpis, recruitRequests, terminationRequests,
    collaboration, projects] = await Promise.all([ ... 8 个 IPC ... ]);
}
```

**重构建议**：按业务域拆分为 `dashboard/panels/` 子目录：`GoalsPanel.jsx`、`TasksPanel.jsx`、`KpiPanel.jsx`、`RecruitmentPanel.jsx`、`TerminationPanel.jsx`、`BudgetPanel.jsx`、`CollaborationPanel.jsx`、`ActivityPanel.jsx`、`ProjectsPanel.jsx`、`AgentTaskPanel.jsx`；公共 `StatCard/Pagination/ProgressBar/EmptyState` 抽到 `components/ui/`。

---

### 🔴 高 | ChatInput.jsx 763 行职责过载

**`src/renderer/components/chat/ChatInput.jsx`** 同时承担：多模态图片粘贴/拖拽/选择、@mention 菜单、录音 (AudioContext + ScriptProcessor + PCM Float32)、WAV 文件头编码（L228-276）、发送、肃静按钮。

```js
// L228-276 手写 WAV 文件头编码，明显是底层 util 不该出现在输入框组件
const encodeWAV = useCallback((chunks, sampleRate) => {
  // ...44 字节 RIFF/WAVE/fmt/data 头...
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  // ...
});
```

**重构建议**：
- 抽 `utils/wav-encoder.js`（纯函数，可单测）
- 抽 `hooks/useAudioRecorder.js`（封装 AudioContext 生命周期）
- 抽 `hooks/useImageAttachments.js`（粘贴/拖拽/选择统一）
- 抽 `hooks/useMentionMenu.js`（@检测/导航/插入）
- `ChatInput.jsx` 只保留组合与 UI

---

### 🟡 中 | ConversationList 三种卡片高度复制

**`src/renderer/components/chat/ConversationList.jsx` L83-274**

`ContactItem`（L83-151）、`DepartmentItem`（L156-206）、`GroupItem`（L211-273）三个组件结构几乎一致：头像 + 名称 + 摘要 + 时间 + 未读 badge + 隐藏按钮。差异仅 fallback emoji（`🤖` / `🏢` / `👥`）与是否可隐藏。

```js
// 三个组件都重复以下 70 行结构
<button className={`w-full flex items-start gap-3 rounded-lg px-3 py-3 ...`}>
  <AgentAvatar avatar={...} fallback="🤖|🏢|👥" size="sm" />
  <div>... excerpt ... unreadCount badge ...</div>
</button>
{onHide && <button>...隐藏...</button>}
```

**重构建议**：合并为 `ConversationItem`，用 props 配置 `fallbackEmoji`、`hideable`、`name`、`excerpt`、`unread`。

---

### 🟡 中 | AgentSettings.jsx 887 行三合一

**`src/renderer/pages/AgentSettings.jsx`** 包含 `AgentCard`（L25-333，309 行）、`EditPanel`（L338-607，270 行）、`AgentSettings`（L613-887）三个组件。`AgentCard` 和 `EditPanel` 的表单 state、handleSave/handleReset/avatar 上传逻辑几乎完全重复（对比 L27-77 与 L339-385）。

```js
// AgentCard L27-35
const [formData, setFormData] = useState({
  name: config.name, title: config.title, level: config.level, ...
});
// EditPanel L339-347 完全相同
const [formData, setFormData] = useState({
  name: config?.name || '', title: config?.title || '', ...
});
```

**重构建议**：抽 `AgentFormFields.jsx`（共享表单字段 + avatar 上传），`AgentCard` 用 inline 编辑、`EditPanel` 用侧栏编辑，二者共享字段组件。

---

## 2. 状态管理缺陷

### 🔴 高 | chat-store.js 847 行 + 41 次 Map 浅拷贝

**`src/renderer/store/chat-store.js`**

每个 setter 都 `new Map(state.conversations)` + `new Map(state.messagesByConversation)`，对流式高频更新是性能黑洞：

```js
// L622-665 appendMessageContent 每次 chunk 都重建两个 Map
set((state) => {
  // ...
  const updatedMsgs = [...msgs];
  updatedMsgs[idx] = { ...msg, content: msg.content + pendingChunks };
  const nextMsgs = new Map(state.messagesByConversation);  // ← 全量浅拷贝
  nextMsgs.set(convId, updatedMsgs);
  const conv = state.conversations.get(convId);
  if (conv && conv.lastMessage?.id === messageId) {
    const nextConvs = new Map(state.conversations);        // ← 又一次全量浅拷贝
    // ...
  }
});
```

**问题**：
1. `updateMessage` / `addToolCalls` / `updateToolCall` 都用 `for (const [convId, msgs] of nextMsgs)` 全表扫描找 messageId（L537-553、L676-704、L716-738），复杂度 O(对话数 × 消息数)。单私聊场景可接受，但 10+ Agent × 长对话会明显放大。
2. 流式输出每 16ms 一次 `appendMessageContent` → 每次重建两个 Map + 触发所有订阅 `messagesByConversation` 的组件重渲染（MessageList、ConversationList 都订阅了它）。
3. `_streamBuffers` 挂在 store 实例上（L595-605），不是 React state，DevTools 看不见，且 `set({ _streamBuffers: new Map() })` 会触发额外渲染。

**重构建议**：
- 将 `messagesByConversation` 拆为 per-conversation 的独立 store slice 或使用 `subscribeWithSelector` + selector 订阅单对话，避免全 Map 重建触发跨对话重渲染。
- 建立 `messageId → { convId, idx }` 反查索引（在 `sendMessage` 时登记，`updateMessage` 时 O(1) 定位），消除全表 findIndex。
- `_streamBuffers` 移到模块级闭包或独立 `streamBufferStore`，不污染主 store。
- 847 行按域拆分：`conversation-slice.js`（CRUD）、`message-slice.js`（消息 + 流式）、`tool-call-slice.js`（工具调用）。

---

### 🟡 中 | 5 个 store 边界模糊，useChatAgent 跨 store 直接 getState

**`src/renderer/hooks/useChatAgent.js`** 在 9 个 useEffect 中直接 `useChatStore.getState()` / `useAgentStore.getState()`（L228、L326、L348、L394、L457、L478、L508、L694、L766），绕过 React 订阅体系，时序依赖副作用顺序。同时订阅 `conversations`、`messagesByConversation` 两个大 Map（L19-20），又会因 store 引用变化重建回调，导致下游 useCallback 依赖变更。

```js
// L19-20 订阅两个大 Map，任何消息更新都让 hook 重建
const conversations = useChatStore((s) => s.conversations);
const messagesByConversation = useChatStore((s) => s.messagesByConversation);
// ...
// L394 又绕过订阅，直接读最新 state
const freshMessages = useChatStore.getState().messagesByConversation.get(conversationId) ?? [];
```

**问题**：订阅 + getState 混用 = 既付了订阅的重渲染成本，又承担了 getState 的时序不可预测风险，且违反 Zustand 推荐用法。

**重构建议**：
- `useChatAgent` 内部只订阅需要的 action 引用（`useChatStore((s) => s.sendMessage)`），数据读取一律用 `getState()`，二选一。
- 把 9 个 useEffect 的事件订阅拆到独立 `hooks/useAgentEvents.js`（已有文件但只处理 task-store），按事件类型拆 `useChatStreamEvents`、`useProactiveMessageEvents`、`useGroupEvents`、`useDeptGroupEvents`。

---

### 🟡 中 | todo-store / task-store / chat-store 状态分散

- `task-store.js`（160 行）只在 `useAgentEvents` 订阅，但 UI 中 `AgentTaskPanel`（Dashboard L1691-1803）又用本地 `useState` + `setInterval(2s)` 直接拉 `getAgentTasks`，没走 store。两套任务状态并存。
- `todo-store.js`（77 行）用普通对象 `{agentId: Todo[]}`，而 `chat-store`、`agent-store` 用 `Map`，序列化策略不一致。

**重构建议**：统一 store 容器类型（全用 Map 或全用普通对象），`AgentTaskPanel` 改为订阅 `task-store`，删除本地 `setInterval`。

---

## 3. 性能风险

### 🔴 高 | MessageList 无虚拟化 + MessageBubble 未 memo

**`src/renderer/components/chat/MessageList.jsx` L862-873**

```js
<div className="space-y-4 pb-2">
  {visibleMessages.map((msg) => (
    <MessageBubble
      key={msg.id}
      message={msg}
      isSelectMode={isSelectMode}
      isSelected={selectedIds.has(msg.id)}
      onToggleSelect={toggleSelectMessage}
      onContextMenu={handleContextMenu}
      onImageClick={setLightboxSrc}
    />
  ))}
</div>
```

**问题**：
1. 全量渲染所有消息，长对话（500+ 条）会一次渲染 500+ 个 `MessageBubble`，每个含 `ReactMarkdown`（重）。
2. `MessageBubble` 未 `React.memo`，父组件任何 state 变化（`contextMenu`、`lightboxSrc`、`isSelectMode`、`selectedIds`）都全量重渲染所有气泡。
3. 流式 `appendMessageContent` 每 16ms 更新最后一条消息 → `visibleMessages` useMemo 依赖 `messagesByConversation` 引用变化 → 重新 map 全部消息。
4. `onToggleSelect`、`onContextMenu`、`onImageClick` 是 useCallback 但依赖 `selectedIds` 等，每次选择都重建，让 memo 失效。

**重构建议**：
- 引入 `react-virtuoso` 或 `@tanstack/react-virtual` 虚拟化（Markdown 渲染重，收益极大）。
- `MessageBubble` 用 `React.memo` + 浅比较，回调用稳定引用（`useCallback` 依赖只含必要 state）。
- 流式更新只重建最后一条消息对象（已是 `updatedMsgs[idx] = { ...msg }`），但 `visibleMessages` useMemo 依赖整个 Map，需改为订阅 `messagesByConversation.get(currentConversationId)` 单数组。

---

### 🔴 高 | Dashboard 多重 setInterval 轮询 + 一次渲染全部面板

**`src/renderer/pages/Dashboard.jsx`**

```js
// L968 BudgetApprovalPanel 每 10s 轮询
const interval = setInterval(loadBudgetData, 10000);
// L1707 AgentTaskPanel 每 2s 轮询
timerRef.current = setInterval(loadTasks, 2000);
// L1730 AgentTaskPanel 再开一个 1s 定时器只为刷新"耗时"显示
const interval = setInterval(() => setTick((t) => t + 1), 1000);
// L1859 主 Dashboard 每 30s 全量重载 8 块数据
const interval = setInterval(loadData, 30000);
```

**问题**：
1. 同时 4 个 setInterval 在跑，且 `AgentTaskPanel` 的 1s `setTick` 即使无任务也持续 setState（L1727-1732），白白触发重渲染。
2. `loadData` 一次 `Promise.all` 8 个 IPC，任何一块更新都全量替换 `data` state（L1811-1821），导致所有子面板 props 变化重渲染。
3. `isActive=false` 时主轮询停了（L1856），但 `BudgetApprovalPanel`、`AgentTaskPanel` 的内部定时器不受 `isActive` 控制，页面隐藏时仍在跑（虽然 DOM 隐藏但 effect 没清理）。

**重构建议**：
- 把所有定时器上提到 `Dashboard`，用单一 `isActive` 控制；或用 React Query / SWR 做数据层，自动管理轮询与焦点。
- `AgentTaskPanel` 的 1s tick 改为 `requestAnimationFrame` 且仅在有任务时启动；无任务时直接 return 不开定时器。
- 各面板用 `React.memo` + 稳定 props，避免 `data` 全量替换引发级联重渲染。

---

### 🟡 中 | 流式 chunk 触发跨对话重渲染

**`src/renderer/store/chat-store.js` L593-667 + `src/renderer/components/chat/ConversationList.jsx` L282**

```js
// ConversationList 订阅整个 messagesByConversation
const messagesByConversation = useChatStore((s) => s.messagesByConversation);
// ...
// getActualLastMsg 依赖 messagesByConversation，任何对话的流式 chunk 都触发重算
const getActualLastMsg = useCallback((convId) => {
  const msgs = messagesByConversation.get(convId);
  // ...
}, [messagesByConversation]);
```

**问题**：Agent A 流式输出时，`messagesByConversation` 引用每 16ms 变一次，`ConversationList` 的 `allContacts`、`allDepartmentChats`、`allGroupChats` 三个 useMemo 全部重算（L308-351），即使当前对话没变。

**重构建议**：ConversationList 只需 `lastMessage` 摘要，应订阅 `conversations` 的 `lastMessage` 字段（store 已维护，L520-522），不订阅 `messagesByConversation`。`getActualLastMsg` 逻辑下沉到 store，在 `sendMessage`/`appendMessageContent` 时同步更新 `lastMessage`。

---

### 🟡 中 | MessageList 自动滚动实现重复

**`src/renderer/components/chat/MessageList.jsx` L692-704**

```js
// L692-696 按 length 滚动
useEffect(() => {
  if (isNearBottomRef.current) {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }
}, [visibleMessages.length]);

// L700-704 按 content 滚动
useEffect(() => {
  if (isNearBottomRef.current && scrollRef.current) {
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }
}, [lastMsg?.content]);
```

两个 effect 都做"跟随底部"，前者用 `scrollIntoView` 后者用 `scrollTop`，行为不一致且可能互相打架。流式时 `lastMsg.content` 每 16ms 变 → 每 16ms 强制滚动，用户向上翻看时若 `isNearBottomRef` 误判会被拉回底部。

**重构建议**：合并为单一 effect，用 `scrollTop = scrollHeight` 一致实现；`isNearBottomRef` 阈值（当前 120px）可调大或加"用户主动向上滚动后锁定"逻辑。

---

## 4. 路由方案缺陷

### 🟡 中 | CSS display:none + mountedPages 内存累积

**`src/renderer/App.jsx` L62-73 + L83-93**

```js
function PageSlot({ active, children }) {
  return (
    <div className={`absolute inset-0 transition-opacity duration-200 ${
      active ? 'opacity-100 z-10 pointer-events-auto' : 'opacity-0 z-0 pointer-events-none'
    }`} style={active ? undefined : { visibility: 'hidden' }}>
      {children}
    </div>
  );
}
// ...
const [mountedPages, setMountedPages] = useState(new Set(['chat']));
const navigateTo = useCallback((page) => {
  setMountedPages((prev) => { /* 只加不删 */ next.add(page); return next; });
  setCurrentPage(page);
}, []);
```

**问题**：
1. `mountedPages` 只加不减，访问过的页面永久挂载。`Dashboard`（2059 行）+ `CFODashboard` 挂载后即使不切回，组件树、定时器、订阅都保留。`AgentTaskPanel` 的 2s/1s 定时器在页面隐藏时仍跑（见 3.2）。
2. `PageSlot` 用 `opacity-0 + visibility:hidden + pointer-events-none` 三重隐藏，但子组件 `useEffect` 照常执行，IPC 订阅不卸载。
3. 无 URL/历史栈，无法深链接、无法用浏览器后退键、无法用 `Cmd+[/]`。
4. `App.jsx.backup`（203 行）残留，与 `App.jsx` 内容接近，易误编辑。

**重构建议**：
- 短期：`navigateTo` 改为离开页面时 `setMountedPages` 删除非活跃页（保留 `chat` 即可），或给 `Dashboard` 加 `isActive` 时才挂载（已有 prop 但没用在卸载上）。
- 中期：引入 `react-router-dom` 的 `MemoryRouter`（Electron 不需要 URL），用 `useLocation` + `Routes` 替代 `mountedPages`，自动管理挂载/卸载，支持历史栈。
- 删除 `App.jsx.backup`，改用 git 历史。

---

### 🟡 中 | 路由状态与 auth 状态两套判定

**`src/renderer/App.jsx` L120-194**：`appState`（auth-store）+ `currentPage`（local state）+ `hasHydrated`（chat-store）三态叠加决定渲染内容，`if-else if` 链 6 层。登录页/公司选择页用 `appState` 切换，主界面用 `currentPage` 切换，两套体系叠加。

**重构建议**：统一为单一路由状态机，`appState` 作为顶层路由（`/login`、`/company-select`、`/main`），`/main` 下用子路由（`/chat`、`/settings`、`/dashboard`）。

---

## 5. 样式与主题

### 🟡 中 | 内联 style 滥用与主题变量体系不完整

**`tailwind.config.js`** 只映射了 9 个语义色（`primary`、`bg-base/elevated/muted`、`text-primary/secondary/muted`、`border-primary`），但 `globals.css` 定义了 52 个 CSS 变量（含 `--color-success/warning/danger`、`--bg-hover`、`--border-subtle`、`--spacing-*`、`--radius-*`、`--shadow-*`），大量变量未进 Tailwind，只能用 `bg-[var(--bg-hover)]`、`text-[var(--color-success)]` 任意值类（全文搜索得 5+ 处 `style={{}}`、Dashboard 内联 style 5 处）。

```js
// tailwind.config.js L7-18 只暴露 9 个
colors: {
  primary: 'var(--color-primary)',
  'bg-base': 'var(--bg-base)',
  // 缺 success/warning/danger/bg-hover/border-subtle
}
```

```jsx
// Dashboard.jsx L269 进度条用内联 style
<div style={{ width: `${percentage}%` }} />
// AgentSettings.jsx L264-267 部门色用内联
<span style={{ backgroundColor: dept.color ? `${dept.color}20` : '#e5e7eb', color: dept.color || '#6b7280' }}>
```

**问题**：
- `bg-[var(--bg-hover)]`、`text-[var(--color-success)]` 任意值类无法被 Tailwind 的 JIT 正确 tree-shake，且与 `dark:` 变体组合时易失效。
- 部门色（`dept.color`）用内联 `style`，无法响应主题切换。
- `CFODashboard.jsx`（L1-100）大量用 `text-gray-500 dark:text-gray-400` 硬编码色，而非语义 token，与主聊天页风格不一致。

**重构建议**：
- `tailwind.config.js` 补全 `success/warning/danger/bg-hover/border-subtle` 等语义色映射。
- 部门色改为预设 Tailwind class（如 `dept-amber`、`dept-blue`），通过 `DEPT_COLORS` map（`MessageList.jsx` L16-23 已有）统一引用。
- `CFODashboard` 全面替换 `gray-*` 为 `text-secondary/muted`、`bg-elevated`。

---

### 🟢 低 | globals.css 结构合理但 @layer 使用偏少

`globals.css` 256 行，定义了浅/深主题 + `@layer base/utilities` + 滚动条样式，结构清晰。但仅 3 个 `@layer`，大量自定义类（`.code-block`、`.drag-region`、`.animate-*`）散在全局，建议归入 `@layer components`。

---

## 6. 类型安全

### 🟡 中 | JSX 无 TS，JSDoc typedef 不足以覆盖运行时边界

项目用 JSDoc `@typedef` 在 `chat-store.js` L17-52、`agent-store.js` L9-23、`task-store.js` L9-24 定义了核心类型，但：
- 组件 props 几乎无 JSDoc（`MessageBubble`、`ToolCallCard` 等大组件只标了 `@param`）。
- `formatToolResult`（`ToolCallCard.jsx` L209-579）的 `parsed` 是 `any`，500 行 if-else 全靠运行时字段探测，`parsed.response`、`parsed.colleagues`、`parsed.agents`、`parsed.results` 等字段无契约。
- IPC 返回值全无类型定义，`window.electronAPI.*` 是 `any`，主进程改字段前端无编译期告警。

**重构建议**：
- 短期：补 `window.electronAPI`、`window.soloforge` 的 `.d.ts` 声明文件（`types/electron-api.d.ts`），让 IDE 至少能补全。
- 中期：核心 store + 大组件 props 加 JSDoc `@param {{type}}`，或迁移到 TS（Vite 原生支持，可渐进：新文件用 `.tsx`，旧文件保留）。
- `formatToolResult` 的工具结果 schema 应由主进程输出统一类型，前端按 schema 分发，而非 500 行硬编码。

---

## 7. 可维护性热点

### 🔴 高 | ToolCallCard.formatToolResult 500 行硬编码

**`src/renderer/components/chat/ToolCallCard.jsx` L209-579**

```js
function formatToolResult(toolName, rawResult) {
  // ...
  if (toolName === 'send_to_agent' && parsed.response) { ... }
  if (toolName === 'delegate_task') { ... }
  if (toolName === 'notify_boss' && parsed.message) { ... }
  if (toolName === 'create_group_chat') { ... }
  if (toolName === 'list_colleagues') { ... }
  if (toolName === 'hr_list_agents') { ... }
  if (toolName === 'hr_org_chart') { ... }
  // ... 30+ 个 if 块，每个 10-30 行
}
```

**问题**：每加一个工具或后端字段调整，都要改这个函数。工具元数据 `TOOL_META`（L47-153）已硬编码 100+ 行工具名映射，再叠加格式化逻辑，`ToolCallCard.jsx` 成为"改不动"热点。

**重构建议**：
- `TOOL_META` + `formatToolResult` 抽到 `utils/tool-formatters/` 目录，每个工具一个文件（`send-to-agent.js`、`web-search.js`...），注册到 `formatters` map。
- 让后端工具直接返回 `{ summary, detail }` 格式化字段，前端只做 i18n + 渲染，不再解析。
- 或改用 schema 驱动：定义 `ToolResultSchema`，前端按 schema 渲染。

---

### 🔴 高 | useChatAgent.js 800 行业务 + IPC 订阅耦合

**`src/renderer/hooks/useChatAgent.js`**

9 个 useEffect（L418、448、533、563、598、627、652、670、739）分别订阅 `onStream`、`onComplete`、`onProactiveMessage`、`onCreateGroup`、`onDeptGroupCreate`、`onDeptGroupUpdate`、`onDeptGroupMessage`、`onDeptGroupRename`，每个都直接操作 chat-store 多个 action。群聊连锁回复逻辑（`handleGroupChat` L225-375）150 行含 `groupRules` 字符串拼装、`MAX_CHAIN_ROUNDS` 循环、`@` 提取、身份提醒注入，是纯业务逻辑却塞在 hook 里。

**问题**：
- 任何 IPC 事件增减都要改这个 800 行文件，易引入回归。
- `handleGroupChat` 不可单测（藏在 hook 闭包里，依赖 store.getState）。
- `groupAbortRef`、`deptCooldownRef` 等 ref 跨渲染状态散落。

**重构建议**：
- 抽 `services/group-chat-service.js`（纯函数 + store 参数注入，可单测），`handleGroupChat` 移入。
- 抽 `hooks/useChatStreamEvents.js`、`useProactiveMessageEvents.js`、`useGroupEvents.js`、`useDeptGroupEvents.js`，每个 hook 只管一类 IPC 订阅。
- `useChatAgent` 只暴露 `sendToAgent`、`silenceGroup`，内部组合上述 hooks。

---

### 🟡 中 | IPC 调用散落各处，无统一封装

`window.electronAPI.*` / `window.soloforge.*` 直接调用散布于 5 个 store + 8 个组件 + 2 个 hooks，无统一错误处理、无日志、无类型。`Dashboard.jsx` 单文件 21 处直接 IPC 调用，`AgentSettings` 10 处，`Settings` 9 处。

**重构建议**：抽 `services/ipc/` 目录，按域封装（`agentApi.js`、`operationsApi.js`、`chatApi.js`），统一 try/catch + 日志 + 返回类型。组件/store 只调 service，不直接碰 `window.electronAPI`。

---

### 🟡 中 | 同一逻辑重复：lastMessage 维护

`chat-store.js` 在 `sendMessage`（L520-522）、`updateMessage`（L544-549）、`deleteMessages`（L578-583）、`appendMessageContent`（L656-662）4 处分别维护 `conversation.lastMessage`，逻辑分散。`ConversationList` 又用 `getActualLastMsg`（L294-305）绕过 `lastMessage` 直接从 `messagesByConversation` 取最后一条。两套"最后消息"来源并存，易不一致。

**重构建议**：`lastMessage` 由 store 统一维护为"最后一条未删除消息"，`ConversationList` 只订阅 `conversations`，删掉 `getActualLastMsg`。

---

### 🟢 低 | App.jsx.backup 残留 + App.jsx 注释过时

`App.jsx.backup`（203 行）与 `App.jsx`（203 行）大小完全一致，疑似手动备份。`App.jsx` L5 注释写"使用 CSS display:none"，实际用 `opacity + visibility + pointer-events`，注释过时。

**重构建议**：删 `App.jsx.backup`，更新 `App.jsx` 顶部注释。

---

## 8. 重构优先级建议

| 优先级 | 任务 | 预期收益 | 风险 |
|---|---|---|---|
| P0 | MessageList 虚拟化 + MessageBubble memo | 长对话 FPS 从 <10 → 60 | 中（需测滚动行为） |
| P0 | chat-store 流式 buffer 移出 store + 消息索引 | 流式 CPU 降 50%+ | 中 |
| P0 | Dashboard 拆分 + 定时器统一管理 | 页面切换内存释放，CPU 空闲降 | 高（大改动） |
| P1 | ToolCallCard formatToolResult 拆分 | 新增工具成本从改前端 → 改后端 | 低 |
| P1 | useChatAgent 拆分为多 hooks + service | 可测试性 + 可维护性 | 中 |
| P1 | ChatInput 拆分（录音/图片/mention） | 单文件从 763 → ~200 | 低 |
| P2 | 引入 react-router 替代 mountedPages | 历史栈 + 深链接 | 中 |
| P2 | tailwind.config 补全语义色 | 减少 `bg-[var()]` 任意值类 | 低 |
| P2 | IPC 调用统一 service 封装 | 错误处理 + 类型 | 中 |
| P3 | 删 App.jsx.backup + 补 .d.ts | 卫生 + IDE 体验 | 极低 |

---

## 9. 未深入但建议关注的点

- **Electron 安全**：`sf-local://` 协议（`MessageList.jsx` L212、L515）渲染本地文件，需确认主进程对路径做了白名单校验，否则可能被恶意消息加载任意本地图片。
- **AudioContext 兼容性**：`ChatInput.jsx` L287 用 `createScriptProcessor`（已 deprecated），建议改 `AudioWorklet`。
- **StrictMode 双调用**：`main.jsx` 开启了 `StrictMode`，`useChatAgent` 的 9 个 useEffect 在开发模式会双订阅，需确认 IPC `unsubscribe` 是幂等的。
- **i18n**：全文中文硬编码，后续若做多语言需大改。建议引入 `i18next` 时再统一抽取。

---

**报告生成方式**：只读静态分析，未修改任何源码。
**诊断文件位置**：`/Users/suichiku/Desktop/SoloForge/.hermes-diagnostic/renderer-architecture-report.md`

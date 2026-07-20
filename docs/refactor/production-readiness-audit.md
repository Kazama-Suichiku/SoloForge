# SoloForge 前端生产化审计报告

> 审计范围：SoloForge 前端渲染层（hooks / stores / pages / chat 组件 / preload / IPC channels / chat-ipc-handlers）
> 审计时间：2026-07-20
> 审计人：产品经理 + 前端架构师视角
> 审计维度：20 个生产化标准维度
> 约束：只读文件 + 写报告，不修改任何代码

## 评审文件清单

| 类别 | 文件 | 行数 |
|---|---|---|
| hooks | `src/renderer/hooks/useChatAgent.js` | 317 |
| hooks | `src/renderer/hooks/useAgentIpcEvents.js` | 338 |
| hooks | `src/renderer/hooks/chat-agent-logic.js` | 325 |
| store | `src/renderer/store/chat-store.js` | 789 |
| store | `src/renderer/store/auth-store.js` | 236 |
| store | `src/renderer/store/agent-store.js` | 361 |
| page | `src/renderer/App.jsx` | 203 |
| page | `src/renderer/pages/LoginPage.jsx` | 191 |
| page | `src/renderer/pages/Dashboard.jsx` | 327 |
| page | `src/renderer/pages/Settings.jsx` | 706 |
| page | `src/renderer/pages/AgentSettings.jsx` | 1050 |
| component | `src/renderer/components/chat/ChatView.jsx` | 533 |
| component | `src/renderer/components/chat/MessageList.jsx` | 611 |
| component | `src/renderer/components/chat/ConversationList.jsx` | 754 |
| ipc/preload | `src/preload/preload.js` | 527 |
| shared | `src/shared/ipc-channels.js` | 200 |
| main | `src/main/chat-ipc-handlers.js` | 247 |

---

## 维度 1：加载体验（Skeleton / Placeholder / 白屏 / Loading 状态）

| 问题 | 文件:行号 | 当前状态 | 商业产品标准 | 优先级 | 改法 |
|---|---|---|---|---|---|
| 启动 loading 仅 spinner，无骨架屏 | `App.jsx:120-128` | `appState==='loading'` 时全屏 spinner + 文字「正在检查登录状态...」 | 首屏骨架屏（侧栏 + 主区形状），让用户感知布局已就绪 | P2 | 引入 Skeleton 组件，渲染与最终布局同形状的灰色占位 |
| chat store rehydrate 无骨架 | `App.jsx:133-141` | 仅 spinner + 「加载中...」，无骨架 | Rehydrate 期间应显示对话列表骨架 + 消息区骨架 | P2 | `_hasHydrated=false` 时渲染 ConversationList 的 skeleton 行 ×6 + MessageList 的气泡骨架 |
| Dashboard 加载仅 spinner | `Dashboard.jsx:90-118` | `loading=true` 时居中 spinner + 「加载仪表板…」 | 6 个 StatCard 占位 + Panel 骨架，避免布局抖动 | P2 | 给 StatCard / Panel 加 `loading` prop，渲染骨架行 |
| Settings 加载仅文字 | `Settings.jsx:333-350` | `loading=true` 时只显示「加载中...」文字，无结构 | 应显示 panel 骨架 + 开关骨架 | P3 | 给 SettingsSection 加骨架态 |
| AgentSettings 加载仅文字 | `AgentSettings.jsx:790-806` | 只显示「加载中...」文字 | 应显示组织架构图骨架 / 列表骨架 | P3 | 加骨架态 |
| ChatView 首次进入无 skeleton | `ChatView.jsx` 整体 | 依赖 `hasHydrated` 全局 spinner，无聊天页自身骨架 | 切换到 chat 页时若数据未就绪应有侧栏骨架 | P3 | 在 ConversationList 加 skeleton fallback |
| 未读消息拉取无 loading | `useAgentIpcEvents.js:208-236` | `fetchDepartmentGroups` 静默执行，用户无感知 | 首次加载应显示加载指示 | P4 | 加 `isLoadingDeptGroups` 状态，侧栏显示加载条 |

---

## 维度 2：错误处理（错误边界 / 友好提示 / 重试机制）

| 问题 | 文件:行号 | 当前状态 | 商业产品标准 | 优先级 | 改法 |
|---|---|---|---|---|---|
| 全局 ErrorBoundary 仅覆盖 Dashboard / CFO，不含 ChatView / Settings / AgentSettings | `App.jsx:23-57, 172-191` | 只有 Dashboard 和 CFO 包了 `ErrorBoundary`；ChatView / Settings / AgentSettings 未包 | 所有路由级页面都应有错误边界 | P1 | 在 App.jsx 给每个 PageSlot 内包 ErrorBoundary |
| ErrorBoundary UI 无错误码 / 上报 / 重载按钮 | `App.jsx:38-54` | 只显示 `error.message` 和「重试」按钮（重置 state） | 应提供「重新加载应用」「复制错误」「上报反馈」 | P2 | 加「复制错误」「重新加载」「反馈」按钮，集成 Sentry / 本地日志上报 |
| ErrorBoundary 重试只是清状态，不重新渲染子树 | `App.jsx:46-51` | `setState({hasError:false})` 后子组件用旧 props 仍可能再次抛错 | 应强制 remount 子树（用 key） | P1 | 给 PageSlot 加 `key={retryCount}`，重试时递增 |
| 错误消息直接拼接 `error.message`，无本地化 | `useChatAgent.js:172`、`useAgentIpcEvents.js:138` | `抱歉，我遇到了一些问题：${error.message}` 直接拼英文错误 | 统一错误码 + 友好提示，原始错误放日志 | P2 | 定义 error code → 友好文案映射，原始错误 console.error |
| IPC 错误无重试机制 | `useAgentIpcEvents.js:228-230`、`auth-store.js:48-51` | `catch` 只 console.error，不重试 | 网络类错误应支持指数退避重试 | P2 | 给关键 IPC 调用加 retryWithBackoff 工具函数 |
| 登录失败错误无区分 | `auth-store.js:119-123` | `error.message || '登录失败'`，不区分网络错 / 凭据错 / 限流 | 应按错误类型分提示（凭据错 / 网络错 / 账号锁定） | P2 | 后端返回 error code，前端按 code 渲染 |
| Settings 加载失败仅红字 | `Settings.jsx:352-358` | `加载权限配置失败` 一行红字，无重试 | 应提供「重试加载」按钮 | P2 | 加重试按钮重新触发 loadPermissions |
| Dashboard 加载失败静默 | `Dashboard.jsx:73-74` | `catch` 只 console.error，UI 显示空数据 | 应显示错误态 + 重试按钮 | P2 | 加 `error` 状态，渲染错误占位 + 重试 |
| chat-store persist 失败仅 console.error | `chat-store.js:83, 142, 145` | 写盘失败只打日志，用户无感知数据未持久化 | 应提示用户「数据未保存」并允许重试 | P2 | 加 toast / banner 提示持久化失败 |
| 流式完成错误未触达用户 | `useAgentIpcEvents.js:136-141` | 错误内容塞进消息 content，无「重试发送」按钮 | 应在错误消息上加重试 / 重新生成按钮 | P2 | MessageBubble 对 `status==='error'` 渲染重试按钮 |

---

## 维度 3：空状态（引导 / CTA / 占位）

| 问题 | 文件:行号 | 当前状态 | 商业产品标准 | 优先级 | 改法 |
|---|---|---|---|---|---|
| 未选中对话空状态仅文字 + emoji | `MessageList.jsx:424-434` | `💬` + 「选择一位同事开始聊天」+ 「在左侧联系人列表中选择」 | 应有 CTA 按钮（如「发起对话」「查看组织架构」） | P3 | 加「发起对话」「打开仪表板」按钮 |
| 消息列表空状态无引导 | `MessageList.jsx:501-514` | 仅 emoji + 「开始新对话」+ 「发送消息开始与 Agent 对话」 | 应有示例 prompt / 快捷指令按钮 | P3 | 提供 2-3 个示例 prompt 快捷按钮 |
| 联系人列表空状态无 CTA | `ConversationList.jsx:667-678` | 「暂无联系人」「没有匹配的联系人」纯文字 | 应有「招募新员工」「创建群聊」CTA | P3 | 加跳转到 AgentSettings / NewChat 的按钮 |
| AgentSettings 空状态无 CTA | `AgentSettings.jsx:896-900` | 「暂无成员，在运营仪表板中招募新员工」纯文字 | 应有跳转按钮 | P3 | 加「前往运营仪表板」跳转按钮 |
| PathList 空状态无 CTA | `Settings.jsx:205-209` | 「暂无允许的路径，Agent 将无法访问任何文件」斜体文字 | 应有「添加路径」CTA（虽上方有按钮但空状态本身无引导） | P4 | 在空状态里加「选择文件夹」内联按钮 |
| 部门群聊无消息空状态无引导 | `ConversationList.jsx:319`、`385` | 显示「团队工作群」/「暂无消息」 | 应显示「@某成员 开始讨论」示例 | P4 | 加示例 mention 提示 |

---

## 维度 4：搜索 / 过滤 / 排序

| 问题 | 文件:行号 | 当前状态 | 商业产品标准 | 优先级 | 改法 |
|---|---|---|---|---|---|
| 搜索仅支持联系人，不支持消息内容 | `ConversationList.jsx:519-528` | `searchQuery` 只过滤 `agent.name / id / title` 和群名 | 商业产品应支持全文搜索消息内容 | P2 | 加消息全文搜索（需后端 IPC 支持），结果跳转到对应消息 |
| 搜索无高亮 | `ConversationList.jsx:519-528` | 过滤后不高亮匹配项 | 应高亮匹配子串 | P3 | 在 ContactItem / GroupItem 渲染时对匹配段加 `<mark>` |
| 搜索无键盘导航 | `ConversationList.jsx` 全文 | 仅靠鼠标点击结果 | 应支持 ↑/↓ 选择 + Enter 确认 | P3 | 加 `activeIndex` 状态，ArrowDown/Up 导航 |
| Dashboard 无搜索 / 过滤 | `Dashboard.jsx` 全文 | 任务 / 目标 / KPI / 审批均无搜索过滤 | 大数据量时应支持搜索 / 状态过滤 | P3 | 在各 Panel 加搜索框 + 状态 tab |
| AgentSettings 列表无搜索 | `AgentSettings.jsx` 全文 | 只按部门分组，无搜索框 | 成员多时应支持搜索 | P3 | 加搜索框过滤 `name / title / department` |
| 消息列表无时间跳转 / 日期过滤 | `MessageList.jsx` 全文 | 无日期分组 / 跳转 | 商业产品应支持按日期跳转 | P4 | 加日期分组分隔条 + 跳转 |
| 排序选项固定 | `ConversationList.jsx:480, 495, 511` | 固定按 `lastTime` 降序 | 应支持按未读优先 / 名称排序 | P4 | 加排序切换 |
| 搜索框无清除按钮显式反馈 | `ConversationList.jsx:648-661` | 有清除 X 但无「清除搜索」文字 | 标准 UX 已满足，可加 Esc 清除 | P4 | 加 Esc 键清空搜索 |

---

## 维度 5：快捷键（Cmd+K / Cmd+N / Esc）

| 问题 | 文件:行号 | 当前状态 | 商业产品标准 | 优先级 | 改法 |
|---|---|---|---|---|---|
| 无全局 Cmd+K 命令面板 | `App.jsx` 全文 | 完全无快捷键监听 | Linear / Notion 级应用标配 Cmd+K | P1 | 加全局 keydown 监听，弹命令面板（搜索联系人 / 跳转页面 / 操作） |
| 无 Cmd+N 新建对话 | `ChatView.jsx:37, 423` | 新建对话只能点击 `+` 按钮 | 应支持 Cmd+N | P2 | 加全局快捷键绑定到 `setShowNewChat(true)` |
| 无 Esc 关闭弹窗 / 退出多选 | `MessageList.jsx:66-73, 137-141` | 仅右键菜单和灯箱有 Esc，多选 / 新建对话弹窗无 Esc | 所有弹窗都应 Esc 关闭 | P2 | NewChatDialog / EditPanel 等加 Esc 监听 |
| 无 Cmd+/ 快捷键帮助 | 全文 | 无任何快捷键帮助 | 应提供快捷键 cheatsheet | P3 | 加 Cmd+/ 弹出快捷键面板 |
| 输入框快捷键仅 Enter / Shift+Enter | `ChatInput.jsx:208-220` | 只有发送 / 换行 / mention 导航 | 应支持 Cmd+V 粘贴图片（已有）、Cmd+Shift+L 清屏等 | P3 | 扩展快捷键 |
| 侧栏折叠无快捷键 | `ChatView.jsx:233-235` | 只能点击按钮 | 应支持 Cmd+B | P3 | 加 Cmd+B 绑定到 toggleSidebar |
| 巡查开关无快捷键 | `ChatView.jsx:78-87` | 只能点击 | 可加 Cmd+Shift+P | P4 | 加快捷键 |
| 聊天输入框无 Cmd+A 全选 / Cmd+Z 撤销 | `ChatInput.jsx:208-220` | 浏览器默认行为 | 可加自定义撤销栈 | P4 | 视需要加 |

---

## 维度 6：无障碍 a11y（aria / keyboard nav / focus 管理）

| 问题 | 文件:行号 | 当前状态 | 商业产品标准 | 优先级 | 改法 |
|---|---|---|---|---|---|
| 全应用零 aria-label | `src/renderer/**` 全文 | `search_files('aria-')` 返回 0 结果 | 所有图标按钮 / 交互元素应有 aria-label | P1 | 给所有 icon-only button 加 aria-label |
| 极少 role 属性 | `Settings.jsx:60`、`ChatView.jsx:402` | 只有 `role="switch"` 两处（PermissionSwitch / 巡查开关） | 列表 / 对话框 / 菜单 / tab 应有 role | P1 | 给 ConversationList `role="list"`、ContextMenu `role="menu"`、EditPanel `role="dialog"` |
| 对话列表不可键盘导航 | `ConversationList.jsx:188-244` | `<button>` 可 Tab 但无 ↑/↓ 导航 | 应支持箭头键在列表项间移动 | P2 | 加 roving tabindex + 箭头键 |
| 消息列表不可键盘导航 | `MessageList.jsx:517-528` | 消息无 tabindex，不可 Tab 聚焦 | 应支持 Tab 在消息间聚焦 | P2 | 给消息气泡加 `tabindex=0` + aria-label |
| 弹窗无 focus trap | `NewChatDialog` / `EditPanel` / `ImageLightbox` | 无 focus trap 实现 | Tab 应在弹窗内循环 | P1 | 引入 focus-trap-react 或自实现 |
| 弹窗打开无 aria-modal / 无 Esc 关闭 | `AgentSettings.jsx:1020-1039` | EditPanel 遮罩点击关闭，无 Esc | 应 Esc 关闭 + aria-modal | P1 | 加 keydown Esc + aria-modal |
| 错误边界按钮无 aria-label | `App.jsx:46-51` | 「重试」按钮无 aria-label | 应有 aria-label | P3 | 加 aria-label |
| 状态圆点无 aria | `ChatView.jsx:456-461` | 状态圆点仅 `title`，无 aria-label / role | 应有 `aria-label="Agent 状态：工作中"` | P2 | 加 aria-label |
| color contrast 未验证 | 全文 | 大量 `var(--text-tertiary)` / `text-quaternary` 未验证对比度 | 应通过 WCAG AA | P2 | 用工具检测对比度 |
| 无屏幕阅读器跳过链接 | `App.jsx` 全文 | 无「跳到主内容」链接 | 应提供 skip link | P3 | 加 skip-to-main 链接 |
| 无 reduced-motion 完整支持 | `MessageList.jsx:19` 注释提到 globals.css 全局降级 | 部分支持 | 应全面支持 prefers-reduced-motion | P3 | 审查所有 animation |
| 对话列表搜索框无 aria-label | `ConversationList.jsx:628-647` | 搜索 input 无 aria-label，只有 placeholder | 应有 `aria-label="搜索联系人"` | P2 | 加 aria-label |

---

## 维度 7：国际化（i18n）

| 问题 | 文件:行号 | 当前状态 | 商业产品标准 | 优先级 | 改法 |
|---|---|---|---|---|---|
| 全应用硬编码中文 | 全部 17 个文件 | 所有 UI 文案硬编码中文（「登录」「发送」「保存」「加载中...」等） | 商业产品应支持 i18n（中 / 英 / 日等） | P1 | 引入 react-i18next，抽取所有文案到 locale 文件 |
| 时间格式硬编码 zh-CN | `ConversationList.jsx:73, 86` | `toLocaleTimeString('zh-CN')` / `toLocaleDateString('zh-CN')` | 应跟随用户 locale | P2 | 用 i18n 当前 locale |
| 错误消息硬编码中文 | `auth-store.js:120, 144, 185, 205` | `登录失败` / `注册失败` / `选择公司失败` / `创建公司失败` | 应 i18n + error code | P2 | 抽取到 locale |
| Agent 默认配置硬编码中文 | `agent-store.js:33-79` | 默认 Agent 名「秘书」「首席执行官」等硬编码 | 应支持本地化 | P3 | 默认配置走 i18n |
| 日期 / 货币格式未本地化 | `AgentSettings.jsx:329, 649` | `(salary.dailySalary || 0).toLocaleString()` 无 locale | 应跟随 locale | P3 | 传 locale 参数 |
| 无 RTL 支持 | 全文 | 布局默认 LTR | 商业产品应支持 RTL | P4 | 视市场需要 |
| 后端推送消息无 i18n | `useAgentIpcEvents.js:138, 165-170` | 错误消息和 Agent 推送内容直接显示 | 应按用户语言渲染 | P3 | 与后端约定语言字段 |

---

## 维度 8：性能（虚拟列表 / 懒加载 / memo）

| 问题 | 文件:行号 | 当前状态 | 商业产品标准 | 优先级 | 改法 |
|---|---|---|---|---|---|
| 消息列表无虚拟化 | `MessageList.jsx:516-528` | `visibleMessages.map` 全量渲染，长对话会卡 | 商业产品应虚拟化长列表（>200 条） | P1 | 引入 react-window / @tanstack/react-virtual |
| 联系人 / 群聊列表无虚拟化 | `ConversationList.jsx:695-745` | 全量 `.map` 渲染 | 成员多时应虚拟化 | P2 | 同上 |
| 页面无懒加载 | `App.jsx:7-14` | 静态 import 所有页面（Settings / AgentSettings / Dashboard / CFODashboard） | 应用首屏应只加载当前页 | P2 | 用 React.lazy + Suspense 懒加载非首屏页面 |
| `mountedPages` 延迟挂载但仍全量 import | `App.jsx:7-14, 82-83` | 延迟挂载但 JS bundle 仍包含所有页面 | 真懒加载应 code split | P2 | 配合 React.lazy |
| Dashboard 30s 轮询无 visibility 优化 | `Dashboard.jsx:81-88` | `isActive` 控制但未监听 `document.hidden` | 后台 tab 不应轮询 | P2 | 加 `visibilitychange` 监听 |
| ConversationList 多个 useMemo 依赖整个 Map | `ConversationList.jsx:469-512` | `allContacts / allDepartmentChats / allGroupChats` 依赖 `conversations` / `messagesByConversation` Map | 任意消息变化触发全列表重算 | P2 | 拆分订阅，只依赖当前需要的 slice |
| MessageList 订阅整个 `messagesByConversation` Map | `MessageList.jsx:229` | `messagesByConversation = useChatStore(s => s.messagesByConversation)` 全量订阅 | 任意对话消息变化都触发重渲染 | P1 | 只订阅当前对话的 messages：`useChatStore(s => s.messagesByConversation.get(currentConversationId))` |
| 流式 buffer 已优化（P2-7） | `useStreamBuffer` / `StreamingBubble` | 已用外部 buffer 避免每 chunk 全量重渲染 | 已达生产标准 | ✅ | 无需改 |
| ConversationList item 已 memo | `ConversationList.jsx:175, 261, 343` | `ContactItem / DepartmentItem / GroupItem` 都 `memo` | 已达生产标准 | ✅ | 无需改 |
| Mermaid 渲染无取消 / 无缓存 | `MermaidDiagram.jsx:33-49` | `cancelled` 标志但无缓存 | 重复渲染同一 chart 应缓存 | P3 | 加 chart → svg 缓存 |
| AgentSettings 1050 行单文件 | `AgentSettings.jsx` 全文 | 单文件 1050 行，多个组件混合 | 应拆分 | P3 | 拆 AgentCard / EditPanel / SalaryTable 到独立文件 |
| Settings 706 行单文件 | `Settings.jsx` 全文 | 单文件 706 行 | 应拆分 | P3 | 拆 PermissionSwitch / PathList / SettingsSection |
| Mermaid initialize 在模块顶层 | `MermaidDiagram.jsx:4-24` | 模块加载即初始化 mermaid | 应懒加载 mermaid 库 | P3 | 用动态 import |

---

## 维度 9：数据持久化（草稿 / 设置 / 滚动位置）

| 问题 | 文件:行号 | 当前状态 | 商业产品标准 | 优先级 | 改法 |
|---|---|---|---|---|---|
| 输入框草稿不持久化 | `ChatInput.jsx:115-119` | 切换对话 `setContent('')` 直接清空 | 切换对话应保存草稿，回到对话恢复 | P1 | 用 Map<conversationId, draft> 存草稿，持久化到 chat-store |
| 草稿不落盘 | `ChatInput.jsx` 全文 | 草稿仅在内存，刷新丢失 | 应持久化到文件 | P1 | 草稿纳入 chat-store persist |
| 滚动位置不记忆 | `MessageList.jsx:236-258` | 切换对话回到底部，不记忆上次位置 | 切回应恢复滚动位置 | P2 | 在 chat-store 存 `scrollPositionByConversation` Map |
| 侧栏宽度不持久化 | `ChatView.jsx:90` | `sidebarWidth` 仅 `useState(288)`，刷新丢失 | 应持久化用户偏好 | P2 | 持久化到 localStorage 或 IPC 配置 |
| 侧栏折叠不持久化 | `ChatView.jsx:91` | `sidebarCollapsed` 仅 useState | 应持久化 | P2 | 同上 |
| 视图模式不持久化 | `AgentSettings.jsx:688` | `viewMode` 仅 useState('chart')，刷新回 chart | 应持久化 | P3 | 持久化到用户配置 |
| 已选中 Agent 不持久化 | `AgentSettings.jsx:687` | `selectedId` 仅 useState，刷新丢失 | 可接受（刷新重置） | P4 | 视需要持久化 |
| 巡查开关状态不持久化 | `ChatView.jsx:39, 67-76` | 启动时从后端读，但前端 `patrolEnabled` 不存 | 已从后端读，可接受 | P4 | 无需改 |
| 搜索查询不持久化 | `ConversationList.jsx:452` | `searchQuery` 切对话清空，刷新丢失 | 切对话清空可接受 | P4 | 无需改 |
| chat-store persist 已实现（IPC 文件） | `chat-store.js:107-155` | 已通过 IPC 落盘 + 防抖 + beforeunload flush | 已达生产标准 | ✅ | 无需改 |
| auth-store 不持久化 session | `auth-store.js:58-99` | `checkSession` 从后端读，不持久化到 localStorage | 已由后端管理 session，可接受 | ✅ | 无需改 |

---

## 维度 10：用户体验细节（undo / redo / 右键菜单 / 拖拽）

| 问题 | 文件:行号 | 当前状态 | 商业产品标准 | 优先级 | 改法 |
|---|---|---|---|---|---|
| 无 undo / redo（消息删除不可撤销） | `MessageList.jsx:333-357` | 删除消息直接 `deleteMessages`，无撤销 | 应提供「撤销删除」toast（5s 内可撤销） | P1 | 删除时弹 toast「已删除 N 条消息，撤销」，5s 后真正删除 |
| 无消息编辑 | `MessageList.jsx` 全文 | 消息只能删除，不能编辑 | 商业产品应支持编辑已发送消息 | P2 | 加编辑入口 + inline 编辑 |
| 无消息复制按钮 | `MessageList.jsx` 右键菜单 `ContextMenu` | 右键菜单只有「删除」「多选」 | 应有「复制」「复制 markdown」「引用回复」 | P2 | 扩展 ContextMenu |
| 无消息转发 | 全文 | 无转发功能 | 商业产品应支持转发 | P3 | 加转发到其他对话 |
| 无消息引用回复 | 全文 | 无 reply 引用 | 应支持引用回复 | P3 | 加 reply 按钮 |
| 无消息 reactions | 全文 | 无 emoji 反应 | 商业产品应支持 reactions | P4 | 视需要 |
| 侧栏拖拽已实现 | `ChatView.jsx:125-224` | 橡皮筋 + 速度感知 + snap | 已达生产标准 | ✅ | 无需改 |
| 消息拖拽无 | 全文 | 消息不可拖拽到其他对话 | 可选功能 | P4 | 视需要 |
| 图片灯箱无缩放 / 平移 | `MessageList.jsx:122-181` | 仅点击关闭，无缩放 | 应支持滚轮缩放 + 拖拽平移 | P3 | 加缩放 / 平移手势 |
| 无触屏手势支持 | 全文 | 无 touch 事件处理 | 触屏设备应支持 swipe 切换对话 | P3 | 加 touch 事件 |

---

## 维度 11：响应式（窗口缩放 / 小屏幕）

| 问题 | 文件:行号 | 当前状态 | 商业产品标准 | 优先级 | 改法 |
|---|---|---|---|---|---|
| 固定 `h-screen w-screen` 布局 | `App.jsx:144` | `relative w-screen h-screen overflow-hidden` | Electron 窗口缩放应自适应 | P2 | 用 flex / grid 自适应 |
| 侧栏宽度拖拽有 min/max | `ChatView.jsx:96-100` | MIN=200, MAX=500 | 可接受 | P4 | 无需改 |
| 小窗口侧栏挤压主区 | `ChatView.jsx:284-425` | 侧栏 200px + 手柄 4px，主区被挤 | 窗口 <600px 时应自动折叠侧栏 | P2 | 加窗口宽度监听，<600 自动折叠 |
| Dashboard 固定 max-w-[1400px] | `Dashboard.jsx:134` | 大屏居中，小屏可滚动 | 可接受 | P4 | 无需改 |
| Settings 固定 max-w-3xl | `Settings.jsx:364` | 大屏居中 | 可接受 | P4 | 无需改 |
| 无断点响应式（md / lg） | `Dashboard.jsx:171` | `grid-cols-2 md:grid-cols-3 lg:grid-cols-6` 有 Tailwind 响应式 | 但 Tailwind 断点基于浏览器宽度，Electron 窗口宽度变化也生效 | ✅ | 无需改 |
| 无最小窗口尺寸 | `App.jsx` / main 进程 | 未发现 `minWidth/minHeight` 设置 | 应在 main 进程设最小窗口尺寸 | P2 | 在 window-manager 设 minWidth=800, minHeight=600 |
| 字体大小固定 px | 全文 | 大量 `text-[13px]` `text-[11px]` | 应支持系统字体缩放（a11y） | P3 | 用 rem 或跟随系统 |

---

## 维度 12：状态管理（store 结构 / optimistic update）

| 问题 | 文件:行号 | 当前状态 | 商业产品标准 | 优先级 | 改法 |
|---|---|---|---|---|---|
| 消息发送无 optimistic update | `useChatAgent.js:109-114, 133-139` | 先创建空 agent 消息，失败时 `updateMessage` 改状态 | 已是 optimistic 模式 | ✅ | 无需改 |
| 群聊消息提交无 optimistic | `useChatAgent.js:205-218` | `submitGroupMessage` 失败只 console.warn，不回滚 | 应 optimistic 添加 + 失败回滚 | P2 | 失败时移除用户消息并提示 |
| Agent 状态更新无 optimistic | `agent-store.js:261-304` | `updateAgent` 直接 set | 可接受 | P4 | 无需改 |
| chat-store 结构含 Map / Set 需手动序列化 | `chat-store.js:88-100, 113-125` | `ipcFileStorage` 手动转 Map ↔ Object | 已实现，但复杂易错 | P2 | 考虑改用普通对象 + selector |
| auth-store 与 chat-store 耦合 | `auth-store.js:6, 18-56` | `resetChatForCompany` 直接操作 `useChatStore` | store 间耦合增加维护成本 | P3 | 用事件 / middleware 解耦 |
| 无 devtools / 时间旅行 | 全文 | Zustand 无 devtools middleware | 开发应支持 devtools | P3 | 加 `devtools` middleware（仅 dev） |
| 流式 buffer 外置（P2-7） | `useStreamBuffer.js` + `chat-store.js:607-609` | 已外置 buffer 避免每 chunk set | 已达生产标准 | ✅ | 无需改 |
| subscribe 整个 Map 导致全量重渲染 | `MessageList.jsx:229`、`ConversationList.jsx:442-443` | 订阅 `messagesByConversation` / `conversations` 整个 Map | 应细粒度订阅 | P1 | 用 selector + shallow 比较 |
| agent-store `agents` Map 全量订阅 | `ConversationList.jsx:441` | `agentsMap = useAgentStore(s => s.agents)` | 任意 agent 变化触发全列表重算 | P2 | 拆分订阅 |

---

## 维度 13：IPC 健壮性（超时 / 重连 / loading）

| 问题 | 文件:行号 | 当前状态 | 商业产品标准 | 优先级 | 改法 |
|---|---|---|---|---|---|
| IPC 调用无超时 | `preload.js` 全部 `ipcRenderer.invoke` | 无超时包装 | 应有超时 + 重试 | P1 | 包一层 `invokeWithTimeout(channel, args, timeoutMs)` |
| IPC 调用无 loading 指示 | `useChatAgent.js:123-130`、`auth-store.js:105` 等 | 多数 invoke 无 loading 状态 | 长操作应有 loading | P2 | 关键操作加 loading state |
| IPC 无重连机制 | `useAgentIpcEvents.js:39-66` 等 | `onStream` 订阅失败直接 `return`，不重试 | 应在主进程重启后自动重连 | P1 | 加重连逻辑（监听 webContents 重建事件） |
| 流式消息无心跳 / 超时检测 | `useChatAgent.js:123-141` | 发起后等待 `onComplete`，无超时 | Agent 卡死时应超时提示 | P1 | 加 watchdog 定时器，N 秒无 chunk 视为超时 |
| preload 未校验 invoke 参数 | `preload.js:181, 194` 等 | `sendMessage(request)` 直接传给 ipcRenderer，无 schema 校验 | 应校验参数 | P2 | 加 zod / 手动校验 |
| IPC 错误无统一处理 | 全文 | 每个 catch 各自 console.error | 应有统一 error handler + 上报 | P2 | 加 `ipcError` 工具 |
| chat-ipc-handlers 流式无超时 | `chat-ipc-handlers.js:50-89` | `(async () => { ... })()` 无超时 | 主进程应设超时 | P1 | 加超时 + 发 CHAT_COMPLETE error |
| groupQueue.submit 无超时 | `chat-ipc-handlers.js:193-214` | 直接 await，无超时 | 应有超时 | P2 | 加超时 |
| preload 内联 CHANNELS 与 shared 重复 | `preload.js:10-121` | 内联定义 CHANNELS，与 `shared/ipc-channels.js` 重复 | 应复用，避免漂移 | P3 | sandbox 限制下可接受，但应加同步测试 |
| 部分通道字符串硬编码未进 CHANNELS | `chat-ipc-handlers.js:144`、`preload.js:414, 424-499` | `chat:dept-group-post` / `agent-config:changed` / `operations:clear-recruit-processed` 等硬编码 | 应统一到 ipc-channels.js | P3 | 抽取到 shared |

---

## 维度 14：安全（XSS / dangerouslySetInnerHTML / CSP）

| 问题 | 文件:行号 | 当前状态 | 商业产品标准 | 优先级 | 改法 |
|---|---|---|---|---|---|
| Mermaid 用 dangerouslySetInnerHTML | `MermaidDiagram.jsx:71` | `dangerouslySetInnerHTML={{ __html: svg }}` 直接渲染 mermaid 输出 | mermaid 输出可能含恶意 SVG（onload 等） | P1 | 用 DOMPurify 清洗 SVG，或 mermaid 的 `securityLevel: 'strict'` |
| mermaid securityLevel 未设为 strict | `MermaidDiagram.jsx:4-24` | `mermaid.initialize` 未设 `securityLevel` | 默认 `strict` 才安全 | P1 | 加 `securityLevel: 'strict'` |
| 无 CSP | `src/main` 全文 | 未发现 `Content-Security-Policy` 设置 | Electron 应设严格 CSP | P1 | 在 main 进程设 `onHeadersReceived` 注入 CSP |
| 附件 base64 直接渲染 | `preload.js:329` | `getBase64` 返回 base64，前端 `<img src={base64}>` | 可接受，但应限制来源 | P3 | 校验 filePath 在允许目录 |
| 外部链接未校验 | `preload.js:442` | `openExternal(url)` 未校验 url 协议 | 应只允许 http/https | P2 | 在 main 进程校验协议 |
| browser-pool contextIsolation=false | `src/main/tools/browser-pool.js:67-71` | `contextIsolation: false, sandbox: false` | 工具池 browser 安全降级 | P2 | 评估是否必需，能用 contextIsolation 就开 |
| 渲染进程无 nodeIntegration | `window-manager.js:65-69` | `contextIsolation: true, nodeIntegration: false, sandbox: true` | 已达生产标准 | ✅ | 无需改 |
| 用户输入内容未过滤即渲染 | `MessageList.jsx` → `MessageBubble` | Agent / 用户消息直接渲染 markdown | react-markdown 默认安全，但应禁用 `html: true` | P3 | 确认 rehype 未启用 raw HTML |
| preload 暴露 API 较多 | `preload.js:123-527` | 暴露大量 API（99 个 invoke） | 应最小化暴露 | P3 | 审计是否全部必要 |
| 聊天历史文件存储无加密 | `chat-store.js:99` | `setChatHistory` 写明文 JSON | 敏感数据应加密 | P3 | 视需求加加密 |

---

## 维度 15：可维护性（组件大小 / 重复代码 / 类型检查）

| 问题 | 文件:行号 | 当前状态 | 商业产品标准 | 优先级 | 改法 |
|---|---|---|---|---|---|
| AgentSettings 1050 行单文件 | `AgentSettings.jsx` | 含 StatusBadge / AgentCard / EditPanel / SalaryTable / AgentSettings 5 个组件 | 应拆分到独立文件 | P2 | 拆分到 `pages/AgentSettings/` 目录 |
| Settings 706 行单文件 | `Settings.jsx` | 含 SectionBoundary / PermissionSwitch / PathList / SettingsSection / Settings | 应拆分 | P2 | 拆分 |
| ChatView 533 行含拖拽逻辑 | `ChatView.jsx:105-224` | 橡皮筋 / 速度感知 / snap 逻辑 120 行混在组件内 | 应抽到 hook | P2 | 抽 `useResizableSidebar` hook |
| ConversationList 重复 cleanExcerpt / excerpt 截断逻辑 | `ConversationList.jsx:28-58, 176-183, 263-269, 345-351` | 3 个 item 组件重复 cleanExcerpt + 截断 28 字 | 应抽公共函数 | P3 | 抽 `useExcerpt` 或在 item 内复用 |
| 无 TypeScript | 全部 17 个文件 | 纯 JS，仅 `ipc-types.d.ts` 类型定义 | 商业产品应有类型检查 | P1 | 迁移到 TS（至少 store / hooks / 关键组件） |
| 无 ESLint / Prettier 配置 | 项目根 | `package.json` devDeps 无 eslint / prettier | 应有代码规范工具 | P2 | 加 ESLint + Prettier |
| 无单元测试 | 项目根 | devDeps 无测试框架 | 应有 vitest / jest | P1 | 加测试框架 + 关键逻辑测试 |
| chat-agent-logic 已拆纯函数 | `chat-agent-logic.js` | 已拆出纯函数可单测 | 已达生产标准 | ✅ | 无需改 |
| preload CHANNELS 重复定义 | `preload.js:10-121` vs `shared/ipc-channels.js` | 两处定义易漂移 | 应同步 | P3 | 加同步测试 |
| MessageList 611 行含多个组件 | `MessageList.jsx` | StreamingBubble / ContextMenu / ImageLightbox / SelectionBar / MessageList | 应拆分 | P3 | 拆分到独立文件 |
| 大量内联 style | 全文 | `style={{ ... }}` 遍地 | 应抽到 CSS / className | P3 | 视情况抽取 |

---

## 维度 16：移动端 / 触屏适配

| 问题 | 文件:行号 | 当前状态 | 商业产品标准 | 优先级 | 改法 |
|---|---|---|---|---|---|
| 无触屏事件 | `ChatView.jsx:125-224` | 拖拽仅 `mousedown/move/up`，无 `touchstart/move/end` | 触屏设备应支持触摸拖拽 | P3 | 加 touch 事件 |
| 无手势支持 | 全文 | 无 swipe / pinch | 应支持 swipe 切换对话、pinch 缩放图片 | P3 | 加手势识别 |
| 无 viewport meta | `index.html`（未读但 Electron 渲染） | Electron 桌面端无移动端 viewport | 桌面端可接受 | P4 | 若有移动端apk则需 |
| 已有 Android apk | 根目录 `SoloForge-Mobile-*.apk` | 存在移动端打包，但前端代码未触屏适配 | 移动端应专门适配 | P2 | 移动端单独适配或共享逻辑分离 |
| 按钮无 min touch target | 全文 | 多处 `p-1` `w-4 h-4` 图标按钮 < 44px | 触屏应 ≥44px | P3 | 触屏增大命中区 |
| 无 hover 替代 | 全文 | 大量 `hover:bg-...` `group-hover:opacity-100`（隐藏按钮） | 触屏无 hover，隐藏按钮不可达 | P3 | 触屏显示操作按钮或长按菜单 |

---

## 维度 17：多窗口 / 多标签

| 问题 | 文件:行号 | 当前状态 | 商业产品标准 | 优先级 | 改法 |
|---|---|---|---|---|---|
| 无多会话同时打开 | `App.jsx:144-193` | 单窗口单会话，`currentConversationId` 全局单值 | 商业产品应支持多会话 tab 或多窗口 | P2 | 加 tab 栏或多窗口支持 |
| PageSlot 用 CSS display 切换保状态 | `App.jsx:62-73, 145-191` | 已用 `opacity + visibility` 保留所有页面状态 | 已达生产标准（保状态） | ✅ | 无需改 |
| 无多窗口支持 | `window-manager.js`（未细读） | 单 BrowserWindow | 应支持多窗口（如弹出独立对话窗） | P3 | 视需要 |
| 切换对话丢失多选 / 右键菜单状态 | `MessageList.jsx:277-281` | `useEffect` 切对话清空多选 | 可接受（切对话应重置） | ✅ | 无需改 |
| 无法同时查看多个对话 | 全文 | 单 currentConversationId | 商业产品可分屏查看多个对话 | P4 | 视需要 |
| 无最近对话切换（Cmd+Shift+[ ]） | 全文 | 无快捷键切换对话 | 应支持快捷切换 | P3 | 加快捷键 |

---

## 维度 18：通知系统（桌面通知 / 未读提醒）

| 问题 | 文件:行号 | 当前状态 | 商业产品标准 | 优先级 | 改法 |
|---|---|---|---|---|---|
| 无桌面通知 | 全文 | `search_files('Notification')` 渲染层 0 结果 | Agent 主动消息 / 群聊消息应有桌面通知 | P1 | 用 Electron `Notification` API，主进程触发 |
| 未读消息仅 badge | `ConversationList.jsx:120-136` | `UnreadBadge` 显示数字 | 应有桌面通知 + 任务栏角标 + 声音 | P1 | 加桌面通知 + dock badge |
| Agent 主动推送无通知 | `useAgentIpcEvents.js:151-176` | `onProactiveMessage` 只加消息到 store，无通知 | 应弹桌面通知 | P1 | 收到 proactive 时触发 Notification |
| 群聊消息无通知 | `useAgentIpcEvents.js:285-317` | `onDeptGroupMessage` 只加消息，无通知 | 非当前对话应有通知 | P1 | 非当前对话群聊消息触发通知 |
| 无未读总数角标 | 全文 | 无 dock / 任务栏角标 | 应有未读总数角标 | P2 | 主进程设 `app.dock.setBadge` |
| 无声音提醒 | 全文 | 无声音 | 可选 | P4 | 视需要 |
| 无通知免打扰 | 全文 | 无设置 | 应支持免打扰时段 | P3 | 加设置项 |
| 巡查通知仅发到聊天 | `src/main/patrol/task-patrol.js:1150-1153` | `_pushNotifications` 推到 chatManager | 应同时桌面通知 | P2 | 同步触发桌面通知 |

---

## 维度 19：设置持久化（主题 / 侧栏宽度 / 排序）

| 问题 | 文件:行号 | 当前状态 | 商业产品标准 | 优先级 | 改法 |
|---|---|---|---|---|---|
| 主题持久化已实现 | `ThemeToggle.jsx`（未读但存在） | 有 ThemeToggle 组件 | 需确认是否持久化 | 需查 | 检查 ThemeToggle 实现 |
| 侧栏宽度不持久化 | `ChatView.jsx:90` | `useState(288)` | 应持久化 | P2 | 持久化到配置 |
| 侧栏折叠不持久化 | `ChatView.jsx:91` | `useState(false)` | 应持久化 | P2 | 同上 |
| AgentSettings 视图模式不持久化 | `AgentSettings.jsx:688` | `useState('chart')` | 应持久化 | P3 | 持久化 |
| 联系人排序不持久化 | `ConversationList.jsx:480` | 固定按 lastTime | 无排序选项 | P4 | 加排序 + 持久化 |
| 巡查开关已从后端读 | `ChatView.jsx:67-76` | `getPatrolStatus` | 已持久化在后端 | ✅ | 无需改 |
| 老板配置已持久化 | `agent-store.js:126-132` | `getBossConfig` / `updateBossConfig` | 已达生产标准 | ✅ | 无需改 |
| Agent 配置已持久化 | `agent-store.js:105-153` | `getAgentConfigs` / `updateAgentConfig` | 已达生产标准 | ✅ | 无需改 |
| 权限配置已持久化 | `Settings.jsx:258-283` | `getPermissions` / `updatePermissions` | 已达生产标准 | ✅ | 无需改 |
| 聊天历史已持久化 | `chat-store.js:107-155` | IPC 文件存储 + 防抖 | 已达生产标准 | ✅ | 无需改 |
| 输入框草稿不持久化 | `ChatInput.jsx:115-119` | 切对话清空 | 应持久化草稿 | P1 | 见维度 9 |

---

## 维度 20：更新机制（自动更新 / 版本信息）

| 问题 | 文件:行号 | 当前状态 | 商业产品标准 | 优先级 | 改法 |
|---|---|---|---|---|---|
| 无自动更新 | `package.json` / `src/main` 全文 | 无 `electron-updater` 依赖，无 `checkForUpdates` | 商业产品应自动检查更新 | P1 | 集成 electron-updater + GitHub Releases / 自建更新源 |
| 无版本信息显示 | `App.jsx` / `Settings.jsx` 全文 | 无「关于」页面 / 版本号显示 | 应在设置或关于页显示版本 | P2 | 加版本号显示（`window.soloforge.getVersion()` 已暴露但未用） |
| 无更新检查 UI | 全文 | 无 | 应有「检查更新」按钮 + 进度 + 重启提示 | P1 | 加更新检查 UI |
| 无 changelog 展示 | 全文 | 有 `CHANGELOG.md` 但未在应用内展示 | 应在更新提示时展示 changelog | P3 | 加 changelog 渲染 |
| 无强制更新 / 版本下限 | 全文 | 无 | 关键安全更新可强制 | P3 | 视需要 |
| `app:get-version` 已暴露但未使用 | `preload.js:125` | `getVersion: () => ipcRenderer.invoke(CHANNELS.APP_GET_VERSION)` | 通道已存在，前端未调用 | P2 | 在「关于」页调用并显示 |
| 无更新通道配置 | `package.json build` | 无 `publish` 配置 | electron-builder 需配 publish | P2 | 加 publish 配置 |

---

## Top 10 最不生产化的点 + 改造优先级

| 排名 | 问题 | 维度 | 影响面 | 优先级 | 改造工作量 |
|---|---|---|---|---|---|
| 1 | Mermaid `dangerouslySetInnerHTML` + 无 `securityLevel: strict` + 无 CSP（XSS 风险） | 14 安全 | 任意 Agent 输出恶意 mermaid 可执行代码 | **P0** | 0.5 天 |
| 2 | 无桌面通知系统（Agent 主动消息 / 群聊消息 / 巡查通知无桌面提醒） | 18 通知 | 用户离开窗口时错过所有重要消息 | **P0** | 1-2 天 |
| 3 | 全应用零 aria-label / 无 focus trap / 弹窗无 Esc / 无键盘导航（a11y 严重缺失） | 6 a11y | 不可访问，不符合商业产品基本要求 | **P0** | 3-5 天 |
| 4 | IPC 无超时 / 无重连 + 流式无 watchdog（Agent 卡死时无限等待） | 13 IPC | 单个 Agent 卡死 → 整个对话永久 loading | **P0** | 1-2 天 |
| 5 | 无 i18n（全应用硬编码中文） | 7 i18n | 无法进入非中文市场 | **P1** | 5-10 天 |
| 6 | 无 TypeScript / 无测试框架 / 大文件未拆分 | 15 可维护性 | 工程质量不达标，迭代风险高 | **P1** | 持续投入 |
| 7 | 消息列表 / 联系人列表无虚拟化 + 订阅整个 Map 导致全量重渲染 | 8 性能 | 长对话 / 多成员时卡顿 | **P1** | 2-3 天 |
| 8 | 输入框草稿不持久化 + 滚动位置不记忆 + 侧栏宽度不持久化 | 9 持久化 | 切换 / 刷新丢失用户状态，体验差 | **P1** | 1-2 天 |
| 9 | 无自动更新机制 + 无版本信息显示 | 20 更新 | 无法线上分发更新，用户无法知版本 | **P1** | 2-3 天 |
| 10 | 无 undo / 撤销删除 + 无消息编辑 / 复制 / 转发 | 10 UX | 误操作不可逆，消息管理能力弱 | **P1** | 2-4 天 |

### 改造路线图建议

**Phase 0（安全 + 基础可用，1 周）**
- 修 Mermaid XSS（DOMPurify + securityLevel: strict）
- 主进程加 CSP
- IPC 加超时 + watchdog
- 加桌面通知（Agent 主动 / 群聊 / 巡查）

**Phase 1（生产化基础，2-3 周）**
- a11y 补齐（aria-label / focus trap / 键盘导航 / Esc）
- 引入 i18n 框架 + 抽取文案
- 引入 TypeScript + 测试框架
- 性能优化（虚拟列表 + 细粒度订阅 + 懒加载）
- 草稿 / 滚动位置 / 侧栏宽度持久化
- 集成 electron-updater

**Phase 2（体验完善，2-3 周）**
- undo / 撤销删除
- 消息编辑 / 复制 / 转发 / 引用
- 全局快捷键（Cmd+K 命令面板 / Cmd+N / Esc）
- 骨架屏 + 错误重试
- 大文件拆分（AgentSettings / Settings / ChatView）

**Phase 3（增强，2 周）**
- 全文搜索消息内容
- 触屏 / 手势适配
- 多会话 tab / 多窗口
- 通知免打扰 + 声音
- changelog 展示

---

## 附录：已达生产标准的点（无需改）

| 点 | 文件:行号 | 说明 |
|---|---|---|
| 流式 buffer 外置优化 | `useStreamBuffer.js` + `chat-store.js:607-609` | P2-7 已优化，避免每 chunk 全量重渲染 |
| ConversationList item memo | `ConversationList.jsx:175, 261, 343` | ContactItem / DepartmentItem / GroupItem 已 memo |
| 渲染进程安全配置 | `window-manager.js:65-69` | contextIsolation: true, nodeIntegration: false, sandbox: true |
| chat-store 持久化 | `chat-store.js:107-155` | IPC 文件存储 + 防抖 + beforeunload flush |
| chat-agent-logic 纯函数拆分 | `chat-agent-logic.js` | 已拆出可单测纯函数 |
| 侧栏拖拽橡皮筋 + 速度感知 | `ChatView.jsx:105-224` | 已实现 Apple 风格橡皮筋 + flick snap |
| PageSlot 保状态 | `App.jsx:62-73` | CSS display 切换避免重挂载 |
| Agent / 权限 / 老板配置持久化 | `agent-store.js` / `Settings.jsx` | 均通过 IPC 落盘 |
| 流式 optimistic 消息 | `useChatAgent.js:109-114` | 先建空消息再流式填充 |
| 巡查开关后端持久化 | `ChatView.jsx:67-76` | 从后端读状态 |

---

**报告结束。** 共审计 17 个文件、20 个维度，发现 100+ 个不生产化点，其中 P0 级 4 项、P1 级 10+ 项。建议按 Phase 0 → 1 → 2 → 3 路线图推进改造。

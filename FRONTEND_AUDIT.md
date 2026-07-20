# SoloForge 前端"丑"点审计报告

**审计范围**：`src/renderer/` 下全部 React 组件（约 40 个 .jsx/.tsx）
**审计维度**：间距 / 颜色 / 圆角 / 字体 / 阴影 / 边框 / 背景 / 动画 / 比例 / 密度 / 对齐 / 空状态 / 滚动 / 暗色 / 响应式
**审计方式**：源码静态分析 + 设计 token 系统对照（globals.css / tailwind.config.js）+ 实时 CSS 变量校验

---

## 0. 设计系统基线（健康部分）

SoloForge 已建立一套完整的 Linear 风格设计系统，是审计的基准：

- `globals.css` 定义 CSS 变量 token：`--bg-base/panel/surface/hover/active`、`--text-primary/secondary/tertiary/quaternary`、`--accent(+hover/active/subtle)`、`--color-success/warning/danger`、`--border-subtle/default/strong`、`--radius-sm/md/lg/xl/2xl`、`--shadow-*`、`--ease-*`、`--duration-*`
- `tailwind.config.js` 把这些 token 映射成 Tailwind 语义类（`bg-bg-base`、`text-text-primary`、`border-border-default`、`rounded-lg` 等）
- `emil-styles.css` 落实 Emil Kowalski 精修：只动 transform/opacity、`:active scale(0.97)`、`@starting-style`、`prefers-reduced-motion` 降级
- `dashboard/ui.jsx` 提供统一 `EmptyState` / `Pagination` / `ProgressBar` / `StatusDot` / `Badge`，全部走 token

**健康组件**（完全遵循 token 系统）：`ChatView`、`ConversationList`、`MessageBubble`、`MessageList`、`dashboard/*`、`CompanySelectPage`、`AgentSettings`、`Settings`、`ReportViewer`、`sync/SyncPanel`（除 LoginDialog）

---

## 1. 【严重 BUG】`--color-primary` token 不存在 → 加载 spinner 不可见

**证据**：`globals.css` 定义的全部 CSS 变量里**没有** `--color-primary`（已用 grep 列出全部 40+ 变量确认，且 tailwind.config.js 也未定义）。但代码里大量引用它：

| 文件 | 行号 | 用法 |
|------|------|------|
| `App.jsx` | 124 | `border-[var(--color-primary)] border-t-transparent` （登录检查 loading） |
| `App.jsx` | 137 | 同上（chat store hydrate loading） |
| `TodoPanel.jsx` | 35,36,60,124,139,234,242,257 | `text-[var(--color-primary)]` / `bg-[var(--color-primary)]` 共 8 处 |

**后果**：`App.jsx` 里两个全屏 loading 的 spinner 圆环 `border` 解析为空值（初始值 `medium currentColor` 但这里连边框宽度都没写 `border-3` 实际上 Tailwind 不存在 `border-3`，只有 `border`/`border-2`/`border-4`/`border-8`）—— spinner **边框颜色为空 + 边框宽度未生效**，用户看到的是一片空白或一根 1px 细线在转，而非 accent 紫色圆环。TodoPanel 的"进行中"状态也全部失色。

**修复**：
- `App.jsx` 124/137：`border-[var(--color-primary)]` → `border-accent`，`border-3` → `border-2`（Tailwind 无 `border-3`）
- `TodoPanel.jsx` 8 处 `--color-primary` → `--accent`（用 Tailwind 类 `text-accent` / `bg-accent`）

---

## 2. 【最丑】`CFODashboard.jsx` 完全脱离设计系统

`src/renderer/components/cfo/CFODashboard.jsx`（532 行）是全应用唯一一个**系统性走原生 Tailwind 调色板**的页面，与其余界面视觉割裂严重：

**颜色**（应改为 token）：
- `bg-white dark:bg-gray-800` ×5（卡片/弹窗背景，应用 `bg-bg-surface` 或 `surface` 类）
- `bg-gray-200 dark:bg-gray-700` ×1（进度条轨道，应用 `bg-white/[0.04]` 或 `ProgressBar` 组件）
- `bg-gray-50 dark:bg-gray-950` ×1（整页背景，应用 `bg-bg-base`）
- `text-gray-900 dark:text-gray-100` ×多处（应用 `text-text-primary`）
- `text-gray-500/600/700 dark:text-gray-300/400/500` ×多处（应用 `text-text-secondary`/`text-tertiary`/`text-quaternary`）
- `border-gray-200/300 dark:border-gray-600/700` ×多处（应用 `border-border-default`/`border-border-subtle`）
- `bg-green-500` / `bg-red-500` / `bg-orange-500` / `bg-yellow-500`（ProgressBar 阈值色，应用 `--color-success`/`--color-danger`/`--color-warning`）
- `bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400`（透支徽章，应造语义 Badge）
- `bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200`（AlertItem，同上）
- `bg-blue-500 text-white` / `bg-blue-600 hover:bg-blue-700`（选中 tab + 确认按钮，应用 `btn-primary` / `bg-accent`）
- `text-blue-500 hover:text-blue-700` / `text-green-500 hover:text-green-700`（调薪/发奖金链接，应用 `text-accent` / `text-success`）

**圆角**：`rounded-xl` / `rounded-lg` / `rounded-full` 直接用 Tailwind 档位，应统一用 `rounded-lg`(12px)/`rounded-md`(8px) token 命名以保持语义一致。

**阴影**：`shadow-sm` / `shadow-xl` 原生类，应改 `shadow-elevated` / `shadow-dialog` 或用 `surface` 类。

**弹窗**：`fixed inset-0 bg-black/50 ... z-50` 自造遮罩，与全局 `ConfirmDialog` / `CompanySelectPage` 的 `surface + shadow-dialog + animate-scale-in` 模式不一致；缺 `@starting-style` 入场动画，缺 ESC 关闭，缺 backdrop-blur。

**空状态**：`text-gray-500 dark:text-gray-400 text-center py-8 暂无数据/暂无预警` 是裸 div，应复用 `dashboard/ui.jsx` 的 `<EmptyState icon={...} message="..." />`。

**loading 态**：`text-gray-500 加载中...` 同样裸 div，无 spinner，与 App.jsx 的 spinner 模式不一致。

**预估工作量**：1.5~2h 重写为 token 版本。

---

## 3. `LoginDialog.jsx`（同步登录弹窗）同样脱离系统

`src/renderer/components/sync/LoginDialog.jsx`（119 行）是另一个原生 Tailwind 孤岛：

- `bg-white dark:bg-gray-800 rounded-lg shadow-xl` 弹窗
- `border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700` 输入框（应用 `.input` 类）
- `focus:ring-2 focus:ring-blue-500` 聚焦环（应用 `--accent` 环，`.input:focus` 已内置）
- `bg-blue-600 hover:bg-blue-700 text-white rounded-md` 按钮（应用 `.btn-primary`）
- `text-gray-900 dark:text-white` / `text-gray-400 hover:text-gray-600` 标题与关闭
- `text-red-600 dark:text-red-400` 错误（应用 `text-danger`）
- `bg-black/50` 遮罩无 backdrop-blur，与 `CompanySelectPage` 的 `bg-black/50 backdrop-blur-sm` 不一致

**对比讽刺**：同目录的 `SyncPanel.jsx` / `SyncStatus.jsx` 已正确用 token。LoginDialog 是漏网之鱼。

**修复**：1h，参照 `LoginPage.jsx`（已正确）的模式重写。

---

## 4. `TodoPanel.jsx` 的"已完成"状态用 `bg-green-500` 而非语义色

`src/renderer/components/chat/TodoPanel.jsx:41-43`：
```
done: {
  className: 'text-green-500',
  dotClass: 'bg-green-500',
}
```
第 58 行：`<CheckCircleIcon className="w-3.5 h-3.5 text-green-500 emil-dot-enter" />`

**问题**：设计系统已有 `--color-success: #4ade80`（暗）/ `#16a34a`（亮），应改 `text-success` / `bg-success`。同一文件其余状态（pending/in_progress）已用 token，唯独 done 漏改。且 `in_progress` 用了不存在的 `--color-primary`（见第 1 条）。

**修复**：5 分钟，`green-500` → `success`，`--color-primary` → `accent`。

---

## 5. `App.jsx` ErrorBoundary 用 `bg-blue-500` 应急按钮

`src/renderer/App.jsx:48`：
```
className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm"
```
崩溃兜底页的"重试"按钮硬编码蓝色，且 `transition-colors`（原生长度）未走系统 `--duration-press`。应改 `btn-primary` 类（已内置 accent + scale(0.97) 压迫反馈 + 正确时长）。

**修复**：1 分钟，`className="btn-primary px-4 py-2"`。

---

## 6. 全局 `rounded-*` 语义混乱：39/40 组件用原生 Tailwind 圆角档

`tailwind.config.js` 已把 `rounded-sm/md/lg/xl/2xl` 映射到 `--radius-*` token，所以 `rounded-lg` 在数值上**是正确的**。问题在于：

- **`rounded-full`** 被 13+ 文件滥用（toggle thumb、头像、状态点、徽章、滚动条）—— `rounded-full` 不在 token 映射里，是 Tailwind 内置 9999px，这点 OK。
- 但 **`rounded-md` vs `rounded-lg` 的选择缺乏规范**：同一类"按钮"在不同文件混用 `rounded-md`(8px) 和 `rounded-lg`(12px)。`globals.css` 注释明确"按钮/输入=md(8px)、卡片=lg(12px)、面板=xl(16px)"，但实际：
  - `MessageList.jsx:90` 上下文菜单用 `rounded-lg`（应 `rounded-md`，是菜单非卡片）
  - `ConversationList.jsx:124` 徽章用 `rounded-full` ✓ 但同文件 218 行标题用裸 `truncate`
  - `CFODashboard` 整页 `rounded-xl`(16px) 卡片，违反"卡片=lg(12px)"约定

- **缺失中间档**：token 只有 4/8/12/16/20，但多处用 `rounded-2xl`(20px) 给弹窗是对的，用 `rounded-3xl` 的没有——尚可。但 `radius-full` 没进 token 命名（globals.css 定义了 `--radius-full:9999px` 但 tailwind.config 没 map），导致 `rounded-full` 是 Tailwind 原生值而非 `var(--radius-full)`，轻微不一致。

**建议**：补 `rounded-full` 到 tailwind.config 映射（`full: 'var(--radius-full)'`），并在 CONTRIBUTING 里固化"按钮=md/卡片=lg/面板=xl/大容器=2xl"对照表。

---

## 7. 任意值 `text-[Npx]` 泛滥，缺字号阶梯 token

全应用 20+ 处硬编码像素字号，无统一 type scale：

| 文件 | 用法 | 语义 |
|------|------|------|
| ChatView.jsx | `text-[13px]` ×4, `text-[12px]` ×2, `text-[11px]` ×1 | 侧栏标题/公司名 |
| ConversationList.jsx | `text-[13px]` ×3, `text-[11px]` ×3, `text-[10px]` ×3, `text-[8px]` ×1 | 会话项 |
| MessageBubble.jsx | `text-[11px]` | 错误提示 |
| ChatInput.jsx | `text-[10px]` | 附件名 |
| TodoPanel.jsx | `text-[12px]`, `text-[10px]` | todo 内容 |

**问题**：`11px`、`10px`、`8px` 低于可读性下限（WCAG 建议正文 ≥12px）；同一"会话标题"在 ConversationList 用 `13px`，在 ChatView 也用 `13px`（一致），但 `11px`/`12px`/`10px` 三档间无清晰语义（meta? timestamp? badge?）。

**修复**：在 tailwind.config 加 type scale token：`xs:11px` / `meta:10px` / `caption:11px`，或直接用 Tailwind `text-xs`(12px)/`text-[11px]` 收敛到两档。`text-[8px]` 必须删（会话角标 `text-[8px]` 不可读）。

---

## 8. 动画类 `transition-all` 违反 Emil 规范

`globals.css` 顶部明确写"Emil：**只动 transform / opacity**"，但多处用 `transition-all`（会触发非合成层属性动画）：

| 文件 | 行 | 代码 |
|------|----|------|
| MessageBubble.jsx | 289 | `w-[3px] rounded-full transition-all duration-150`（语音波形条） |
| MessageBubble.jsx | 617 | `block overflow-hidden transition-all cursor-pointer`（图片缩略图） |
| ChatInput.jsx | 547 | `transition-all text-sm font-bold active:scale-95`（发送按钮，且 `active:scale-95` 而非规范的 `scale(0.97)`） |
| TodoPanel.jsx | 139 | `bg-[var(--color-primary)] rounded-full transition-all duration-500`（进度条，且 duration-500 太长） |
| CFODashboard.jsx | 25 | `h-2 rounded-full transition-all duration-300` |
| TaskProgress.jsx | 87 | `h-full rounded-full transition-all duration-300` |
| ProjectsPanel.jsx | 77,86,95 | `transition-all duration-normal ease-out-quart` ×3 |

**修复**：`transition-all` → 明确属性（`transition-transform` / `transition-colors` / `transition-opacity`）。ChatInput 发送按钮 `active:scale-95` → `0.97` 与全局 `btn-primary:active` 对齐。

---

## 9. `App.jsx` `border-3` 不存在 → spinner 边框宽度失效

`App.jsx:124,137`：`border-3 border-[var(--color-primary)] border-t-transparent`
Tailwind 默认无 `border-3`（只有 `border`/`border-0`/`border-2`/`border-4`/`border-8`），`border-3` 会被当成任意值需要 `border-[3px]` 写法。当前 `border-3` 实际不生效，spinner 只有默认 1px 边框。

**修复**：`border-3` → `border-2`，配合第 1 条改 `border-accent`。

---

## 10. 9 个文件 `outline-none` 但无 `focus-visible` 补回

`globals.css` 已定义全局 `:focus-visible { outline: 2px solid var(--accent) }`，但以下文件用 `outline-none` / `focus:outline-none` 后**未补 focus-visible 环**，键盘用户失去焦点指示：

- `ui/CopyButton.jsx`, `ui/Button.jsx`, `ui/Card.jsx`
- `chat/ChatView.jsx`, `chat/ChatInput.jsx`, `chat/ConversationList.jsx`, `chat/NewChatDialog.jsx`
- `sync/SyncStatus.jsx`, `pages/Settings.jsx`

**修复**：`outline-none` → `focus:outline-none focus-visible:ring-2 focus-visible:ring-accent`，或直接删 `outline-none` 让全局 `:focus-visible` 生效。

---

## 11. 标题里塞 emoji `🏢` 破坏字号基线

`ChatView.jsx:338`：`🏢 {currentCompany.name}` 在侧栏 13px 标题里塞 Apple emoji。
`ConversationList.jsx:292`：`<AgentAvatar avatar={null} fallback="🏢" size="sm" />`

**问题**：emoji 渲染高度与字体行高不一致，在 11px/13px 紧排标题里会撑高行盒、导致基线抖动；且与 Linear 风格"无 emoji 装饰"原则冲突（`EmptyState` 注释明确"无 emoji 装饰"）。

**修复**：`🏢` → 一个 `BuildingOfficeIcon`（heroicons 已在依赖里）或纯文字。

---

## 12. 响应式：仅 9/40 文件用了断点，桌面应用可接受但需记录

`sm:`/`md:`/`lg:`/`xl:` 出现 18 处，集中在 `AgentAvatar`、`OrgChart`、`dashboard/ui.jsx`、`DeviceManager`、`SyncPanel`、`ui/Button.jsx`、`CompanySelectPage`、`Dashboard`、`Settings`。

**评估**：SoloForge 是 Electron 桌面应用（`package.json` main = electron），窗口最小宽度受控，**响应式不是首要问题**。但 `CFODashboard.jsx:396` `grid grid-cols-4 gap-4` 在窄窗口下 4 列统计卡片会挤压（Electron 窗口可缩到 800px），应 `grid-cols-2 md:grid-cols-4`。`Dashboard.jsx:134` `max-w-[1400px]` 合理。

**修复**：CFODashboard 统计卡 `grid-cols-2 sm:grid-cols-4`（配合第 2 条重写）。

---

## 13. 滚动：`max-h-[Npx] overflow-auto` 散落，无 scroll-fade

`globals.css` 已提供 `.scroll-fade-top` / `.scroll-fade-bottom`（mask-image 渐隐），但实际几乎没人用：

- `ToolCallCard.jsx:346` `max-h-[200px] overflow-auto`（工具结果，无 fade）
- `TodoPanel.jsx:273` `max-h-[250px] overflow-y-auto`（todo 列表，无 fade）
- `CFODashboard.jsx:449,500` `max-h-96 overflow-auto`（员工/预警列表，无 fade）
- `MessageBubble.jsx:617` 图片无滚动 OK

**建议**：长列表容器加 `scroll-fade-bottom` 类，与侧栏/会话列表的滚动渐隐风格一致。

---

## 14. 暗色模式：`.light` override 链完整，但 CFO/LoginDialog 走 `dark:` 双轨

主题机制：`:root`=暗默认，`.light`/`[data-theme='light']` 覆盖。`main.jsx` 启动时加 `.dark` 类 + `data-theme=dark`。`ThemeToggle` 切换 `.light`/`data-theme`。

**问题**：`CFODashboard.jsx` 和 `LoginDialog.jsx` 用 Tailwind 原生 `bg-white dark:bg-gray-800` 双轨写法，依赖 `darkMode:'class'` + `.dark` 类生效。这**能工作**，但：
1. 与应用其余部分"用 token，不写 dark: 变体"的模式割裂
2. `bg-white`（实色白）与 `--bg-surface`（半透明玻璃 `rgba(25,26,27,0.68)` + backdrop-blur）材质完全不同——CFO 卡片是"死白实色"，其余是"液态玻璃"，切到浅色模式对比更刺眼
3. LoginDialog 输入框 `bg-white dark:bg-gray-700` vs 全局 `.input` 的 `rgba(255,255,255,0.025)` 玻璃，材质不统一

**修复**：见第 2、3 条，改用 token 后暗色自动跟随。

---

## 15. `OrgChart.jsx` 和 `SnakeGame.tsx` 硬编码颜色（部分可接受）

- `OrgChart.jsx:239` `backgroundColor: dept.color, color: 'white'`：部门颜色是数据驱动的，可接受；但 `:386,406` `color: 'white'` / `color: '#6b7280'` 应改 token。
- `SnakeGame.tsx` / `SnakeGameControlPanel.tsx`：游戏画面用 `#0f0f1a`/`#2a2a3e`/`#4ECDC4`/`#FF6B6B`/`#FFD166` 等大量硬编码。**游戏是独立 canvas/面板，可接受**，但控制面板按钮若复用 `btn-primary` 会更统一。低优先级。

---

## 16. z-index 层级未文档化

散落值：`z-0`、`z-10`、`z-20`、`z-30`、`z-40`、`z-50`、`z-[9999]`（lightbox）、`z-[9999]`（拖拽区）、`z-50`（多处弹窗）。

当前未冲突，但缺约定。**建议**：在 globals.css 定义 `--z-toast: 9999` / `--z-modal: 50` / `--z-dropdown: 40` / `--z-base: 1`，tailwind.config 映射。

---

## 17. 密度 / 对齐：总体良好，个别 `py-3` vs `py-2.5` 不一致

- `CFODashboard.jsx` 用 `py-3`/`py-2`/`py-8`，其余 dashboard 用 `py-10`(EmptyState)，密度偏紧但内部尚一致
- `ConversationList` 行高紧凑（`text-[13px]` + `text-[11px]` + `text-[10px]`）信息密度高但层级清晰
- `LoginPage` `space-y-4` + `mb-6` + `p-8` 留白合理

**结论**：密度无系统性丑点，随第 2/3 条重写自然统一。

---

## 优先级排序（修复 ROI）

| 优先级 | 问题 | 工时 | 影响 |
|--------|------|------|------|
| P0 | #1 `--color-primary` 不存在致 spinner 不可见 | 10min | 用户看到空白加载页 |
| P0 | #9 `border-3` 不存在致 spinner 无边框 | 2min | 同上 |
| P0 | #5 ErrorBoundary `bg-blue-500` 按钮 | 1min | 崩溃页刺眼 |
| P1 | #4 TodoPanel `green-500` + `--color-primary` | 5min | 状态色失真 |
| P1 | #3 LoginDialog 脱离系统 | 1h | 同步弹窗割裂 |
| P2 | #2 CFODashboard 全面重写 | 2h | CFO 控制台割裂 |
| P2 | #11 标题 emoji `🏢` | 5min | 基线抖动 |
| P3 | #7 `text-[Npx]` 收敛 type scale | 30min | 长期一致性 |
| P3 | #8 `transition-all` → 明确属性 | 20min | 性能 + 规范 |
| P3 | #10 `outline-none` 补 focus-visible | 15min | 键盘可访问性 |
| P4 | #6 `rounded-full` 进 token | 5min | 规范性 |
| P4 | #13 scroll-fade 补全 | 15min | 滚动体验 |
| P4 | #16 z-index token 化 | 15min | 长期 |
| P4 | #12 CFO 响应式 grid | 含于 #2 | 窄窗口 |
| 低 | #15 SnakeGame 颜色 | — | 游戏可接受 |

**总修复工时**：约 4.5h（含 CFODashboard 重写）。

---

## 验证方法

```bash
# 确认 --color-primary 不存在
grep -oE '^\s*--[a-z-]+:' src/renderer/styles/globals.css | grep color-primary
# 应无输出

# 确认引用点
grep -rn 'color-primary' src/renderer --include='*.jsx'
# App.jsx:124,137 ; TodoPanel.jsx:35,36,60,124,139,234,242,257

# 确认原生 Tailwind 颜色违规
grep -rln 'bg-blue-500\|bg-gray-200\|text-gray-900' src/renderer --include='*.jsx'
# CFODashboard.jsx, LoginDialog.jsx, TodoPanel.jsx(部分), App.jsx
```

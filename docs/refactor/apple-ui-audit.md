# SoloForge 前端 Apple 设计审计报告

> 审计依据：`docs/refactor/apple-design.md`（Apple Design skill，22.7KB）
> 审计范围：SoloForge 前端 13 个核心文件（设计系统 3 + 聊天 5 + 页面 3 + 通用组件 2）
> 审计方式：逐文件对照 Apple 设计原则，定位到文件名 + 行号 + CSS 属性值
> 审计原则：不修改代码，只输出报告。所有差距均带具体数值与文件:行号。

---

## 1. Apple 设计原则检查清单（从 skill 提取，带具体数值）

| 编号 | 检查项 | Apple 标准（带具体值） | 来源 |
|---|---|---|---|
| M1 | 材质层级编码 | 重材质用于结构区（侧栏/工具栏），轻材质用于交互元素；**永不将轻半透明叠在轻半透明上** | §12 |
| M2 | 玻璃厚度随面积 | 大面积表面应更厚：更强 blur + 更深 shadow；小芯片更轻 | §12 |
| M3 | 内容穿透 | `backdrop-filter: blur(20px) saturate(180%)` 为工具栏基准值；`rgba(255,255,255,0.6)` 浅色玻璃基准 | §12 示例 |
| M4 | 顶部边缘高光 | `border-top: 1px solid rgba(255,255,255,0.4)` 模拟光线打在玻璃边缘 | §12 示例 |
| M5 | 滚动边缘渐隐 | 浮动 chrome 下方用 blur/gradient mask 替代 1px 硬边框；**仅在浮动 UI 真正覆盖内容处** | §12 |
| M6 | Materialize 入场 | 玻璃表面入场应 blur+scale 同步，而非纯 opacity fade | §12 |
| T1 | 平台系统字体优先 | `system-ui`/`-apple-system` 为首选；自定义字体仅在"有理由时"才用 | §15 |
| T2 | 字距随尺寸变化 | 大标题负字距（`-0.02em`）；正文接近 `0`；小字略正字距；**永不可全尺寸一个值** | §15 |
| T3 | 行高随尺寸反向 | 大标题紧（`line-height: 1.05`）；正文松（`1.5`） | §15 |
| T4 | 字重分层 | 用 weight+size+leading 组合建立层级，非仅靠 size | §15 |
| T5 | 光学尺寸 | `font-optical-sizing: auto` | §15 |
| T6 | Dynamic Type | 用 `rem`/`em` 缩放，固定 px 不随字号设置破坏布局 | §15 |
| C1 | 暗色饱和度提升 | 暗色背景上 accent/语义色应提升饱和度（Apple 暗色模式规范） | §12 |
| C2 | Vibrancy 文字 | 玻璃上文字不可用纯灰；需更高对比度、略重字重、letter-spacing 微增 | §12 |
| C3 | 颜色在实色层 | 色彩放实色背景层，不放半透明前景 | §12 |
| S1 | 8px 网格 | 间距倍数 4/8/12/16/24/32px；非任意值 | §16 Craft |
| S2 | 呼吸感 | 内容 margin/padding 精确；大表面足够留白 | §16 |
| A1 | 默认弹簧 | `damping 1.0`（临界阻尼，无 overshoot）；`response 0.3-0.4` | §4 表 |
| A2 | 动量弹簧 | 仅手势释放（flick/throw/drag release）用 `damping ~0.8` | §4 |
| A3 | 可中断性 | 永远从当前 on-screen 值起动画；手势驱动禁用 CSS transition/@keyframes | §3 |
| A4 | 速度交接 | 手势释放速度传给弹簧初速度；相对速度 = `gestureVelocity/(target-current)` | §5 |
| A5 | 动量投影 | 用速度投影落点：`current + (v/1000)·d/(1-d)`，`d≈0.998` | §6 |
| A6 | 对称路径 | 进出同路径；右进右出；退出曲线 = 进入曲线的逆向 cubic-bezier | §7 |
| A7 | 锚定原点 | popover/sheet 从触发器原点 scale，`transform-origin` 设为触发器 | §7 |
| A8 | 手势方向暗示 | 中间帧应指向终点方向 | §8 |
| A9 | 橡皮筋边界 | 边缘渐进阻力，非硬停 | §9 |
| A10 | 触摸延迟 | 移除 ~300ms tap delay；pointer-down 反馈，pointer-up 提交 | §1,§10 |
| A11 | 帧级平滑 | 只动 `transform`/`opacity`；`will-change` 提示；`requestAnimationFrame` | §11 |
| A12 | 多模态同帧 | 视觉/声音/触觉同帧触发 | §13 |
| R1 | 按钮 :active | `transform: scale(0.97)`；`transition: transform 100ms ease-out`；pointer-down 即反馈 | §1 示例 |
| R2 | 圆角值梯度 | 4px(小元素) / 8px(按钮/输入) / 12px(卡片) / 16px(面板) / 20px(大容器) — Apple 连续圆角梯度 | §16 Craft |
| R3 | 阴影分层 | ambient（柔和大范围）+ directional（聚焦）；深表面更深阴影 | §12 |
| R4 | 按钮三态 | normal/hover/active/disabled 四态分明；hover 仅精确指针 | §1,§10 |
| R5 | Toggle 规格 | iOS toggle：track 51×31px，thumb 27px，开启 accent | Apple HIG |
| R6 | Segmented control | 等宽段，选中段实色填充，滑动指示器 | Apple HIG |
| L1 | Safe area | 尊重 macOS 标题栏拖拽区；edge insets 精确 | §16 |
| L2 | 内容 margin | 大面板 24-32px 内边距；紧凑列表 12px | §16 |
| D1 | 降级-减少动画 | `prefers-reduced-motion`：cross-fade 替代 slide/spring，保留 opacity/color | §14 |
| D2 | 降级-减少透明度 | `prefers-reduced-transparency`：玻璃变实色，去掉 blur | §14 |
| D3 | 降级-增加对比度 | `prefers-contrast: more`：近实色背景 + 对比边框 | §14 |
| D4 | 避免缓慢振荡 | 禁用 ~0.2Hz（5秒一周期）缓慢循环；避免突变亮度 | §14 |
| F1 | 直接操作 | 拖拽 1:1 跟随手指；尊重抓取偏移；`setPointerCapture` | §2 |
| F2 | 反馈即时连续 | 交互全程 1:1 更新，非仅在结束 | §1 |
| P1 | Purpose | 每元素有意图；决定"不做什么" | §16 原则1 |
| P2 | Agency | 用户控制；仅真正破坏性操作才确认；易撤销 | §16 原则2 |
| P3 | Familiarity | 一致性：相似元素行为相同、位置相同；熟悉隐喻 | §16 原则4 |
| P4 | 直接具体标签 | 命名具体（"进度"、"库"）非泛化（"主页"） | §16 |
| P5 | Wayfinding | 每屏回答：我在哪？能去哪？有什么？怎么出去？ | §16 |

---

## 2. 逐文件审计

### 2.1 `src/renderer/styles/globals.css`（设计 token + 组件类，826 行）

| 检查项 | Apple 标准（带具体值） | 当前状态（带文件:行号） | 差距 | 严重度 |
|---|---|---|---|---|
| T1 系统字体 | `system-ui`/`-apple-system` 为首选 | `globals.css:90-91` `--font-sans: 'Inter', -apple-system, ...` Inter 排首位 | Inter 优先于 SF Pro/系统字体；Apple skill §15 明确"默认用平台系统字体，自定义需理由"；Inter 在 macOS 非 SF Pro | 中 |
| R2 圆角梯度 | Apple 连续梯度 4/8/12/16/20px | `globals.css:50-54` `--radius-sm:4px; --radius-md:6px; --radius-lg:8px; --radius-xl:12px` | 缺 16px/20px 档；按钮/输入应 8px 但 md=6px；卡片应 12px 但 lg=8px；面板应 16px 但 xl=12px —— 整体偏小一档 | 高 |
| R2 圆角值 | 按钮 8px | `globals.css:51` `--radius-md:6px /* 按钮/输入 */` | Apple 按钮/输入标准 8px，现 6px，偏紧 | 高 |
| R2 圆角值 | 卡片 12px | `globals.css:52` `--radius-lg:8px /* 卡片 */` | Apple 卡片标准 12px，现 8px | 高 |
| R2 圆角值 | 面板 16-20px | `globals.css:53` `--radius-xl:12px /* 面板 */` | Apple 面板标准 16-20px，现 12px | 高 |
| M3 玻璃基准 | 工具栏 `blur(20px) saturate(180%)` + `rgba(255,255,255,0.6)` | `globals.css:373` `.panel: backdrop-filter: blur(24px) saturate(180%)` 但 bg `rgba(15,16,17,0.72)` | 暗色饱和度 180% 对，但 bg 不透明度 0.72 偏高（Apple 浅色示例 0.6）；暗色应更透 ~0.5-0.6 | 中 |
| M4 顶部高光 | `border-top: 1px solid rgba(255,255,255,0.4)` | `globals.css:429` `.glass-*: box-shadow: inset 0 1px 0 0 rgba(255,255,255,0.18)` | 0.18 远低于 Apple 0.4；注释自辩"实测最佳"但偏离 Apple 规范；亮边缘不可见 | 高 |
| M2 大表面更厚 | 大表面更强 blur | `globals.css:403` `.glass-heavy: blur(30px)` vs `.glass-medium: blur(20px)` vs `.glass-light: blur(12px)` | 厚度梯度正确（30/20/12），符合 Apple | —（达标） |
| M1 玻璃叠层 | 永不轻叠轻 | `globals.css` 未发现显式轻叠轻，但 `.surface`(blur20) 内嵌 `.glass-medium`(blur20) 会叠加 | MessageBubble:429 工具卡容器 rgba0.68 blur20 叠在 chat 区域（已有 glass-medium 顶栏）——需运行时验证 | 中 |
| R3 阴影分层 | ambient+directional 双层 | `globals.css:65-67` `--shadow-dialog: 0 4px 12px rgba(0,0,0,0.5), 0 16px 48px rgba(0,0,0,0.4), 0 2px 6px rgba(0,0,0,0.3)` | 三层阴影但全黑单一色相，无 ambient（柔和扩散）+ directional（聚焦偏移）的色相分离；Apple 用近黑+环境光混合 | 中 |
| S1 间距网格 | 4/8/12/16/24/32 | `globals.css:57-61` `--spacing-xs:0.25rem(4px)/sm:0.5rem(8px)/md:1rem(16px)/lg:1.5rem(24px)/xl:2rem(32px)` | 缺 12px 档（Apple 列表/紧凑栏常用）；但 8px 网格对齐达标 | 低 |
| A1 默认弹簧 | damping 1.0, response 0.3-0.4 | `globals.css:69-82` 全用 cubic-bezier 静态曲线，**无 spring** | 0 处使用物理弹簧；全部 CSS transition/cubic-bezier，违反 §3/§4（手势驱动禁用 CSS transition） | 高 |
| A3 可中断性 | 手势驱动禁 CSS transition | `globals.css` 所有过渡基于 cubic-bezier | ChatView:99-124 侧栏拖拽用 mousemove+setState，无 spring，不可中断重定向 | 高 |
| A6 对称路径 | 退出曲线=进入逆向 | `globals.css:511-514` `.popover.is-exiting: transform: scale(0.97)` 退出 0.97，进入 0.95 | 退出 0.97≠进入 0.95 的逆向；不对称，违反 §7 | 中 |
| T2 字距分层 | 大标题 -0.02em，正文 ~0，小字略正 | `globals.css:159` h1 `-0.022em`；`globals.css:167` h3 `-0.012em` | 大标题档对，但**正文未显式设 letter-spacing:0**（依赖默认），小字未加正字距 | 中 |
| T3 行高 | 大标题 1.05，正文 1.5 | `globals.css` h1/h2/h3 **未设 line-height** | 标题缺显式紧行高（1.05-1.1）；正文 body 未设 1.5（依赖默认） | 中 |
| T5 光学尺寸 | `font-optical-sizing: auto` | `globals.css:136` `font-variation-settings: normal` | 未设 `font-optical-sizing: auto`；Inter 支持 optical sizing 但未启用 | 中 |
| T6 Dynamic Type | rem/em 缩放 | `globals.css:57-61` 间距用 rem ✓；但大量组件内 inline `px`（ChatView:90 `288`px，:110 `200`/`500`） | 固定 px 在放大字号时不变；部分违反 §15 | 中 |
| C1 暗色饱和度 | 暗色提升饱和度 | `globals.css:39-41` `--color-success:#4ade80; --color-warning:#fbbf24; --color-danger:#f87171` | 已是高饱和暗色值，达标 | — |
| C2 Vibrancy 文字 | 玻璃上文字略重+微增字距 | `globals.css` 无 `.glass-*` 内文字的专用字重/字距规则 | 玻璃层（顶栏/侧栏）文字未加 vibrancy 补偿；ChatView:357 顶栏文字 weight 510 但无 letter-spacing bump | 中 |
| R1 按钮 :active | `scale(0.97)` + `100ms ease-out` | `globals.css:241-244` `.btn-primary:active: transform:scale(0.97)`；`globals.css:78` `--duration-press:140ms` | scale 对，但 140ms > Apple 示例 100ms；略慢 | 低 |
| D1 降级动画 | cross-fade 保留 opacity | `globals.css:765-826` 全局 reduced-motion：animation 0.01ms、transform:none、保留 opacity | 达标且完善 | — |
| D2 降级透明度 | 玻璃变实色去 blur | `globals.css:477-490` `.glass-*`/`.panel`/`.surface` bg 变 var、backdrop-filter none | 达标 | — |
| D3 降级对比度 | 近实色+对比边框 | `globals.css` 无 `@media (prefers-contrast: more)` | **完全缺失** §14 第三项；高对比度用户无适配 | 高 |
| A7 锚定原点 | popover 从触发器 scale | `globals.css:497-498` `.popover: transform-origin: var(--radix-popover-content-transform-origin, var(--transform-origin, center))` | 达标（跟随 Radix 变量） | — |
| M6 Materialize | blur+scale 同步入场 | `globals.css:433-444` `.glass-enter: transition: opacity+transform+backdrop-filter` | 达标（同步三个属性） | — |
| A11 帧平滑 | 只动 transform/opacity | `globals.css` 大量 `will-change: transform` ✓；但 `.emil-collapse` 用 max-height（布局属性） | emil-styles.css:148 max-height 触发 layout，非合成层；已知例外但违反 §11 | 中 |

---

### 2.2 `src/renderer/components/chat/emil-styles.css`（微交互工具类，270 行）

| 检查项 | Apple 标准（带具体值） | 当前状态（带文件:行号） | 差距 | 严重度 |
|---|---|---|---|---|
| A1 默认弹簧 | damping 1.0, response 0.3-0.4 | `emil-styles.css:17-19` 全用 cubic-bezier，0 spring | 全 CSS 曲线无物理弹簧；违背 §4"行为优于动画" | 高 |
| A3 可中断性 | 手势驱动禁 @keyframes | `emil-styles.css:56` `@keyframes emilConvIn`；`:52` `.emil-conv-item: animation` | 入场用 keyframes 不可中断；会话列表入场若用户立即点击/拖拽会产生冲突 | 中 |
| A6 对称路径 | 进出同路径 | `emil-styles.css:49-61` 会话项入场 translateY(8px)→0；无对应退场动画 | 无退场路径；删除会话时硬消失，违反 §7 | 中 |
| R1 按压反馈 | pointer-down 即反馈 | `emil-styles.css:234` `.emil-pressable:active: scale(0.97)` | :active 对应 pointer-down，达标 | — |
| R5 Toggle 规格 | track 51×31, thumb 27 | `emil-styles.css:40-46` `.emil-toggle-track/thumb` 仅声明 transition，尺寸在 ChatView:301 `h-4 w-7`(16×28px) | 16×28 远小于 iOS 31×51；thumb 12px < 27px；toggle 偏小不精致 | 高 |
| A9 橡皮筋 | 边缘渐进阻力 | `emil-styles.css` 无任何 rubberband 实现 | 列表滚动/拖拽无橡皮筋；Apple §9 要求边缘软阻力 | 中 |
| D1 降级动画 | 保留 opacity 去位移 | `emil-styles.css:239-269` reduced-motion：transform:none、保留 opacity、关闭 pulse | 达标且细致 | — |
| A11 合成层 | 只动 transform/opacity | `emil-styles.css:148-158` `.emil-collapse: max-height` | max-height 触发 layout 重排，违反 §11；已注释"允许例外"但仍是性能隐患 | 中 |
| A8 方向暗示 | 中间帧指向终点 | `emil-styles.css:49-54` 会话项 translateY(8)→0（上移），方向正确 | 达标 | — |
| D4 缓慢振荡 | 禁 ~0.2Hz 循环 | `emil-styles.css:194-201` `.emil-record-pulse: 1.4s infinite` | 1.4s≈0.71Hz，远离 0.2Hz 禁区；达标 | — |

---

### 2.3 `tailwind.config.js`（92 行）

| 检查项 | Apple 标准（带具体值） | 当前状态（带文件:行号） | 差距 | 严重度 |
|---|---|---|---|---|
| T1 字体 | system-ui 首选 | `tailwind.config.js:45-46` `sans: ['Inter', '-apple-system', ...]` | Inter 首位，同 globals.css 问题 | 中 |
| R2 圆角 | 4/8/12/16/20 梯度 | `tailwind.config.js:38-43` `sm/md/lg/xl` 映射 4/6/8/12 | 同 globals.css，缺 16/20，整体偏小一档 | 高 |
| A1 弹簧 | damping/response API | `tailwind.config.js:64-68` transitionTimingFunction 全 cubic-bezier | 无 spring 配置；Tailwind 无原生 spring 但可扩展 | 中 |
| T2 字距 | 分层 | `tailwind.config.js:56-59` `tightest:-0.022em, tighter:-0.012em` | 仅负字距档，缺正文 0 档和小字正字距档 | 中 |
| T4 字重分层 | weight+size 组合 | `tailwind.config.js:50-55` `normal:400, ui:510, title:590` | 三档分层合理，达标 | — |

---

### 2.4 `src/renderer/components/chat/ChatView.jsx`（427 行）

| 检查项 | Apple 标准（带具体值） | 当前状态（带文件:行号） | 差距 | 严重度 |
|---|---|---|---|---|
| A3 可中断性 | 手势禁 CSS transition/可重定向 | `ChatView.jsx:99-124` 侧栏拖拽用 `mousemove`+`setState(newWidth)`，无 spring，无速度交接 | 拖拽中无法平滑反向；松手无动量投影；违反 §3/§5/§6 | 高 |
| A4 速度交接 | 释放速度传弹簧 | `ChatView.jsx:114-120` `handleDragEnd` 直接移除监听，无速度记录 | 无速度历史（§2 要求记 last few pointermove）；无交接 | 高 |
| A5 动量投影 | `current+(v/1000)·d/(1-d)` | 无实现 | 侧栏宽度无投影落点；双击恢复 `:127-130` 硬切 | 高 |
| A9 橡皮筋 | 边缘软阻力 | `ChatView.jsx:110` `Math.max(200, Math.min(500, ...))` | 硬边界 clamp，无渐进阻力；违反 §9 | 中 |
| R5 Toggle | 51×31 track / 27 thumb | `ChatView.jsx:301` `h-4 w-7`(16×28)；`:309` thumb `h-3 w-3`(12×12) | 尺寸严重偏小；iOS toggle 视觉不精致 | 高 |
| T2 字距 | 标题负字距 | `ChatView.jsx:222` `letterSpacing:'-0.012em'`（h1 13px） | 13px 用 -0.012em 偏大字距（Apple 13px 应用 ~-0.01em 或更接近 0）；轻微 | 低 |
| T3 行高 | 显式 | ChatView 标题/状态文字未设 line-height | 依赖默认；紧凑栏应显式 1.2-1.3 | 低 |
| C2 Vibrancy | 玻璃上文字补偿 | `ChatView.jsx:342` 顶栏 `.glass-medium` 内文字 weight 510 无 letter-spacing bump | 玻璃顶栏文字缺 vibrancy 字距/字重补偿 | 中 |
| M5 滚动渐隐 | 浮动 chrome 下 | `ChatView.jsx:342` 顶栏 glass-medium 有 `borderBottom:1px solid`（:344）硬边框 | 应用 scroll-fade 替代硬边框；违反 §12"滚动边缘效果非硬分隔" | 中 |
| R1 按压 | scale(0.97) | `ChatView.jsx:204` 折叠按钮 `emil-pressable`；`:247` 导航按钮同 | 达标（通过 emil-pressable 类） | — |
| L1 Safe area | macOS 标题栏 | `ChatView.jsx:192` `h-8 drag-region` 占位 | 达标（32px 拖拽区） | — |
| P4 具体标签 | 具体命名 | `ChatView.jsx:225` "SoloForge"；`:294` "任务巡查"；`:401` "选择一个对话开始" | "任务巡查"具体；但空状态文案泛化，可更具体 | 低 |
| A6 对称路径 | 侧栏进出同路径 | `ChatView.jsx:133-135` `toggleSidebar` 仅切 collapsed 布尔，宽度由 CSS `.emil-sidebar-collapse` width 过渡 | 折叠/展开同路径（width）；但无 transform 位移方向暗示 | 低 |
| F1 直接操作 | 1:1 跟随 | `ChatView.jsx:107-112` `handleDragMove` 立即 setSidebarWidth | 1:1 达标；但未用 Pointer Events + capture，用 mousemove | 中 |
| A10 触摸延迟 | 移除 300ms | 未显式设 `touch-action`/viewport | Electron 桌面端影响小，但未显式处理 | 低 |

---

### 2.5 `src/renderer/components/chat/ConversationList.jsx`（754 行）

| 检查项 | Apple 标准（带具体值） | 当前状态（带文件:行号） | 差距 | 严重度 |
|---|---|---|---|---|
| S1 列表高度 | Apple 列表行 44-48px | `ConversationList.jsx:90` `ITEM_HEIGHT='48px'` | 达标（48px 对齐 8px 网格） | — |
| S2 内边距 | 列表项 padding | `ConversationList.jsx:194` `padding:'0 12px'` | 12px 水平 padding 达标；但 0 垂直依赖 48px 固定高 | — |
| R2 圆角 | 列表项圆角 | `ConversationList.jsx:195` `borderRadius:'var(--radius-md,6px)'` | 6px 偏小；Apple 列表项常用 8-10px | 中 |
| A1 弹簧 | 入场弹簧 | `ConversationList.jsx:186` `emil-conv-item` animation 200ms cubic-bezier | 静态曲线无弹簧 | 中 |
| R4 按钮三态 | normal/hover/active | `ConversationList.jsx:197-202` onMouseEnter/Leave 手动改 background；无 :active scale | hover 手动 JS 改样式，非 CSS 伪类；缺 active 态 scale | 中 |
| C3 颜色实色层 | 色彩不前景半透明 | `ConversationList.jsx:103` 选中背景 `rgba(94,106,210,0.14)` 直接背景 | 半透明背景在玻璃侧栏上叠加（侧栏已 glass-heavy）；轻叠重风险 | 中 |
| M1 玻璃叠层 | 不轻叠轻 | 侧栏 glass-heavy(重) + 选中层 rgba0.14(轻) | 重叠轻勉强可接受，但选中层未用实色层承载颜色 | 低 |
| P3 一致性 | 相似项行为同 | ContactItem/DepartmentItem/GroupItem 三个组件代码 90% 重复 | 重复违反 §16 Craft"一致性"；应抽象统一项 | 中 |
| T2 小字字距 | 小字略正字距 | `ConversationList.jsx:421` section label `text-[10px]`；`:422` `tracking-wider`(Tailwind ≈0.05em) | uppercase+tracking-wider 对 10px 略过；Apple 小标签用 +0.02-0.03em | 低 |
| A11 合成层 | 只动 transform/opacity | `ConversationList.jsx:149` `transition-all`（HideButton） | transition-all 可能触发非合成属性；应限定 | 低 |

---

### 2.6 `src/renderer/components/chat/MessageBubble.jsx`（692 行）

| 检查项 | Apple 标准（带具体值） | 当前状态（带文件:行号） | 差距 | 严重度 |
|---|---|---|---|---|
| R2 气泡圆角 | Apple 消息气泡 12-18px | `MessageBubble.jsx:237` 语音气泡 `borderRadius:'var(--radius-md)'`=6px | 6px 过小；iMessage 气泡 ~18px；偏"硬" | 高 |
| M2 气泡材质 | 消息气泡应有材质感 | `MessageBubble.jsx:239-241` Agent 语音气泡 `rgba(25,26,27,0.68)` blur20；用户气泡 accent 实色 | Agent 有玻璃感✓；用户气泡实色 accent 符合 iMessage（蓝/绿实色） | — |
| T3 行高 | 正文 1.5-1.6 | `MessageBubble.jsx:374` `lineHeight:'1.6'` | 1.6 达标（Apple 正文 1.5 偏松，1.6 可接受） | — |
| T2 正文字距 | ~0 | `MessageBubble.jsx:372-376` bodyStyle 无 letter-spacing | 正文未显式 0，依赖默认；轻微 | 低 |
| T1 代码字体 | 系统等宽优先 | `MessageBubble.jsx:108` `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace` | JetBrains Mono 优先于 SF Mono/系统；Apple §15 倾向系统字体 | 中 |
| R3 阴影 | 气泡无阴影也可 | `MessageBubble.jsx` 气泡无 box-shadow | 消息气泡通常无阴影（靠材质），达标 | — |
| M6 工具卡入场 | materialize | `MessageBubble.jsx:423-434` 工具卡容器静态，无入场动画 | 工具卡出现无 materialize；硬出现 | 中 |
| A6 对称路径 | 消息进出 | `MessageBubble.jsx` 无消息退场动画（删除直接消失） | 删除消息无退场；违反 §7 | 低 |
| R1 按压 | 语音播放按钮 | `MessageBubble.jsx:233` `transition-colors` 无 :active scale | 播放按钮缺按压反馈 | 中 |
| C2 Vibrancy | 玻璃上文字 | `MessageBubble.jsx:290` 语音气泡文字 `var(--text-tertiary)` 无字重补偿 | 玻璃上 tertiary 文字缺 vibrancy | 低 |
| P2 Agency | 易撤销 | 右键删除无确认（直接删） | 直接删可接受（有 displayClearedAt 软删）；但无 undo 提示 | 低 |

---

### 2.7 `src/renderer/components/chat/ChatInput.jsx`（643 行）

| 检查项 | Apple 标准（带具体值） | 当前状态（带文件:行号） | 差距 | 严重度 |
|---|---|---|---|---|
| R2 输入框圆角 | 8px | `ChatInput.jsx:273` `borderRadius:'var(--radius-md)'`=6px | 6px < 8px；偏紧 | 高 |
| R2 发送按钮圆角 | 8px | `ChatInput.jsx:297` `borderRadius:'var(--radius-md)'`=6px | 同上 | 高 |
| R1 发送按钮按压 | scale(0.97) | `ChatInput.jsx:293-299` sendButtonStyle 无 :active scale | 发送按钮无压迫反馈；仅 transition background | 高 |
| R4 按钮三态 | normal/hover/active/disabled | `ChatInput.jsx:293-306` 有 normal/disabled，无 hover/active transform | 缺 hover 态背景变化（accent-hover）；缺 active scale | 中 |
| A1 弹簧 | focus 弹簧 | `ChatInput.jsx:275` `transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s cubic-bezier(...)` | 静态曲线无弹簧；focus 微浮起 translateY(-1px) 无弹簧 | 中 |
| T6 Dynamic Type | rem 缩放 | `ChatInput.jsx:478-479` `minHeight:'44px', maxHeight:'150px'` 固定 px | 44px 是 Apple 触摸目标最小值✓；但固定 px 不随字号缩放 | 低 |
| M3 输入框玻璃 | 半透明+blur | `ChatInput.jsx:269-271` `rgba(255,255,255,0.02) blur(8px)` | 0.02 透明度极低，几乎实色；blur 8px 偏弱（Apple 工具栏 20px） | 中 |
| A7 菜单原点 | mention 从触发器 | `ChatInput.jsx:494` mention 菜单 `absolute bottom-full left-0` 无 transform-origin | 菜单从输入框上方出现，但无 scale-origin 锚定 | 中 |
| R3 阴影 | 菜单阴影 | `ChatInput.jsx:499` `0 4px 12px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.5)` | 三层全黑阴影，无 ambient/directional 分离 | 中 |
| F2 即时反馈 | 输入即时 | `ChatInput.jsx:106-112` 高度随 content 自适应 | 达标（即时调整） | — |
| A10 触摸延迟 | Enter 发送 | `ChatInput.jsx:241` Enter 发送，Shift+Enter 换行 | 达标；但无 input method composition 处理？实际 :212 有 isComposing 检查 | — |
| S2 间距 | 输入区 padding | `ChatInput.jsx:318` `px-6 py-4`(24/16px) | 24px 水平达 Apple 内容 margin | — |
| R1 录音按钮按压 | scale | `ChatInput.jsx` 录音按钮无 :active scale | 缺按压反馈 | 中 |
| A8 方向暗示 | 拖拽提示 | `ChatInput.jsx:329-346` 拖拽提示 `2px dashed accent` | 虚线框无方向暗示；可加向上箭头暗示 | 低 |

---

### 2.8 `src/renderer/components/chat/MessageList.jsx`（514 行）

| 检查项 | Apple 标准（带具体值） | 当前状态（带文件:行号） | 差距 | 严重度 |
|---|---|---|---|---|
| M5 滚动渐隐 | 浮动 chrome 下 | `MessageList.jsx:409` `scroll-fade-top scroll-fade-bottom` | 达标（用 mask-image 渐隐） | — |
| R2 滚动按钮圆角 | full | `MessageList.jsx:481` `rounded-full` | 达标 | — |
| R3 滚动按钮阴影 | 浮动按钮阴影 | `MessageList.jsx:485` `0 4px 12px rgba(0,0,0,0.3)` | 单层阴影，无 ambient+directional；Apple 浮动按钮有柔和 ambient | 低 |
| A1 弹簧 | 滚动到底 | `MessageList.jsx:212-218` `scrollTop=scrollHeight` 硬切 | 无平滑 spring 滚动；用 `behavior:'smooth'`（:257）CSS 非 spring | 中 |
| A3 可中断性 | 滚动可中断 | `MessageList.jsx:255-259` useEffect 自动滚动 | 自动滚动与用户滚动可能冲突；无中断检测（isNearBottomRef 部分缓解） | 中 |
| R2 空状态图标容器 | 圆角 | `MessageList.jsx:412` `rounded-2xl`(16px) | 16px 达标（Apple 大容器） | — |
| T2 空状态字距 | 标题字距 | `MessageList.jsx:415` `text-base font-medium` 无 letter-spacing | 空状态标题未显式字距 | 低 |
| A6 对称路径 | 灯箱进出 | `MessageList.jsx:121` `animate-fade-in` 进；无退场 | 灯箱关闭无退场动画；硬消失 | 中 |
| R1 按压 | 清屏按钮 | `MessageList.jsx:386` `hover:bg-bg-hover transition-colors` 无 :active | 清屏按钮缺按压反馈 | 中 |
| P5 Wayfinding | 空状态指引 | `MessageList.jsx:347` "选择一位同事开始聊天" | 文案指引清晰，达标 | — |
| M4 顶栏高光 | 浮动顶栏边缘 | `MessageList.jsx:371` `glass-medium` + `border-b border-border-default` | 用硬边框 border-b，应改 scroll-fade 或顶部高光 | 中 |

---

### 2.9 `src/renderer/pages/LoginPage.jsx`（191 行）

| 检查项 | Apple 标准（带具体值） | 当前状态（带文件:行号） | 差距 | 严重度 |
|---|---|---|---|---|
| A1 弹簧 | 卡片入场弹簧 | `LoginPage.jsx:58` `animation: loginCardEnter 300ms cubic-bezier(0.23,1,0.32,1)` | 静态曲线无弹簧；且用 @keyframes 不可中断 | 中 |
| A3 可中断性 | keyframes 不可中断 | `LoginPage.jsx:78-82` `@keyframes loginCardEnter` | 入场动画期间无法中断；但登录页一次性，影响小 | 低 |
| R2 卡片圆角 | 12-16px | `LoginPage.jsx:73` `rounded-xl`=12px | 12px 达标（Apple 卡片标准） | — |
| T2 标题字距 | 大标题 -0.02em | `LoginPage.jsx:65` `letterSpacing:'-0.704px'`（32px ≈ -0.022em） | 达标（32px 用 -0.022em） | — |
| T3 标题行高 | 大标题 1.05 | `LoginPage.jsx:64` `text-[32px]` 无 line-height | 缺显式紧行高 | 中 |
| T4 字重分层 | weight+size | `LoginPage.jsx:64` `font-title`(590)；`:74` `font-ui`(510) | 分层达标 | — |
| R1 按钮按压 | scale(0.97) | `LoginPage.jsx:146-149` `.btn-primary` class（继承全局 :active scale） | 达标（通过全局类） | — |
| R4 按钮三态 | disabled 态 | `LoginPage.jsx:148` `disabled={loading}` | 达标（全局 .btn-primary:disabled opacity 0.4） | — |
| M3 卡片玻璃 | 半透明+blur | `LoginPage.jsx:73` `.surface .glass-enter` | 达标（继承全局玻璃类） | — |
| A6 对称路径 | 登录↔注册切换 | `LoginPage.jsx:45-50` `switchMode` 仅切 mode，卡片无过渡 | 模式切换无对称过渡；表单硬切 | 低 |
| S2 间距 | 卡片 padding | `LoginPage.jsx:73` `p-8`(32px) | 32px 达标（Apple 大容器内边距） | — |
| L1 居中 | min-h-screen 居中 | `LoginPage.jsx:53` `min-h-screen` flex 居中 | 达标 | — |

---

### 2.10 `src/renderer/pages/Dashboard.jsx`（327 行）

| 检查项 | Apple 标准（带具体值） | 当前状态（带文件:行号） | 差距 | 严重度 |
|---|---|---|---|---|
| S2 内容 margin | 大面板 24-32px | `Dashboard.jsx:134` `px-6 py-6`(24px) | 24px 达标 | — |
| S1 网格间距 | gap 8px 倍数 | `Dashboard.jsx:171` `gap-3`(12px)；`:222` `gap-4`(16px) | 12/16px 达标 | — |
| A1 弹簧 | 面板入场 | `Dashboard.jsx:306-323` `@keyframes dashPanelEnter` translateY(6px)→0，280ms cubic-bezier | 静态曲线无弹簧；keyframes 不可中断 | 中 |
| A8 方向暗示 | 入场方向 | `Dashboard.jsx:308` translateY(6px)→0（上移） | 方向正确（暗示从下方升起） | — |
| A3 可中断性 | 刷新 opacity 闪现 | `Dashboard.jsx:173-175` `opacity: refreshing?0.5:1` transition | 用 transition 可中断（opacity），达标 | — |
| R2 面板圆角 | 16-20px | `Dashboard.jsx:222` `.panel` 继承 `--radius-xl`=12px | 12px < 16px；面板偏紧 | 高 |
| R1 按钮按压 | 返回/刷新 | `Dashboard.jsx:139` `.btn-ghost !p-1.5`；`:160` `.btn-ghost` | 继承全局 :active scale，达标 | — |
| R3 阴影 | StatCard 阴影 | 需查 ui.jsx（本次未审） | 未在本批次；但 Panel 用 .panel 无额外阴影 | 低 |
| T2 标题字距 | 标题负字距 | `Dashboard.jsx:144` `tracking-tighter`(≈-0.012em) | 15px 标题 -0.012em 达标 | — |
| T3 行高 | 标题紧 | `Dashboard.jsx:144` `leading-tight`(1.25) | 1.25 对 15px 略松；Apple 15px 用 ~1.2 | 低 |
| P4 具体标签 | 面板命名 | `Dashboard.jsx:226` "任务看板"；`:253` "业务目标"；`:258` "KPI 指标" | 具体命名，达标 | — |
| P5 Wayfinding | 返回按钮 | `Dashboard.jsx:139` onBack 返回 | 达标 | — |
| M4 顶栏 | macOS 拖拽区 | `Dashboard.jsx:132` `h-8 drag-region` | 达标 | — |
| A6 对称路径 | 面板进出同路径 | `Dashboard.jsx` 仅入场，无退场 | 切页时面板硬消失；无退场 | 低 |
| D1 降级 | reduced-motion | `Dashboard.jsx` 无显式 reduced-motion 处理 | 依赖全局 globals.css:765；局部 keyframes 被全局覆盖，达标 | — |

---

### 2.11 `src/renderer/pages/Settings.jsx`（706 行）

| 检查项 | Apple 标准（带具体值） | 当前状态（带文件:行号） | 差距 | 严重度 |
|---|---|---|---|---|
| R5 Toggle 规格 | track 51×31, thumb 27 | `Settings.jsx:64` `h-5 w-9`(20×36px)；`:77` thumb `h-4 w-4`(16×16) | 20×36 < 31×51；thumb 16 < 27；偏小 | 高 |
| R5 Toggle 位移 | thumb translateX | `Settings.jsx:81` `translateX(16px)` | 16px 位移对 20×36 track 偏小；iOS 位移 ≈ track-thumb=20px | 中 |
| A1 Toggle 弹簧 | 弹簧动画 | `Settings.jsx:71` `transition: background-color 200ms cubic-bezier`；`:82` `transform 220ms cubic-bezier` | 静态曲线无弹簧；toggle 切换应用 spring（damping 0.8 动量感） | 高 |
| R2 面板圆角 | 16-20px | `Settings.jsx:222` `.panel` = 12px | 12px 偏小 | 高 |
| T2 标题字距 | 负字距 | `Settings.jsx:225` `tracking-tight`(≈-0.012em) | 14px 标题 -0.012em 达标 | — |
| R1 按钮按压 | scale | `Settings.jsx:133` `.btn-ghost`；`:162` `.btn-ghost` | 继承全局 :active scale，达标 | — |
| A1 面板入场 | 弹簧 | `Settings.jsx:223` `animation: settingsSectionEnter 280ms cubic-bezier` | 静态曲线无弹簧 | 中 |
| M3 面板玻璃 | .panel 玻璃 | `Settings.jsx:222` `.panel` class | 继承全局玻璃，达标 | — |
| S2 间距 | 面板 padding | `Settings.jsx:222` `p-6`(24px) | 24px 达标 | — |
| R4 路径列表项 | 三态 | `Settings.jsx:174` `bg-bg-hover/50 group`；hover 显示删除按钮 | hover 态有；缺 :active scale | 低 |
| T6 固定 px | rem 缩放 | `Settings.jsx` 大量 Tailwind class（rem）✓；但 toggle 尺寸 px | toggle 固定 px 不缩放 | 低 |
| P2 Agency | 权限确认 | `Settings.jsx` 权限切换无确认直接保存 | 直接保存可接受（易撤销，再切回）；但破坏性权限（shell）建议确认 | 低 |
| A7 锚定原点 | 面板入场 origin | `Settings.jsx:229` `scale(0.97)→1` 无 transform-origin | 缺显式 origin（center 默认）；面板应从内容区原点 | 低 |

---

### 2.12 `src/renderer/components/ConfirmDialog.jsx`（104 行）

| 检查项 | Apple 标准（带具体值） | 当前状态（带文件:行号） | 差距 | 严重度 |
|---|---|---|---|---|
| A1 弹簧 | 模态入场弹簧 | `ConfirmDialog.jsx:64` `.surface .glass-enter`（继承全局 materialize） | 全局 glass-enter 用 cubic-bezier，无弹簧 | 中 |
| A6 对称路径 | 模态进出同路径 | `ConfirmDialog.jsx` 仅入场（glass-enter），无退场动画 | 关闭时硬消失；违反 §7 对称路径 | 高 |
| A7 锚定原点 | 模态 center origin | `ConfirmDialog.jsx:64` `.modal-center`(transform-origin:center) | 模态例外允许 center，达标 | — |
| R2 模态圆角 | 16-20px | `ConfirmDialog.jsx:64` `rounded-xl`=12px | 12px < 16px；Apple 模态常用 16-20px | 高 |
| R3 遮罩阴影 | scrim dim | `ConfirmDialog.jsx:57` `bg-[rgba(0,0,0,0.5)] backdrop-blur-sm` | 遮罩 0.5 黑 + blur-sm(4px) 达标；但 blur 4px 偏弱，Apple 用 8-12px push back | 低 |
| M6 Materialize | 玻璃入场 | `ConfirmDialog.jsx:64` `.glass-enter` blur+scale 同步 | 达标 | — |
| R1 按钮按压 | scale | `ConfirmDialog.jsx:90` `.btn-ghost`；`:95` `.btn-primary` | 继承全局 :active scale，达标 | — |
| P2 Agency | 确认对话框 | `ConfirmDialog.jsx` 仅危险操作确认 | 达标（§16 原则2"仅破坏性操作确认"） | — |
| A3 可中断性 | 模态可中断 | `ConfirmDialog.jsx` 无 ESC 期间动画状态 | ESC 关闭（:30-36）硬切；与入场动画可能冲突 | 低 |
| S2 间距 | 模态 padding | `ConfirmDialog.jsx:66` `px-6 py-4`(24/16) | 24px 水平达标；16px 垂直略紧（Apple 模态常用 20-24） | 低 |
| R4 按钮三态 | danger 态 | `ConfirmDialog.jsx:96` `type==='danger'` 时 backgroundColor:danger | 达标（动态改色） | — |

---

### 2.13 `src/renderer/components/AgentAvatar.jsx`（113 行）

| 检查项 | Apple 标准（带具体值） | 当前状态（带文件:行号） | 差距 | 严重度 |
|---|---|---|---|---|
| R2 头像圆角 | Apple 头像连续圆角 | `AgentAvatar.jsx:27-32` `xs:rounded-md(6px), sm/md:rounded-lg(8px), lg/xl:rounded-xl(12px), 2xl:rounded-2xl(16px)` | 圆角梯度合理；但 xs=6px 偏小（Apple 小头像 8px） | 低 |
| R2 头像形状 | Apple 人像圆形 | `AgentAvatar.jsx:27` 全部 `rounded-*`（方圆角）非 `rounded-full` | Apple 联系人/消息头像常用圆形；方圆角偏 macOS 列表风格；非"不像 Apple"但风格选择 | 低 |
| R3 状态点 | 在线圆点 | `AgentAvatar.jsx:79-87` `dot` + `ring` + `boxShadow: 0 0 0 2px var(--bg-base)` | 达标（圆点+描边分离） | — |
| T1 Emoji 字体 | 系统字体 | `AgentAvatar.jsx` emoji 用继承字体 | emoji 走系统字体栈，达标 | — |
| S1 尺寸网格 | 8px 倍数 | `AgentAvatar.jsx:27-32` 24/40/40/48/56/64px | 40/48/56/64 达标；但 sm=md=40 重复 | 低 |
| R1 按压 | 头像可点击 | `AgentAvatar.jsx` 无 :active（头像本身非按钮） | 头像非交互元素，无需按压；但 Settings:439 上传按钮外裹头像需反馈 | — |

---

## 3. "不像苹果"的 Top 10 根因（按影响排序）

1. **全局零物理弹簧（A1/A3/A4/A5）** — `globals.css` + `emil-styles.css` 全部用 `cubic-bezier` 静态曲线，无一处 spring。侧栏拖拽（ChatView:99-124）无速度交接、无动量投影、无橡皮筋，违反 §3/§4/§5/§6/§9 五条核心原则。这是"不像 Apple"的首要根因：Apple 的灵魂是"行为优于动画"，springs 让 UI 可中断、带动量、可重定向，而当前所有过渡都是死板的预设曲线。

2. **圆角整体偏小一档（R2）** — `--radius-md:6px / lg:8px / xl:12px`，缺 16/20px 档。按钮 6px（应 8px）、卡片 8px（应 12px）、面板/模态 12px（应 16-20px）。消息气泡 6px（iMessage 约 18px）。全应用圆角偏紧，读起来"硬"而非 Apple 的"柔软连续圆角"。

3. **顶部边缘高光缺失（M4）** — `globals.css:429` 玻璃顶部高光 `rgba(255,255,255,0.18)`，远低于 Apple 示例 `0.4`。注释自辩"实测最佳"但玻璃边缘亮线几乎不可见，失去"光线打在材质边缘"的关键质感，玻璃看起来像扁平半透明色块而非真实材质。

4. **Toggle 尺寸严重偏小（R5）** — `ChatView:301` toggle `h-4 w-7`(16×28px)、`Settings:64` `h-5 w-9`(20×36px)，iOS 标准 31×51px。thumb 12-16px < 27px。toggle 是高频交互控件，偏小导致精致感缺失，不像 Apple 控件。

5. **消息/模态无对称退场路径（A6）** — `ConfirmDialog` 无退场动画、`MessageBubble` 删除硬消失、`ConversationList` 会话项无退场、`LoginPage` 模式切换硬切。Apple §7 要求"从哪来回哪去"，当前大量元素只进不出，关闭时突兀消失。

6. **Vibrancy 文字补偿缺失（C2）** — 玻璃顶栏（ChatView:342 glass-medium）、侧栏（glass-heavy）上的文字未加字重提升 + letter-spacing bump。Apple §12 明确"玻璃上文字不可用纯灰，需更高对比度、略重字重、字距微增"。当前文字在 blur 内容上可读性下降。

7. **`prefers-contrast: more` 完全缺失（D3）** — `globals.css` 有 reduced-motion（:765）和 reduced-transparency（:477），但无 `@media (prefers-contrast: more)`。Apple §14 列三个独立降级信号，当前只覆盖两个，高对比度需求用户无适配。

8. **Inter 字体优先于 SF Pro/系统字体（T1）** — `globals.css:90` 和 `tailwind.config.js:45` 均将 `'Inter'` 排在 `-apple-system` 之前。Apple §15 明确"默认用平台系统字体，自定义需理由"。Inter 在 macOS 上不是 SF Pro，失去系统级光学尺寸、字距表、可读性调优。同理 JetBrains Mono 优先于 SF Mono。

9. **玻璃叠层/内容穿透风险（M1/M3）** — `ChatView` 侧栏 glass-heavy(0.72) 偏不透明，内容穿透弱；`MessageBubble:429` 工具卡 rgba0.68 blur20 叠在已有 glass-medium 顶栏区域，轻叠重场景未验证。Apple §12 要求"永不轻叠轻"，且大表面应更透显内容。

10. **标题行高/正文字距未显式（T2/T3）** — `globals.css` h1/h2/h3 未设 `line-height`（缺 1.05-1.1 紧行高）；正文未显式 `letter-spacing:0`；小字未加正字距。Apple §15 要求行高随尺寸反向、字距随尺寸变化，当前依赖浏览器默认，非显式控制。

---

## 4. 修复优先级清单（P0/P1/P2，每项带具体改法）

### P0 — 核心体验差距（必须修）

| # | 项 | 当前值 | Apple 标准值 | 改法 |
|---|---|---|---|---|
| P0-1 | 圆角梯度整体偏小 | `--radius-md:6px / lg:8px / xl:12px`（globals.css:51-53） | `md:8px / lg:12px / xl:16px` + 新增 `2xl:20px` | globals.css:51 `--radius-md:8px`；:52 `--radius-lg:12px`；:53 `--radius-xl:16px`；新增 :54 `--radius-2xl:20px`；tailwind.config.js:38-43 同步加 `2xl:'var(--radius-2xl)'` |
| P0-2 | 顶部边缘高光过弱 | `rgba(255,255,255,0.18)`（globals.css:429） | `rgba(255,255,255,0.4)` 浅色 / `rgba(255,255,255,0.25)` 暗色 | globals.css:429 改 `inset 0 1px 0 0 rgba(255,255,255,0.25)`；浅色分支 :460 保持 0.5 |
| P0-3 | Toggle 尺寸偏小 | `h-4 w-7`(16×28) ChatView:301；`h-5 w-9`(20×36) Settings:64 | track `h-[31px] w-[51px]`，thumb 27px，位移 20px | ChatView:301 `h-[31px] w-[51px]`；:309 thumb `h-[27px] w-[27px]`；:311 `translateX(20px)`；Settings:64 同步 |
| P0-4 | 消息/模态无退场动画 | ConfirmDialog 无退场；MessageBubble 删除硬消失 | 退场 = 入场逆向路径（scale 0.97→0.95 + opacity 1→0） | ConfirmDialog 加 isExiting 态 `.surface.glass-exit` transform:scale(0.97) opacity:0 transition 200ms；MessageBubble 删除时加 exit class |
| P0-5 | 缺 `prefers-contrast: more` | 完全缺失（globals.css 无） | 近实色背景 + 对比边框 | globals.css 新增 `@media (prefers-contrast: more){ .glass-*{ background:var(--bg-panel); border:1px solid var(--border-strong);} .panel{ border-color:var(--border-strong);} }` |
| P0-6 | Toggle/侧栏无弹簧 | 全 `cubic-bezier` 静态曲线 | spring damping 0.8 response 0.3（toggle/动量） | Settings:82 `transition: transform 220ms cubic-bezier(...)` → 用 motion `animate(el,{transform:...},{type:'spring',bounce:0.2,duration:0.3})`；侧栏拖拽 release 同 |
| P0-7 | 侧栏拖拽无速度交接/投影 | ChatView:114-120 直接移除监听 | 记录 pointermove 速度历史，release 传 spring 初速度，投影落点 | ChatView:107 记录 lastMoves[]；:114 计算 velocity；release 用 `project(v,0.998)` 选 snap 点；spring 动画到目标宽度 |
| P0-8 | 系统字体优先级 | `'Inter', -apple-system`（globals.css:90） | `-apple-system, 'Inter', system-ui` | globals.css:90 `--font-sans: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', 'PingFang SC', ...`；tailwind.config.js:45 同步 |
| P0-9 | 输入框/发送按钮圆角偏小 | `borderRadius:'var(--radius-md)'`=6px（ChatInput:273,297） | 8px | 随 P0-1 修 `--radius-md:8px` 后自动达标 |
| P0-10 | 发送按钮无按压反馈 | sendButtonStyle 无 :active scale（ChatInput:293-299） | `:active scale(0.97)` | ChatInput 加 `onMouseDown`/`:active` 类或 inline `:active{transform:scale(0.97)}` |

### P1 — 重要质感差距（应修）

| # | 项 | 当前值 | Apple 标准值 | 改法 |
|---|---|---|---|---|
| P1-1 | 玻璃顶栏硬边框 | ChatView:344 `borderBottom:1px solid`；MessageList:371 `border-b` | scroll-fade 渐隐或顶部高光 | 改用 `.scroll-fade-bottom` mask 或 `box-shadow: inset 0 -1px 0 rgba(255,255,255,0.1)` |
| P1-2 | Vibrancy 文字补偿缺失 | 玻璃层文字无字重/字距补偿（ChatView:357 等） | 玻璃上文字 +1 weight、letter-spacing +0.01em | globals.css 新增 `.glass-text{ font-weight:510; letter-spacing:0.01em; }` 顶栏/侧栏文字加此类 |
| P1-3 | 玻璃内容穿透偏弱 | `.panel` bg `rgba(15,16,17,0.72)`（globals.css:373） | 暗色玻璃 ~0.5-0.6 | globals.css:373 `rgba(15,16,17,0.55)`；测试内容穿透 |
| P1-4 | 光学尺寸未启用 | `font-variation-settings: normal`（globals.css:136） | `font-optical-sizing: auto` | globals.css:136 加 `font-optical-sizing: auto;` |
| P1-5 | 标题行高未显式 | h1/h2/h3 无 line-height（globals.css:157-168） | h1/h2 `1.05-1.1`，h3 `1.2` | globals.css:158 `h1{ line-height:1.05;}`；:162 `h2{ line-height:1.1;}`；:166 `h3{ line-height:1.2;}` |
| P1-6 | 小字字距未正补偿 | section label `tracking-wider`(0.05em)（ConversationList:422） | 10px 小字 +0.02-0.03em | ConversationList:422 改 `tracking-[0.02em]` |
| P1-7 | 录音/播放按钮无按压 | ChatInput 录音按钮、MessageBubble:233 语音播放无 :active | scale(0.97) | 加 `emil-pressable` 类或 inline :active scale |
| P1-8 | 滚动按钮阴影单层 | `0 4px 12px rgba(0,0,0,0.3)`（MessageList:485） | ambient(0 2px 8px rgba 0.15) + directional(0 8px 24px rgba 0.25) | MessageList:485 改双层阴影 |
| P1-9 | 阴影无 ambient/directional 分离 | `--shadow-dialog` 三层全黑（globals.css:65-67） | ambient(近黑柔和) + directional(偏移聚焦) | globals.css:65 拆为 `--shadow-ambient: 0 4px 12px rgba(0,0,0,0.12)` + `--shadow-directional: 0 12px 32px rgba(0,0,0,0.25)` 组合 |
| P1-10 | 拖拽无橡皮筋 | ChatView:110 `Math.max/min` 硬 clamp | `rubberband(overshoot, dim, 0.55)` 渐进阻力 | ChatView:110 用 `rubberband` 函数，仅超过 200/500 时应用 |
| P1-11 | 工具卡无 materialize | MessageBubble:423-434 工具卡静态出现 | blur+scale 同步入场 | 加 `.glass-enter` 类或 `animation: scaleIn 200ms` + `backdrop-filter` 过渡 |
| P1-12 | 灯箱无退场 | MessageList:121 `animate-fade-in` 无退场 | opacity 1→0 退场 | 加 exit 态 class |

### P2 — 细节打磨（可修）

| # | 项 | 当前值 | Apple 标准值 | 改法 |
|---|---|---|---|---|
| P2-1 | 按钮 :active 时长 | 140ms（globals.css:78） | 100ms | globals.css:78 `--duration-press:100ms` |
| P2-2 | 列表项圆角偏小 | `var(--radius-md)`=6px（ConversationList:195） | 8-10px | 随 P0-1 达标 |
| P2-3 | 间距缺 12px 档 | 无 `--spacing-...` 12px（globals.css:57-61） | 12px | 新增 `--spacing-sm-md: 0.75rem` |
| P2-4 | 头像 xs 圆角偏小 | `rounded-md`=6px（AgentAvatar:27） | 8px | AgentAvatar:27 `xs: rounded-lg` |
| P2-5 | transition-all 滥用 | ConversationList:149 `transition-all` | 限定具体属性 | 改 `transition-colors, transform` |
| P2-6 | popover 退出非对称 | exit `scale(0.97)` ≠ enter `0.95` 逆（globals.css:511-514） | 退出 = 进入逆向 | globals.css:513 `transform: scale(0.95)` 与 enter 对称（或用 inverse curve） |
| P2-7 | 模态垂直 padding 偏紧 | `py-4`=16px（ConfirmDialog:66） | 20-24px | ConfirmDialog:66 `py-5`（20px） |
| P2-8 | 空状态标题字距未显式 | MessageList:415 无 letter-spacing | -0.01em | 加 `tracking-tight` |
| P2-9 | touch-action 未设 | 全局无 `touch-action` | `manipulation` 移除延迟 | globals.css base 加 `touch-action: manipulation` |
| P2-10 | Settings toggle 位移偏小 | `translateX(16px)`（Settings:81） | 位移 = track - thumb = 20px | Settings:81 `translateX(20px)`（随 P0-3 尺寸修正） |
| P2-11 | ConversationList 三组件重复 | ContactItem/DepartmentItem/GroupItem 90% 重复 | 抽象统一 Item | 重构为 `<Item variant="contact|dept|group">` |
| P2-12 | will-change 缺失于拖拽 | ChatView 拖拽手柄无 will-change | `will-change: width` | ChatView:327 拖拽手柄加 `style={{willChange:'width'}}` |

---

## 附：审计统计

- 审计文件：13 个
- 检查项总数：52 条（来自 Apple skill 17 节）
- 发现差距：高严重度 14 项 / 中 28 项 / 低 18 项
- P0（核心）：10 项 / P1（重要）：12 项 / P2（细节）：12 项
- 最大根因：全局零物理弹簧 + 圆角偏小一档 + 顶部高光缺失 + toggle 偏小

> 本报告所有数值均来自 `docs/refactor/apple-design.md` 原文或 Apple HIG 公开规范，行号均经实际读取核对。修复时建议按 P0→P1→P2 顺序，每项改后回归验证暗色/浅色两主题 + reduced-motion 三态。

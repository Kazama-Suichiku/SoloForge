# SoloForge 前端重构设计 Spec

## 设计方向
Linear 风格——极简暗色优先、精确排版、紫色 accent、密度高但不杂乱。
从"AI 味"通用 SaaS 蓝色 → 专业开发者工具的近黑 + 靛紫单 accent。

## 设计 Token（替换 globals.css）

### 暗色主题（默认）
```
--bg-base: #08090a          /* 最深底色 */
--bg-panel: #0f1011          /* 侧边栏/面板 */
--bg-surface: #191a1b       /* 卡片/弹层 */
--bg-hover: rgba(255,255,255,0.04)  /* hover 态 */

--text-primary: #f7f8f8     /* 主文字，非纯白 */
--text-secondary: #d0d6e0    /* 次要 */
--text-tertiary: #8a8f98     /* 辅助 */
--text-quaternary: #62666d   /* 最弱 */

--accent: #5e6ad2            /* 品牌靛紫 */
--accent-hover: #7170ff      /* 交互态 */
--accent-active: #828fff     /* 悬浮态 */

--border-subtle: rgba(255,255,255,0.05)
--border-default: rgba(255,255,255,0.08)
--border-strong: #23252a

--radius-sm: 4px
--radius-md: 6px    /* 按钮/输入 */
--radius-lg: 8px    /* 卡片 */
--radius-xl: 12px   /* 面板 */
--radius-full: 9999px

--shadow-elevated: rgba(0,0,0,0.4) 0px 2px 4px
--shadow-dialog: 多层叠加
```

### 浅色主题（可选切换）
```
--bg-base: #f7f8f8
--bg-panel: #f3f4f5
--bg-surface: #ffffff
--bg-hover: rgba(0,0,0,0.04)
--text-primary: #08090a
--text-secondary: #62666d
--border-default: rgba(0,0,0,0.08)
```

## 排版
- 字体: Inter（含 cv01/ss03 特性），等宽 JetBrains Mono
- 三档字重: 400（阅读）/ 510（UI 强调）/ 590（标题）
- 大标题负字距: 48px→-1.056px, 32px→-0.704px, 24px→-0.288px

## 组件原则
- 按钮背景半透明（rgba 0.02~0.05），非实色
- 边框半透明白色（0.05~0.08），非实色暗
- 深度通过背景亮度阶梯（0.02→0.04→0.05），非阴影
- brand 靛紫仅用于 CTA/交互，不做装饰
- 圆角: 按钮 6px / 卡片 8px / 面板 12px

## 布局架构（支撑多 Agent 并发）
当前: 单列聊天 + 固定侧边栏
重构为:
1. 左侧栏（可折叠）: 会话列表 + 部门群聊 + Agent 状态
2. 中央主区: 聊天流（MessageList 已 memo 优化）
3. 右侧抽屉（可展开）: 多 Agent 活动流 / 工具调用详情
4. 顶部命令栏: Cmd+K 快速切换 Agent / 发指令

## 性能
- MessageBubble memo 已做
- 流式 buffer 移出 store 已做
- 补充: ConversationList memo + 虚拟化建议（200 条限制）
- CSS 用变量而非 Tailwind 动态类（减少运行时）

## 重构范围
1. globals.css + tailwind.config（设计 token）
2. ChatView + ConversationList（核心布局）
3. MessageBubble + ChatInput（聊天组件）
4. Dashboard + dashboard 子组件（数据面板）
5. Settings + AgentSettings（配置页）
6. 登录/公司选择页
7. 通用组件（AgentAvatar / OrgChart / 同步面板）

## 批次划分（文件不重叠）
- 批次1（3并行）: A 设计系统(globals.css+tailwind) / B ChatView+ConversationList / C MessageBubble+ChatInput
- 批次2（3并行）: D Dashboard 全套 / E Settings+AgentSettings / F 登录页+公司选择页+通用组件

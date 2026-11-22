---
name: Krosna
description: 面向终端 CLI 智能体的本地优先桌面工作台设计系统，支持四套实色主题与 WCAG AA 对比度门禁。
colors:
  cobalt-signal: "#4263eb"
  warm-terracotta: "#a75d2b"
  starlight-periwinkle: "#8198ff"
  mocha-amber: "#f5bd69"
  moss-accent: "#6b8e5e"
  starlight-lavender: "#cba6f7"
  signal-green: "#16a34a"
  signal-amber: "#d97706"
  signal-red: "#ef4444"
  close-crimson: "#c42b1c"
  light-canvas: "#f1f3f7"
  light-surface: "#ffffff"
  light-ink: "#20242c"
  light-ink-secondary: "#4f5f79"
  light-border: "#d3d9e4"
  warm-canvas: "#f3eee6"
  warm-surface: "#fffcf6"
  warm-ink: "#30271f"
  warm-border: "#ddd1c1"
  starry-canvas: "#15181f"
  starry-surface: "#1e232d"
  starry-elevated: "#282f3c"
  starry-ink: "#e4edf9"
  starry-border: "#3d4759"
  mocha-canvas: "#211c19"
  mocha-surface: "#2b2521"
  mocha-elevated: "#37302a"
  mocha-ink: "#f3e5d6"
  mocha-border: "#554738"
  ink-on-dark-primary: "#15171b"
typography:
  title:
    fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Noto Sans CJK SC', sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.4
  body:
    fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Noto Sans CJK SC', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'Geist Mono', 'Cascadia Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  badge:
    fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Noto Sans CJK SC', sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1
rounded:
  control: "6px"
  overlay: "8px"
  panel: "10px"
  dialog: "14px"
spacing:
  xs: "3px"
  sm: "8px"
  md: "12px"
  lg: "20px"
components:
  button-primary:
    backgroundColor: "{colors.cobalt-signal}"
    textColor: "{colors.light-surface}"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "0 14px"
  button-default:
    backgroundColor: "{colors.light-surface}"
    textColor: "{colors.light-ink}"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "0 14px"
  input-field:
    backgroundColor: "{colors.light-surface}"
    textColor: "{colors.light-ink}"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "4px 10px"
  titlebar-search:
    backgroundColor: "{colors.light-surface}"
    textColor: "{colors.light-ink-secondary}"
    rounded: "{rounded.control}"
    height: "30px"
    padding: "0 10px"
  session-list-item:
    backgroundColor: "{colors.light-canvas}"
    textColor: "{colors.light-ink}"
    rounded: "{rounded.overlay}"
    padding: "7px 10px"
---

# Design System: Krosna

## Overview

**Creative North Star: "The Quiet Workbench"**

Krosna 是一套面向高频开发者的桌面工作台视觉系统：温润纸感与深邃夜色并存，以高信息密度承载多智能体会话、终端与 Git 状态，同时在视觉上保持克制、不喧宾夺主。界面主体摒弃玻璃拟态与多余阴影，依靠实色阶层、1px 细描边与精准的 2px 状态指示线组织空间，让用户的注意力始终停留在终端输出与代码本身。

整套系统以四套可切换主题（清朗蓝白 `light-glass`、暖木书房 `light-warm`、星空沉浸 `dark-starry`、摩卡棕夜 `dark-mocha`）共享同一套结构尺寸与语义变量（`--cs-*`），所有配色组合均受 WCAG AA 对比度门禁保护，确保长时间编码与多语言（简中、英、日）界面下依然清晰可读。

**Key Characteristics:**
- 四套主题共享结构尺寸，通过 `--cs-*` 语义变量统一切换实色阶层与主色角色。
- 主体工作区默认扁平（无投影、无毛玻璃），仅弹窗、抽屉与菜单等浮层使用环境阴影。
- 高信息密度桌面控件（40px 标题栏、30px 搜索框、32px 标准控件高度）配合干脆的 `0.96` 按压反馈。
- 所有前景与背景颜色必须成对配置，禁止单边覆盖导致深浅主题对比度失效。

## Colors

以“材质与自然意象”命名四套主题的主色与底色角色，每套主题均由低饱和背景基底、实色卡片层、高对比文字阶层与单一高辨识度主色构成。

### Primary
- **清朗钴蓝（light-glass）**：用于 `light-glass` 亮色主题的主操作按钮、激活态指示线、聚焦边框与选中高亮，传递理性、清爽的工程秩序感。
- **暖木赤陶（light-warm）**：用于 `light-warm` 暖色书房主题的主操作按钮与高亮指示，在米白纸感基底上提供沉稳温润的视觉锚点。
- **星夜矢车菊（dark-starry）**：用于 `dark-starry` 深色主题的主操作与激活态，在深蓝灰夜色背景上保持高对比且不刺眼的冷光提示（搭配近黑前景文字）。
- **摩卡琥珀（dark-mocha）**：用于 `dark-mocha` 暖棕深色主题的主操作与激活态，与深咖啡基底形成温暖高对比（搭配近黑前景文字）。

### Secondary
- **苔藓绿辅色（light-warm 辅色）** / **星夜薰衣草（dark-mocha 辅色）**：仅在特定主题的次级状态、装饰性渐变或图表标识中少量使用。
- **语义状态色**：成功绿（`#16a34a` / `#22c55e`）、警示琥珀（`#d97706` / `#f59e0b`）、危险红（`#ef4444` / `#dc2626` / `#ff7575`）与 Windows 窗口关闭按钮专属深红（`#c42b1c`）。

### Neutral
- **应用基底与实色卡片**：亮色采用微冷灰蓝（`#f1f3f7`）与米白纸色（`#f3eee6`）作为外壳基底，搭配纯白/象牙白卡片（`#ffffff` / `#fffcf6`）；暗色采用深空蓝灰（`#15181f`）与深烘焙棕（`#211c19`）作为基底，逐级抬升卡片与浮层亮度。
- **三级文字阶层**：主文字（primary）、次文字（secondary）、辅助/占位文字（tertiary）严格区分信息主次，并在四套主题下分别校准亮度以保证可读性。
- **细线描边**：使用 `--cs-border`、`--cs-border-card`、`--cs-border-sidebar` 划分窗格边界；暗色主题浮层边框混入 22% 白色以增强在深色背景上的轮廓识别。

### Named Rules
**The Paired Contrast Rule.** 覆盖任何 Ant Design token 或自定义组件配色时，前景色与背景色必须成对声明并在 `src/lib/antdTheme.ts` 集中管理，严禁只改文字色或只改背景色；正文与浮层对比度必须 ≥ 4.5:1，实心主色控件对比度必须 ≥ 3.5:1。

**The No-Hardcoded-Color Rule.** 组件与样式表禁止直接写死十六进制颜色值，所有颜色必须通过 `--cs-*` CSS 变量或集中导出的主题常量引用。

## Typography

**Display Font:** Inter, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Noto Sans CJK SC", sans-serif
**Body Font:** Inter, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Noto Sans CJK SC", sans-serif
**Label/Mono Font:** "Geist Mono", "Cascadia Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace

**Character:** 现代无衬线系统字体与等宽代码字体组合，兼顾 Windows 桌面端中英日三语混排的锐利度，以及终端标题、路径与时间标签的等宽对齐精度。

### Hierarchy
- **Title**（500, 15px, 1.4）：用于弹窗标题、设置分组标题与当前激活标签页（激活标签加粗至 `500`）。
- **Body**（400, 13px, 1.5）：用于桌面端正文、列表项、说明文案与错误栈信息（开发错误面板为 `13px`，行高 `1.6`）。
- **Label**（400, 12px, 1.4）：用于状态栏信息、快捷方式提示、时间戳与代码/终端路径等辅助元信息。
- **Badge**（600, 10px, 1）：用于侧边栏图标角标与紧凑计数胶囊（配合等宽数字 `tabular-nums`）。

### Named Rules
**The Mono-For-Telemetry Rule.** 文件路径、命令行参数、快捷键提示与终端/状态栏计数优先使用 `--font-mono` 等宽字体，确保数字与路径在高频扫视时不发生横向抖动。

## Layout

采用全屏桌面工作台壳层布局：顶部固定 `40px` 标题栏（`app-titlebar`，含品牌标识、项目切换、居中的 `min-width: 168px` 搜索框及右侧 `40px` 宽度的窗口控制按钮），中间为可折叠侧边栏与多标签/分屏主舞台，底部为状态栏。工作区标签页默认宽度 `192px`，使用绝对定位与 `data-active="true"` 切换显示，避免隐藏和重排销毁 PTY 终端实例。

### Named Rules
**The Zero-PTY-Reflow Rule.** 侧边栏折叠与面板切换通过显隐与透明度过渡完成，禁止在过渡动画中反复改变主舞台宽度，防止嵌入式 PTY 终端字符网格频繁重排。

## Elevation & Depth

本系统采用**主体扁平分层 + 浮层环境阴影**的混合策略：主工作台外壳、工具栏、侧边栏、卡片与终端容器在静止状态下完全扁平（`box-shadow: none`），仅靠背景色阶差与 `1px` 实线边框建立前后关系；只有脱离主平面的浮层（Modal、Drawer、Popover、Dropdown、Select 下拉、Tooltip）才允许携带大半径弥散阴影，以明确“临时交互层”的层级跃迁。

### Shadow Vocabulary
- **Floating Overlay Shadow**（`box-shadow: 0 8px 28px var(--cs-shadow-overlay)`）：用于常规浮动控件与气泡（`--cs-shadow-floating`）。
- **Dialog / Drawer Shadow**（`box-shadow: 0 12px 32px var(--cs-shadow-overlay)`）：用于模态弹窗、抽屉与下拉菜单（`--cs-overlay-shadow`），在亮色下偏冷/暖灰半透，在暗色下统一使用 `rgba(0, 0, 0, 0.28)`。

### Named Rules
**The Flat-By-Default Rule.** 主工作区面板、卡片、终端表面与工具栏默认 `box-shadow: none` 且不使用 `backdrop-filter` 毛玻璃，阴影仅属于浮层（Modal / Popover / Dropdown / Drawer / Tooltip）。

## Shapes

圆角尺度随容器层级递增，保持利落的工程几何感：标准交互控件（按钮、输入框、标题栏搜索框、Tooltip）使用 `6px`（`--cs-radius-control`）；列表项与小型浮层使用 `8px`（`--cs-radius-overlay`）；弹出面板、下拉菜单与设置卡片使用 `10px`（`--cs-radius-panel` / `--cs-overlay-radius-popup`）；模态弹窗与抽屉工作区朝向侧使用 `14px`（`--cs-overlay-radius-dialog`）。终端表面（`app-terminal-surface`）采用 `0px` 直角裁切，最大化字符可视面积。

## Components

所有组件均强调高对比、清晰边界与克制而干脆的交互反馈：静止时边界明确，悬停即现高亮，按压呈现微幅缩放（`scale(0.96)`），聚焦使用主色边框或 `2px` 环形光晕。

### Buttons
- **Shape:** 标准矩形圆角（`6px`），高度 `32px`，默认禁用投影（`defaultShadow: none`、`primaryShadow: none`）。
- **Primary:** 填充当前主题 `--cs-primary` 与配对的 `--cs-text-on-primary`（亮色为白字，暗色为 `#15171b` 深字）。
- **Hover / Focus / Active:** 悬停切换 `--cs-bg-hover` 与 `--cs-primary` 边框；非禁用态点击按压缩放至 `scale(0.96)`；窗口关闭按钮独立使用 `--cs-window-close-hover-bg` 与纯白图标。
- **Secondary / Default:** 实色卡片底（`--cs-bg-card-solid`）配合 `1px` `--cs-border` 描边。

### Cards / Containers
- **Corner Style:** 工具卡片与设置面板使用 `10px` 圆角（`--cs-panel-radius`），弹窗与抽屉使用 `14px` 圆角（抽屉仅朝向工作区一侧圆角）。
- **Background:** 实色背景 `--cs-bg-card-solid`，弹窗底部操作区延展至边缘并填充 `--cs-overlay-footer-bg`（与正文区以 `1px` 分割线隔开）。
- **Shadow Strategy:** 主体卡片无阴影，浮层容器使用 `--cs-overlay-shadow`。
- **Border:** `1px solid var(--cs-border-card)`；暗色主题浮层混入 22% 白色以强化边缘轮廓。

### Inputs / Fields
- **Style:** `1px` `--cs-border` 描边，填充 `--cs-bg-card-solid`，圆角 `6px`，占位符统一使用 `--cs-text-tertiary`。
- **Focus:** 边框切换为 `--cs-primary` 并外扩 `0 0 0 2px var(--cs-primary-light)` 柔和焦点环；菜单列表聚焦使用 `2px solid var(--cs-primary)` 内缩轮廓。
- **Disabled:** 光标恢复为 `default`，禁止按压缩放。

### Navigation
- **Style & Indicator:** 顶部标签栏与侧边导航栏采用扁平背景；选中态通过 `2px` 厚度（`--cs-marker-thickness`）的 `--cs-primary` 指示条标识，标签指示条随滚动平滑位移动画（`180ms`）。
- **Tab Width & Title:** 工作区标签页固定 `192px` 宽度，激活态标题字重提升至 `500`。

### Signature Component: Session List Item & Titlebar Search
- **Session List Item:** 最小高度 `48px`，内边距 `7px 10px`，圆角 `8px`；默认仅展示会话摘要与时间，悬停或内部聚焦时平滑隐藏摘要并显现操作按钮组；激活态使用 `--cs-bg-active` 配合 18% 主色微边框。
- **Titlebar Search:** 高度 `30px`、最小宽度 `168px` 的紧凑型搜索触发器，使用标题栏与卡片底色 65% 混合背景，悬停或激活时边框立即切换为 `--cs-primary`。

## Do's and Don'ts

### Do:
- **Do** 在 `src/lib/antdTheme.ts` 中成对配置所有前景色与背景色 token，并确保修改 `themes.css` 后同步更新全部 4 套主题。
- **Do** 使用 `--cs-*` CSS 变量、Tailwind CSS 类名与 i18next 翻译键编写界面，保持样式与文案的多主题、三语一致性。
- **Do** 在浮层（Modal、Drawer、Popover、Dropdown、Tooltip）中沿用 `overlays.css` 的统一 `--cs-overlay-*` 变量，保证跨主题边缘清晰度。
- **Do** 尊重 `prefers-reduced-motion` 并仅将动效应用于外壳层与指示器，不干扰终端渲染性能。

### Don't:
- **Don't** 单边覆盖 AntD 的文字色或背景色 token（如只设 `colorTextLightSolid` 不设 `colorBgSpotlight`），避免深色主题出现“灰底深字”对比度事故。
- **Don't** 在主体工作区卡片、工具栏或终端表面重新引入毛玻璃（`backdrop-filter`）或常驻投影（`box-shadow`）。
- **Don't** 在组件中使用 inline style 或硬编码颜色值、用户可见字符串。
- **Don't** 在侧边栏或面板切换动画中对主内容区执行宽度插值过渡，以免触发 PTY 终端网格频繁重排。

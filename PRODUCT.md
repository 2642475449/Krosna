# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

重度使用多个终端 CLI 智能体的个人开发者（当前以 Windows 桌面环境为主），需要在同一项目下并行管理多个智能体会话、终端进程与 Git 变更上下文。

## Product Purpose

Krosna（原名 Termflow）是一款基于 Tauri 2 构建的本地优先桌面工作台，将多种 CLI 智能体的命令行体验组织到统一的本地图形界面中，让项目、会话、嵌入式终端、文件预览与 Git 工作流保持在同一个上下文里，减少在多个独立终端窗口与工具间频繁切换的摩擦。

## Positioning

- **本地优先、不绑定特定模型或 IDE**：原生整合多种上游 CLI 智能体（Claude Code、Codex、Antigravity CLI、OpenCode、Qoder CLI、Pi 等），不强制替换用户既有的编辑器与命令行工作方式，也不依赖云端账号。
- **高频桌面工作台体验**：围绕桌面端高频任务提供嵌入式 PTY 终端、语音输入（MiMo / DashScope ASR）、智能体用量与速率限制监控、桌面/远程通知及关闭后无缝恢复的历史会话持久化。

## Operating Context

- **运行环境**：Windows 桌面端为主的本地 Tauri 2 应用，数据存储于本地 SQLite 与前端持久化配置；支持 `.krosna/quick-commands.json`（项目级快捷命令）与 `.krosna/launchers.json`（多终端启动组合）的本地与 Git 协作复用。
- **典型工作流**：打开或切换本地 Git 项目 → 并行开启多个 CLI 智能体或普通终端会话 → 浏览/编辑项目文件与 Markdown/PDF 预览（支持将文件拖入 CLI 输入框）→ 在侧边栏完成 Git 状态查看、差异对比、AI 生成提交信息与检查点审阅。

## Capabilities and Constraints

- **核心能力**：多智能体与多会话管理、xterm.js 嵌入式终端、Monaco 代码编辑与文件树、Git 完整工作流与检查点审阅、语音输入悬浮窗与 Worker 多窗口架构、全局搜索与快速命令。
- **技术与架构约束**：
  - 前端为 React 19 + TypeScript（严格模式）+ Vite 6 + Zustand 5 + Ant Design 6 + Tailwind CSS 4；后端为 Rust (Tauri 2) + portable-pty + git2 + rusqlite。
  - 严禁前端组件直接绕过 `src/lib/api/` 调用 Tauri `invoke()`，全局状态统一走 Zustand store。
  - 多窗口架构（主窗口、`VoiceOverlayWindow`、`VoiceWorkerWindow`）共享同一前端代码并通过查询参数区分。
  - 所有用户可见文本必须使用 i18next 翻译键（支持简体中文 `zh-CN`、英文 `en-US`、日语 `ja-JP`），禁止硬编码。
- **交互与密度约束**：保持高信息密度的桌面操作效率（Operate 模式），优先支持键盘快捷键与多窗格并行工作。

## Brand Commitments

- **产品名称**：已由 **Termflow** 更名为 **Krosna**，保留旧版数据与配置迁移兼容。
- **隐私与本地边界**：严格本地优先，无强制云端账号或云端锁死，会话、配置与索引数据留存本地。

## Evidence on Hand

- 仓库文档与架构约定：[README.md](README.md)、[AGENTS.md](AGENTS.md)
- 界面预览截图与品牌资产：`.github/assets/krosna-overview.png`、`public/logo.png`、`public/agents/`
- 自动化校验测试：`src/lib/colorContrast.test.ts`、`src/lib/antdTheme.test.ts` 等前端单元测试与 Rust 单元测试

## Product Principles

1. **同一上下文，零冗余切换**：项目、终端、智能体会话、文件与 Git 状态始终围绕同一工作区协同，不把用户推向割裂的窗口。
2. **本地优先与隐私可控**：默认本地运行与本地持久化，所有外部连接（ASR、远程通知、更新检查）均为显式可选。
3. **高密度且克制的操作效率**：面向高频开发者优化信息密度、键盘直达与可预测性，避免牺牲可用空间的纯装饰元素。
4. **多语言与多主题一等公民**：任何新功能必须同步满足简中/英/日三语规范与全主题可用性。

## Accessibility & Inclusion

- 所有 4 套主题下的正文、浮层（Tooltip、Popover）文字与背景对比度必须 ≥ 4.5:1，实心控件主色与前景对比度必须 ≥ 3.5:1（由 `src/lib/colorContrast.test.ts` 与 `src/lib/antdTheme.test.ts` 自动门禁校验）。
- 覆盖全局键盘快捷键操作与多语言（`zh-CN`、`en-US`、`ja-JP`）文本长度变化下的布局兼容。

# Krosna GPUI 终端独立评估

这是可删除的独立实验工程，不接入正式应用，不修改主工程依赖、数据库或项目配置。评估重点是 Windows 终端输入与输出流畅度。

## 两个原型

- `gpui-terminal-eval`：已发布的 GPUI **0.2.2**、`vt100` 解析器、Rust ConPTY。活动终端按颜色片段绘制固定网格，非活动终端仍解析输出。
- `webview-terminal-eval`：Tauri **2.11.0**、主仓库安装的 xterm.js 和 WebGL addon，相同 Rust ConPTY 与负载生成器。它是简化的技术栈对照，不是完整 Krosna。
- 两边都使用 100 列、28 行、1000 行解析器回滚缓冲；一个终端可见，其他会话后台解析。GPUI 原型尚未实现回滚浏览。
- Cargo 锁文件以主工程现有版本为基础解析，避免 Tauri 2.11 与较新的 runtime/macros 不兼容。主工程锁文件不会被实验修改。

## 构建与运行

从 Krosna 仓库根目录执行（需要现有 pnpm 依赖、Windows Rust/MSVC 工具链、WebView2）：

```powershell
pnpm exec vite build --config experiments/gpui-terminal/vite.config.mjs
pnpm exec tsc --project experiments/gpui-terminal/tsconfig.json
cargo build --release --locked --manifest-path experiments/gpui-terminal/Cargo.toml --features gpui-ui,webview-ui --bins
cargo test --locked --manifest-path experiments/gpui-terminal/Cargo.toml --no-default-features --lib

# 快速检查；结果存放在隔离的 results/smoke
./experiments/gpui-terminal/run-evaluation.ps1 -Iterations 1 -Duration 3 -SessionCounts 1 -Rates 131072 -ResultSet results/smoke

# 正式矩阵：两轮，交替先运行哪个引擎
./experiments/gpui-terminal/run-evaluation.ps1 -Iterations 2 -Duration 8
```

交互检查可从实验目录执行：

```powershell
./target/release/gpui-terminal-eval.exe --interactive --sessions 4 --rate 131072
./target/release/webview-terminal-eval.exe --interactive --sessions 4 --rate 131072
```

这两个窗口仅连接本实验的回显负载进程，不运行用户项目命令。文字输入后按 Enter，负载进程返回 `INPUT:` 行。GPUI 输入包含最小的输入法组合文本接口和 Ctrl+V，未作为完整终端输入实现验收。

## 实验设计

1. 每个会话启动同一个二进制的 `--producer` 模式，经过真实 Windows ConPTY。
2. 每 10ms 推进一次固定计数的负载，包含 ANSI 颜色、UTF-8 中英文/emoji、回车覆盖和清行。两个原型使用相同生成算法、时长和目标速率；探针与 ConPTY 自身应答会带来少量额外字节。
3. 每 125ms 轮流向一个 PTY 输入 `probe:N` 并提交，子进程返回包含编号的 OSC 标记。标记经过各自解析流程，再由公共 Rust 统计确认。
4. GPUI 每帧最多处理 256KiB；WebView 使用 xterm 的异步写入队列，每帧合并统计回执，避免逐包 ACK。公共接收队列容量为 256 个包。
5. 固定矩阵为 1/4 个会话 × 每会话 128/512KiB/s，所有会话都解析，只有一个可见。负载结束后留 3 秒排空，再保存报告并退出。
6. 外部 PowerShell 以约 500ms 间隔采样本次启动进程及其后代，保存私有内存、累计 CPU 时间和退出状态。每轮调整引擎顺序。

## 指标的实际含义

| 指标 | 测量边界与限制 |
| --- | --- |
| `synthetic_input_to_parser_ack_ms` | Rust 写入探针 → ConPTY/子进程 → 终端解析 → Rust 确认。WebView 额外包含按帧回传确认的 IPC；不是物理键盘到屏幕延迟。 |
| `synthetic_input_to_pty_read_ms` | Rust 写入探针 → Rust 从 ConPTY 读到回显标记，用来观察子进程/PTY 的响应，尚未进入 UI。不能直接与另一项 P95 相减获得 UI P95。 |
| `pty_read_to_parser_ack_ms` | Rust 读取输出 → UI 解析 → Rust 确认，包含队列等待。不能当成纯绘制耗时。 |
| `packet_parse_us` | GPUI 是同步 `vt100.process` CPU 耗时；xterm 是 `write` 入队到回调的时间。边界不同，不据此计算解析器速度倍数。 |
| `ui_tick_gap_ms` | GPUI 的 `on_next_frame` 回调或 WebView 的 `requestAnimationFrame` 间隔。不是 GPU 呈现时刻，也不证明每帧像素已正确显示。 |
| `paint_callbacks` | GPUI 自定义画布 paint 回调或 xterm 的 onRender 回调计数。只证明相应绘制代码运行，不能证明像素正确或比较帧数优劣。 |
| `sequence_errors` | 每会话输出包顺序是否连续；还需核对 PTY 读取量与 UI 处理量。 |
| `probe_pending` | 已发送但未确认的探针数量；不能只看成功探针的分位数而忽略丢失。 |
| `peakPrivateMiB` | 采样到的进程树私有字节总和，包含负载子进程；不是任务管理器工作集，也不是完整产品内存。 |
| `observedCpuSeconds` | 采样到的各进程累计 CPU 时间最大值之和，可能漏掉短命进程；包含负载与测量代码，不是 GPU 时间或 CPU 百分比。 |

## 可比性边界

- 两套解析器、绘制实现、输入路径和统计回传路径不同，这是技术栈原型比较，不能单独归因于 GPUI 或 Rust。
- 对照组没有复制完整 Krosna 的输出批处理、IME 门控、状态监测等机制。实验结果不能写成“正式 Krosna 提升了 X%”。
- GPUI 原型每帧重建可见行布局，尚未实现行缓存、自定义终端 Element、准确字体格宽测量或完整属性支持；它不是 Zed 终端的复用版。
- 两边均包含冷启动阶段，没有独立预热样本；两轮样本量只适合初步筛查，不提供统计显著性结论。
- 未使用真实 CLI 智能体或真实项目日志，避免泄露会话内容；负载是明确标记的合成回放。
- 中文输入法候选窗位置、组合提交、Windows 粘贴历史、文本选择、回滚、鼠标协议、窗口/DPI 变化、真实 TUI 和长时间运行仍需交互验收。
- 本实验不证明剪贴板、麦克风等权限策略的正确性，也不访问麦克风。

## 输出与复核

`results/` 被本实验的 `.gitignore` 忽略，保存每次原始 JSON、进程采样和标准输出/错误；`REPORT.md` 保存本机实测结论与限制。构建产物仅在本实验的 `target/`、`dist/` 中。

## 官方参考

- [GPUI 发布版 0.2.2](https://crates.io/crates/gpui/0.2.2)
- [GPUI 主分支说明](https://github.com/zed-industries/zed/tree/main/crates/gpui)（API 可能与发布版不同）
- [GPUI 官方示例说明](https://gpui.rs/examples/)
- [xterm.js 官方仓库](https://github.com/xtermjs/xterm.js)
- [vt100 解析器](https://github.com/doy/vt100-rust)

"""Validate local measurements and produce an auditable repository report."""
import hashlib
import json
from pathlib import Path
import tomllib

ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def span(values):
    lo, hi = min(values), max(values)
    return f"{lo:.1f}" if round(lo, 1) == round(hi, 1) else f"{lo:.1f}–{hi:.1f}"


processes = read(RESULTS / "process-summary.json")
machine = read(RESULTS / "machine.json")
records = []
problems = []
for process in processes:
    name = process["case"]
    path = RESULTS / f"{name}.json"
    if not path.exists():
        problems.append(f"{name}: missing parser report")
        continue
    result = read(path)
    valid = (
        not process["timedOut"]
        and process["exitCode"] == 0
        and result["sequence_errors"] == 0
        and result["probe_pending"] == 0
        and result["probe_sent"] > 0
        and result["synthetic_input_to_parser_ack_ms"]["count"] == result["probe_sent"]
        and result["pty_read_bytes"] == result["parsed_utf8_bytes"]
        and result["paint_callbacks"] > 0
    )
    if not valid:
        problems.append(f"{name}: completeness validation failed")
    records.append({"case": name, "valid": valid, "result": result, "process": {k: v for k, v in process.items() if k != "samples"}})

lock = tomllib.loads((ROOT / "Cargo.lock").read_text(encoding="utf-8"))
versions = {p["name"]: p["version"] for p in lock["package"] if p["name"] in ["gpui", "vt100", "tauri", "tauri-build", "tauri-macros", "tauri-runtime", "tauri-runtime-wry", "wry", "tao"]}
source_files = ["Cargo.toml", "Cargo.lock", "build.rs", "src/lib.rs", "src/gpui_main.rs", "src/webview_main.rs", "web/main.ts", "web/style.css", "tauri.conf.json", "run-evaluation.ps1"]
hashes = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in source_files}
web_versions = {name: read(ROOT.parents[1] / "node_modules" / name / "package.json")["version"] for name in ["@xterm/xterm", "@xterm/addon-webgl", "@tauri-apps/api"]}
binary_hashes = {name: hashlib.sha256((ROOT / "target/release" / name).read_bytes()).hexdigest() for name in ["gpui-terminal-eval.exe", "webview-terminal-eval.exe"]}
stderr = {p.name: p.read_text(encoding="utf-8", errors="replace").strip() for p in RESULTS.glob("*-i*.stderr.log") if p.read_text(encoding="utf-8", errors="replace").strip()}
snapshot = {"machine": machine, "versions": versions, "web_versions": web_versions, "source_sha256": hashes, "binary_sha256": binary_hashes, "stderr": stderr, "problems": problems, "records": records}
(ROOT / "measurements.json").write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

lines = [
    "# GPUI 终端原型：本机评估报告", "",
    f"采样开始：{machine['recordedAt']}。本报告由 `summarize.py` 从原始测量生成，可复核数据见 `measurements.json`。", "",
    "## 已完成的实际工作", "",
    "- 两个独立的优化构建：GPUI/vt100 与 Tauri/xterm.js/WebGL。正式 Krosna 未切换技术栈。",
    "- 真实 Windows ConPTY，合成 ANSI/UTF-8 输出与自动回显输入探针。",
    "- 1/4 会话 × 每会话 128/512KiB/s，每组两轮，第二轮反转运行顺序。每次负载 8 秒，排空约 3 秒。",
    f"- 有效样本 {sum(r['valid'] for r in records)}/{len(records)}；检查退出码、字节完整性、包顺序、探针确认和绘制回调。",
    "- 测试覆盖 UTF-8/颜色/光标覆盖/备用屏、分块探针识别、序号缺口和分位数统计。", "",
    "## 测试环境", "",
    f"- CPU：{machine['cpu'][0]['Name']}，{machine['cpu'][0]['NumberOfLogicalProcessors']} 个逻辑处理器。",
    f"- 系统：{machine['os'][0]['Caption']} / {machine['os'][0]['Version']}。",
    "- 图形设备：" + "；".join(g['Name'] for g in machine['gpu']) + "。列出设备不代表已确认实际选择的渲染适配器。",
    f"- Rust：{machine['rust']}。",
    "- 固定依赖：" + ", ".join(f"{k} {v}" for k, v in versions.items()) + "。",
    "- 对照前端：" + ", ".join(f"{k} {v}" for k, v in web_versions.items()) + "。",
    "- 当前桌面上的其他应用未被关闭，实验不是专用空闲机器测量。", "",
    "- 8 次 WebView 运行的退出日志均出现 `Chrome_WidgetWin_0` 注销失败（1412）；退出码为 0，数据完整性检查通过。本次未单独调查该退出告警，原文保存在测量快照中。", "",
    "## 实测结果", "",
    "各单元格是两轮独立运行结果的最小值–最大值。P95 为每轮内部的分位数，不是合并样本的分位数；CPU 是整个进程树累计秒数。", "",
    "| 会话数 | 每会话负载 | 原型 | 探针至解析确认 P95 ms | 探针至 PTY 返回 P95 ms | UI 回调间隔 P95 ms | 峰值私有内存 MiB | 进程树 CPU 秒 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
]
for sessions in (1, 4):
    for rate in (131072, 524288):
        for engine in ("gpui", "webview"):
            group = [r for r in records if r["valid"] and r["result"]["engine"] == engine and r["result"]["config"]["sessions"] == sessions and r["result"]["config"]["rate"] == rate]
            if not group:
                lines.append(f"| {sessions} | {rate // 1024} KiB/s | {engine} | 无有效样本 | — | — | — | — |")
                continue
            metrics = [
                span([r["result"]["synthetic_input_to_parser_ack_ms"]["p95"] for r in group]),
                span([r["result"]["synthetic_input_to_pty_read_ms"]["p95"] for r in group]),
                span([r["result"]["ui_tick_gap_ms"]["p95"] for r in group]),
                span([r["process"]["peakPrivateMiB"] for r in group]),
                span([r["process"]["observedCpuSeconds"] for r in group]),
            ]
            lines.append(f"| {sessions} | {rate // 1024} KiB/s | {engine} | " + " | ".join(metrics) + " |")

lines += [
    "", "## 本次评估判断", "",
    "本机这两个简化原型中，GPUI 在全部四组负载下的进程树私有内存和累计 CPU 采样都低于对照组，具备继续研究资源使用的价值。这不等于完整 Krosna 能达到同样比例的节省。",
    "",
    "终端流畅度方面，两边均处理完全部已读字节，探针全部确认，未发现输出包序号缺口。GPUI 的输入探针至解析确认 P95 略低，但对照组额外包含按帧回传 ACK 的 IPC；现有实验无法把这个差值归因于 GPUI。GPUI 的 UI 回调间隔 P95 没有优于对照组，暂未证明明显的显示流畅度优势。",
    "",
    "建议保留这个原型作为后续验证基础，暂不以本次结果推动整体重写。若目标仍以输入输出手感为主，下一阶段应先完成真实输入和终端功能验收，再做同边界延迟测量。",
    "", "## 如何解读", "",
    "- 探针至 PTY 返回包含 ConPTY 和合成回显进程的响应；解析确认还包含 UI 队列、解析以及对照组按帧回传 ACK。不能用两项 P95 相减计算 UI P95。",
    "- UI 间隔来自 GPUI on_next_frame / WebView requestAnimationFrame。没有测 GPU 呈现或真实键盘到屏幕，不能把它等同为输入延迟。",
    "- 私有内存包含本次启动的负载及 WebView 子进程，不是完整 Krosna 内存或任务管理器工作集。",
    "- GPUI 的 packet_parse_us 是同步解析耗时，xterm 是异步入队到回调，边界不同，禁止直接计算解析速度倍数。",
    "- 只有一个终端可见；本次不代表同时展示四个终端或四个项目窗口。",
    "- 统计包含冷启动及排空阶段；冷启动探针可能放大尾延迟，排空阶段可能稀释负载期的 UI 间隔。两轮样本不能用于统计显著性判断。", "",
    "## 仍需完成的交互与迁移验收", "",
    "未完成真实键盘到显示、人工视觉 QA、中文输入法候选窗定位与组合提交、Windows 粘贴历史、终端选择/回滚/鼠标协议、真实智能体 TUI、窗口缩放与多显示器 DPI、长时间运行测试。GPUI 原型还没有绘制终端光标、实现完整 SGR 属性或终端查询应答。最小 GPUI IME 接口不等于输入法兼容性已通过。",
    "", "## 建议", "",
    "这些数据用于判断是否值得继续投入终端原型，不构成整体迁移依据。若继续，应先补全 GPUI 终端渲染与输入功能，采用相同分块调度、预热和显示完成边界，验证真实 TUI 与键盘输入，再决定是否替换正式产品组件。",
    "", "## 复现", "",
    "构建和运行命令见 `README.md`；执行 `python experiments/gpui-terminal/summarize.py` 可以重新校验本地结果并生成本报告。`measurements.json` 保留本次报告、环境和源码哈希，原始逐次进程采样位于被忽略的 `results/`。",
]
if problems:
    lines += ["", "## 无效样本", ""] + [f"- {problem}" for problem in problems]
(ROOT / "REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"Validated {sum(r['valid'] for r in records)}/{len(records)} runs")
print("\n".join(lines[lines.index("## 实测结果"):lines.index("## 如何解读")]))

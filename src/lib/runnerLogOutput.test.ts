import { afterEach, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import { createRunnerLogOutput } from "./runnerLogOutput";
import { createTerminalOutputAcknowledgements } from "./terminalOutputAcknowledgements";
import { stripAnsiEscapeSequences } from "./textContent";

afterEach(() => vi.useRealTimers());

it("can toggle fallback highlighting live without changing source ANSI or dropping partial output", () => {
  let enabled = false;
  const chunks: string[] = [];
  const log = createRunnerLogOutput((data) => chunks.push(data), () => enabled);
  log.write("ERROR plain\n\x1b[32mINFO source color\x1b[0m\n");
  expect(chunks.join("")).toBe("ERROR plain\n\x1b[32mINFO source color\x1b[0m\n");
  log.write("WARN split");
  enabled = true;
  log.write(" line\n");
  expect(chunks.at(-1)).toBe("\x1b[33mWARN split line\x1b[39m\n");
  enabled = false;
  log.write("ERROR normal again\n");
  expect(chunks.at(-1)).toBe("ERROR normal again\n");
  log.dispose();
});

it.each([
  ["11-Nov-2026 18:40:02.270 严重 [main] org.apache.catalina 启动失败", 31],
  ["11-Nov-2026 18:40:02.373 警告 [main] Web 应用线程未停止", 33],
  ["11-Nov-2026 18:40:02.397 信息 [main] 服务器启动", 34],
  ["2026-11-11 18:40:02.000 ERROR [main] Startup failed", 31],
  ["2026-11-11T18:40:02.000+08:00 WARN Startup warning", 33],
  ["[INFO] Starting server", 34],
  ["[worker] [DEBUG] details", 36],
  ["WARNING: build warning", 33],
  ["Caused by: org.springframework.beans.factory.BeanNotOfRequiredTypeException: wrong bean type", 31],
  ["java.lang.IllegalStateException: failed", 31],
])("adds theme palette color to %s", (line, color) => {
  const output = vi.fn();
  const log = createRunnerLogOutput(output);
  log.write(line + "\r\n");
  expect(output).toHaveBeenCalledWith(`\x1b[${color}m${line}\x1b[39m\r\n`);
  log.dispose();
});

it("handles every possible split of a log level without altering copied text", () => {
  const line = "11-Nov-2026 18:40:02.270 严重 [main] 启动失败\r\n";
  for (let split = 1; split < line.length; split++) {
    const chunks: string[] = [];
    const log = createRunnerLogOutput((data) => chunks.push(data));
    log.write(line.slice(0, split));
    log.write(line.slice(split));
    expect(chunks.join("")).toContain("\x1b[31m");
    expect(stripAnsiEscapeSequences(chunks.join(""))).toBe(line);
    log.dispose();
  }
});

it("leaves ordinary messages and stack frames unchanged", () => {
  const line = "No error was found\r\n    at org.example.Main.run(Main.java:10)\r\n";
  const output = vi.fn();
  const log = createRunnerLogOutput(output);
  log.write(line);
  expect(output).toHaveBeenCalledExactlyOnceWith(line);
  log.dispose();
});

it.each([
  "\x1b[32mINFO already colored\nERROR still green\n\x1b[0m\n",
  "\x1b]0;title\nERROR inside title\x07\n",
  "\x1bPpayload\nERROR inside DCS\x1b\\\n",
  "\x1b[?1049h\nERROR inside TUI\n\x1b[?1049l\n",
  "\x9dtitle\nERROR inside title\x9c\n",
  "progress 10%\rERROR replacement\n",
])("preserves styled/control output even when streamed one character at a time", (source) => {
  const chunks: string[] = [];
  const log = createRunnerLogOutput((data) => chunks.push(data));
  for (const char of source) log.write(char);
  log.flush();
  expect(chunks.join("")).toBe(source);
  log.write("ERROR plain log\n");
  expect(chunks.at(-1)).toBe("\x1b[31mERROR plain log\x1b[39m\n");
  log.dispose();
});

it("shows prompts within a bounded delay and does not misclassify their continuation", async () => {
  vi.useFakeTimers();
  const output = vi.fn();
  const log = createRunnerLogOutput(output);
  log.write("PS C:\\project> ");
  await vi.advanceTimersByTimeAsync(32);
  expect(output).toHaveBeenLastCalledWith("PS C:\\project> ");
  expect(log.getBufferedChars()).toBe(0);
  log.write("ERROR is a user command\nINFO next line\n");
  expect(output).toHaveBeenLastCalledWith("ERROR is a user command\n\x1b[34mINFO next line\x1b[39m\n");
  log.dispose();
});

it("bounds long line buffering and cancels delayed writes on disposal", async () => {
  vi.useFakeTimers();
  const chunks: string[] = [];
  const log = createRunnerLogOutput((data) => chunks.push(data));
  const source = "ERROR " + "x".repeat(100_000);
  log.write(source);
  expect(log.getBufferedChars()).toBeLessThan(16 * 1024);
  log.flush();
  expect(chunks.join("")).toBe(source);
  log.write("discarded");
  const count = chunks.length;
  log.dispose();
  await vi.runAllTimersAsync();
  expect(chunks).toHaveLength(count);
});

it("keeps transport credits until buffered partial output is parsed", async () => {
  vi.useFakeTimers();
  const parsed: Array<() => void> = [];
  const output = vi.fn();
  const acknowledgements = createTerminalOutputAcknowledgements({
    buffered: () => log.getBufferedChars() > 0,
    afterParsed: (done) => parsed.push(done),
  });
  const log = createRunnerLogOutput((data) => { output(data); acknowledgements.schedule(); });
  try {
    const done = vi.fn();
    const pending = acknowledgements.track(() => log.write("prompt> ")).then(done);
    await Promise.resolve();
    expect(parsed).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(32);
    expect(output).toHaveBeenCalledWith("prompt> ");
    expect(done).not.toHaveBeenCalled();
    parsed[0]();
    await pending;
    expect(done).toHaveBeenCalledOnce();
  } finally { log.dispose(); acknowledgements.dispose(); }
});

it("renders the original log text in xterm with level colors and a default-color reset", async () => {
  const terminal = new Terminal({ cols: 120, rows: 10, allowProposedApi: true });
  const log = createRunnerLogOutput((data) => terminal.write(data));
  try {
    const source = "严重 [main] 启动失败\r\nWARNING: thread leak\r\nINFO server started\r\n";
    log.write(source);
    await new Promise<void>((resolve) => terminal.write("", resolve));
    expect(terminal.buffer.active.getLine(0)?.getCell(0)?.getFgColor()).toBe(1);
    expect(terminal.buffer.active.getLine(1)?.getCell(0)?.getFgColor()).toBe(3);
    expect(terminal.buffer.active.getLine(2)?.getCell(0)?.getFgColor()).toBe(4);
    expect(terminal.buffer.active.getLine(3)?.getCell(0)?.getFgColor()).toBe(-1);
    expect([0, 1, 2].map((row) => terminal.buffer.active.getLine(row)?.translateToString(true)).join("\r\n") + "\r\n").toBe(source);
  } finally { log.dispose(); terminal.dispose(); }
});

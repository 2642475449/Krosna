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

it.each([
  ["==>  Preparing:", " SELECT id FROM example WHERE id = ?", 34],
  ["==> Parameters:", " synthetic-id(String)", 36],
  ["<==    Columns:", " ID, NAME, STATUS", 36],
  ["<==        Row:", " 1, 中文记录, ERROR is data", 32],
  ["<==      Total:", " 13", 32],
  ["<==    Updates:", " 1", 32],
  ["====> Preparing:", " SELECT nested_value FROM example", 34],
  ["\t<==== Total:", " 1", 32],
])("colors the MyBatis marker %s while leaving its payload in the default color", (marker, payload, color) => {
  const chunks: string[] = [];
  const log = createRunnerLogOutput((data) => chunks.push(data));
  log.write(marker + payload + "\r\n");
  expect(chunks.join("")).toBe(`\x1b[${color}m${marker}\x1b[39m${payload}\r\n`);
  expect(stripAnsiEscapeSequences(chunks.join(""))).toBe(marker + payload + "\r\n");
  log.dispose();
});

it.each([
  "Creating a new SqlSession",
  "Closing non transactional SqlSession [synthetic-session]",
  "SqlSession [synthetic-session] was not registered for synchronization because synchronization is not active",
  "JDBC Connection [synthetic-connection] will not be managed by Spring",
  "Registering transaction synchronization for SqlSession [synthetic-session]",
  "Releasing transactional SqlSession [synthetic-session]",
  "Transaction synchronization committing SqlSession [synthetic-session]",
  "Transaction synchronization deregistering SqlSession [synthetic-session]",
  "Transaction synchronization closing SqlSession [synthetic-session]",
  "Closing transactional SqlSession [synthetic-session]",
  "Fetched SqlSession [synthetic-session] from current transaction",
])("de-emphasizes the MyBatis session lifecycle message %s", (line) => {
  const output = vi.fn();
  const log = createRunnerLogOutput(output);
  log.write(line + "\n");
  expect(output).toHaveBeenCalledExactlyOnceWith(`\x1b[90m${line}\x1b[39m\n`);
  log.dispose();
});

it("recognizes streamed MyBatis markers at any split and never highlights ordinary SQL content", () => {
  const source = "==>  Preparing: SELECT synthetic_value FROM example\r\n<==      Total: 1\r\n";
  for (let split = 1; split < source.length; split += 1) {
    const chunks: string[] = [];
    const log = createRunnerLogOutput((data) => chunks.push(data));
    log.write(source.slice(0, split));
    log.write(source.slice(split));
    expect(chunks.join("")).toContain("\x1b[34m==>  Preparing:\x1b[39m");
    expect(stripAnsiEscapeSequences(chunks.join(""))).toBe(source);
    log.dispose();
  }
  const output = vi.fn();
  const log = createRunnerLogOutput(output);
  const ordinary = "SELECT id FROM example\nMessage says ==> Preparing: nothing to run\nRow: unrelated data\n";
  log.write(ordinary);
  expect(output).toHaveBeenCalledExactlyOnceWith(ordinary);
  log.dispose();
});

it("preserves native MyBatis colors, control output and the live highlight toggle", () => {
  let enabled = false;
  const chunks: string[] = [];
  const log = createRunnerLogOutput((data) => chunks.push(data), () => enabled);
  const plain = "==> Preparing: SELECT 1\nCreating a new SqlSession\n";
  log.write(plain);
  expect(chunks.join("")).toBe(plain);
  enabled = true;
  chunks.length = 0;
  const native = "\x1b[35m==> Preparing: SELECT 1\x1b[0m\n\x1b[?1049h\n<== Total: 1\n\x1b[?1049l\n";
  for (const char of native) log.write(char);
  log.flush();
  expect(chunks.join("")).toBe(native);
  log.dispose();
});

it.each(["0;39", "0;39;49", "31;0", "39"])("resumes fallback colors after a Java-style SGR %s reset", (reset) => {
  const chunks: string[] = [];
  const log = createRunnerLogOutput((data) => chunks.push(data));
  const native = `\x1b[32mSpring startup\x1b[${reset}m\r\n`;
  log.write(native + "==> Preparing: SELECT 1\r\n");
  expect(chunks.join("")).toBe(native + "\x1b[34m==> Preparing:\x1b[39m SELECT 1\r\n");
  log.dispose();
});

it("keeps remaining native attributes after a foreground reset and resumes after all styles reset", () => {
  const chunks: string[] = [];
  const log = createRunnerLogOutput((data) => chunks.push(data));
  const native = "\x1b[1;3;44;31mstartup\x1b[39m\n==> Preparing: still styled\n\x1b[22;23m\n<== Total: still blue background\n\x1b[49m\n";
  for (const char of native) log.write(char);
  expect(chunks.join("")).toBe(native);
  log.write("==> Preparing: SELECT 1\n");
  expect(chunks.at(-1)).toBe("\x1b[34m==> Preparing:\x1b[39m SELECT 1\n");
  log.dispose();
});

it("tracks colon-form RGB styles until the matching default foreground reset", () => {
  const chunks: string[] = [];
  const log = createRunnerLogOutput((data) => chunks.push(data));
  const native = "\x1b[38:2::0:0:0mstartup\n==> Preparing: native black\n\x1b[39m\n";
  for (const char of native) log.write(char);
  expect(chunks.join("")).toBe(native);
  log.write("<== Total: 1\n");
  expect(chunks.at(-1)).toBe("\x1b[32m<== Total:\x1b[39m 1\n");
  log.dispose();
});

it.each(["38;2;0;0;0", "48;2;0;128;0", "38;5;0", "58;2;0;0;0", "0;31"])("does not mistake SGR %s native styling for a reset", (style) => {
  const chunks: string[] = [];
  const log = createRunnerLogOutput((data) => chunks.push(data));
  const native = `\x1b[${style}mSpring startup\r\n==> Preparing: SELECT 1\r\n\x1b[0;39m\r\n`;
  for (const char of native) log.write(char);
  expect(chunks.join("")).toBe(native);
  log.write("<== Total: 1\r\n");
  expect(chunks.at(-1)).toBe("\x1b[32m<== Total:\x1b[39m 1\r\n");
  log.dispose();
});

it("renders MyBatis protocol colors in xterm and resets the color before result data", async () => {
  const terminal = new Terminal({ cols: 160, rows: 10, allowProposedApi: true });
  const log = createRunnerLogOutput((data) => terminal.write(data));
  try {
    const lines = ["==> Preparing: SELECT id FROM example", "==> Parameters: 1(Integer)", "<== Row: 1, 中文记录", "<== Total: 1", "Creating a new SqlSession"];
    log.write(lines.join("\r\n") + "\r\n");
    await new Promise<void>((resolve) => terminal.write("", resolve));
    for (const [row, color] of [4, 6, 2, 2, 8].entries()) {
      const line = terminal.buffer.active.getLine(row)!;
      expect(line.getCell(0)?.getFgColor()).toBe(color);
      expect(line.translateToString(true)).toBe(lines[row]);
      if (row < 4) expect(line.getCell(lines[row].indexOf(":") + 1)?.getFgColor()).toBe(-1);
    }
    expect(terminal.buffer.active.getLine(5)?.getCell(0)?.getFgColor()).toBe(-1);
  } finally { log.dispose(); terminal.dispose(); }
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

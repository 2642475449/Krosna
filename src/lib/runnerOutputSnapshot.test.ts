import { afterEach, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import { SerializeAddon } from "@xterm/addon-serialize";
import { captureRunnerOutputSnapshot, restoreRunnerOutputSnapshot, type RunnerOutputSnapshot } from "./runnerOutputSnapshot";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function write(term: Terminal, value: string): Promise<void> {
  return new Promise((resolve) => term.write(value, resolve));
}

function fakeTerminal() {
  const writes: string[] = [];
  const callbacks: Array<() => void> = [];
  const resize = vi.fn();
  const reset = vi.fn();
  const scrollToLine = vi.fn();
  const select = vi.fn();
  const write = vi.fn((value: string, callback: () => void) => { writes.push(value); callbacks.push(callback); });
  // 仅模拟本工具使用的公开 API，真实解析和序列化由下方真实 xterm 覆盖。
  const term = { resize, reset, scrollToLine, select, write, options: { scrollback: 100 } } as unknown as Terminal;
  return { term, writes, callbacks, resize, reset, scrollToLine, select, write };
}

function snapshot(data = "output"): RunnerOutputSnapshot {
  return { version: 1, data, cols: 20, rows: 5, viewportY: 0, selection: null };
}

function lines(term: Terminal, buffer = term.buffer.active): string[] {
  return Array.from({ length: buffer.length }, (_, index) => buffer.getLine(index)?.translateToString(true) ?? "");
}

it("round trips real xterm scrollback, wrapped wide text, colors and cursor", async () => {
  const source = new Terminal({ cols: 20, rows: 5, scrollback: 100, allowProposedApi: true });
  const target = new Terminal({ cols: 80, rows: 24, scrollback: 100, allowProposedApi: true });
  try {
    await write(source, "\x1b[1;38;2;12;34;56;48;5;22m中文🙂e\u0301\x1b[0m\r\n" + "long 中文 line ".repeat(7)
      + "\r\nlast 1\r\nlast 2\r\nlast 3\r\nEND");
    source.scrollToLine(1);
    const saved = captureRunnerOutputSnapshot(source);
    await write(target, "OLD CONTENT");
    await restoreRunnerOutputSnapshot(target, saved);
    expect([target.cols, target.rows]).toEqual([20, 5]);
    expect(lines(target)).toEqual(lines(source));
    expect(target.buffer.active.viewportY).toBe(source.buffer.active.viewportY);
    expect([target.buffer.active.cursorX, target.buffer.active.cursorY]).toEqual([source.buffer.active.cursorX, source.buffer.active.cursorY]);
    const sourceCell = source.buffer.normal.getLine(0)?.getCell(0);
    const targetCell = target.buffer.normal.getLine(0)?.getCell(0);
    expect(targetCell?.getChars()).toBe("中");
    expect(targetCell?.getWidth()).toBe(2);
    expect(targetCell?.getFgColor()).toBe(sourceCell?.getFgColor());
    expect(targetCell?.getBgColor()).toBe(sourceCell?.getBgColor());
    expect(targetCell?.isBold()).toBe(sourceCell?.isBold());
  } finally { source.dispose(); target.dispose(); }
});

it("preserves both main and active alternate buffers without restoring input modes", async () => {
  const source = new Terminal({ cols: 20, rows: 5, scrollback: 100, allowProposedApi: true });
  const target = new Terminal({ cols: 20, rows: 5, scrollback: 100, allowProposedApi: true });
  try {
    await write(source, "MAIN 中文\r\nMAIN END\x1b[?1049h\x1b[?2004h\x1b[31mALT 中文🙂\x1b[0m\r\nALT END");
    const saved = captureRunnerOutputSnapshot(source);
    await restoreRunnerOutputSnapshot(target, saved);
    expect(target.buffer.active.type).toBe("alternate");
    expect(lines(target, target.buffer.normal)).toEqual(lines(source, source.buffer.normal));
    expect(lines(target, target.buffer.alternate)).toEqual(lines(source, source.buffer.alternate));
    expect(target.modes.bracketedPasteMode).toBe(false);
    await write(target, "\x1b[?1049l");
    expect(lines(target)).toContain("MAIN 中文");
  } finally { source.dispose(); target.dispose(); }
});

it("retains archived history when the user has reduced the current scrollback setting", async () => {
  const source = new Terminal({ cols: 20, rows: 5, scrollback: 50_000, allowProposedApi: true });
  const target = new Terminal({ cols: 20, rows: 5, scrollback: 5_000, allowProposedApi: true });
  try {
    await write(source, Array.from({ length: 5_012 }, (_, index) => `line ${index}`).join("\r\n"));
    const saved = captureRunnerOutputSnapshot(source);
    expect(saved.scrollback).toBe(50_000);
    expect(source.buffer.normal.length).toBeGreaterThan(5_005);
    await restoreRunnerOutputSnapshot(target, saved);
    expect(target.options.scrollback).toBe(50_000);
    expect(lines(target)).toEqual(lines(source));
    expect(lines(target)[0]).toBe("line 0");
  } finally { source.dispose(); target.dispose(); }
});

it("captures selection through the public API and always disposes its temporary addon", async () => {
  const term = new Terminal({ cols: 20, rows: 5, allowProposedApi: true });
  const dispose = vi.spyOn(SerializeAddon.prototype, "dispose");
  try {
    await write(term, "selected text");
    vi.spyOn(term, "getSelectionPosition").mockReturnValue({ start: { x: 2, y: 0 }, end: { x: 8, y: 1 } });
    expect(captureRunnerOutputSnapshot(term).selection).toEqual({ startColumn: 2, startRow: 0, endColumn: 8, endRow: 1 });
    expect(dispose).toHaveBeenCalledOnce();
    vi.spyOn(SerializeAddon.prototype, "serialize").mockImplementation(() => { throw new Error("serialize failed"); });
    expect(() => captureRunnerOutputSnapshot(term)).toThrow("serialize failed");
    expect(dispose).toHaveBeenCalledTimes(2);
  } finally { term.dispose(); }
});

it("writes one bounded chunk at a time without splitting surrogate pairs and restores view last", async () => {
  const fake = fakeTerminal();
  const data = "x".repeat(65535) + "🙂中文";
  const saved = { ...snapshot(data), viewportY: 7, selection: { startColumn: 2, startRow: 7, endColumn: 4, endRow: 9 } };
  const restore = restoreRunnerOutputSnapshot(fake.term, saved);
  expect(fake.resize).toHaveBeenCalledWith(20, 5);
  expect(fake.reset).toHaveBeenCalledOnce();
  expect(fake.writes).toEqual(["x".repeat(65535)]);
  expect(fake.scrollToLine).not.toHaveBeenCalled();
  fake.callbacks[0]();
  await Promise.resolve();
  expect(fake.writes).toEqual(["x".repeat(65535), "🙂中文"]);
  fake.callbacks[1]();
  await restore;
  expect(fake.writes.join("")).toBe(data);
  expect(fake.writes.every((chunk) => chunk.length <= 65536)).toBe(true);
  expect(fake.scrollToLine).toHaveBeenCalledWith(7);
  expect(fake.select).toHaveBeenCalledWith(2, 7, 42);
});

it.each([
  { version: 2 }, { data: 1 }, { cols: 1 }, { cols: 4097 }, { rows: 0 }, { rows: 1.5 },
  { cols: 4096, rows: 4096 }, { viewportY: -1 }, { viewportY: Number.NaN },
  { scrollback: -1 }, { scrollback: 50_001 }, { scrollback: 1.5 },
  { selection: { startColumn: 20, startRow: 0, endColumn: 0, endRow: 1 } },
  { selection: { startColumn: 2, startRow: 3, endColumn: 1, endRow: 3 } },
])("rejects invalid snapshot %j before changing the terminal", async (patch) => {
  const fake = fakeTerminal();
  const invalid = { ...snapshot(), ...patch } as RunnerOutputSnapshot;
  await expect(restoreRunnerOutputSnapshot(fake.term, invalid)).rejects.toThrow("Invalid runner output snapshot");
  expect(fake.resize).not.toHaveBeenCalled();
  expect(fake.reset).not.toHaveBeenCalled();
  expect(fake.write).not.toHaveBeenCalled();
});

it("counts JSON escaping and UTF-8 bytes toward the 32 MiB budget before changing terminal", async () => {
  const fake = fakeTerminal();
  const jsonOversized = snapshot("\u0001".repeat(Math.ceil(32 * 1024 * 1024 / 6)));
  await expect(restoreRunnerOutputSnapshot(fake.term, jsonOversized)).rejects.toThrow("exceeds 32 MiB");
  const utf8Oversized = snapshot("中".repeat(Math.ceil(32 * 1024 * 1024 / 3)));
  await expect(restoreRunnerOutputSnapshot(fake.term, utf8Oversized)).rejects.toThrow("exceeds 32 MiB");
  expect(fake.resize).not.toHaveBeenCalled();
  expect(fake.reset).not.toHaveBeenCalled();
});

it("rejects synchronous parser submission failures", async () => {
  const fake = fakeTerminal();
  fake.write.mockImplementation(() => { throw new Error("write failed"); });
  await expect(restoreRunnerOutputSnapshot(fake.term, snapshot())).rejects.toThrow("write failed");
  expect(fake.scrollToLine).not.toHaveBeenCalled();
});

it("cancels a missing write callback on abort and ignores late callbacks", async () => {
  const fake = fakeTerminal();
  const controller = new AbortController();
  const restore = restoreRunnerOutputSnapshot(fake.term, snapshot("x".repeat(65537)), { signal: controller.signal });
  const rejected = expect(restore).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejected;
  fake.callbacks[0]();
  await Promise.resolve();
  expect(fake.write).toHaveBeenCalledOnce();
  expect(fake.scrollToLine).not.toHaveBeenCalled();
});

it("rejects an already aborted operation before reset", async () => {
  const fake = fakeTerminal();
  const controller = new AbortController();
  controller.abort();
  await expect(restoreRunnerOutputSnapshot(fake.term, snapshot(), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(fake.resize).not.toHaveBeenCalled();
  expect(fake.reset).not.toHaveBeenCalled();
});

it("notices disposal even when the parser never invokes its completion callback", async () => {
  vi.useFakeTimers();
  const fake = fakeTerminal();
  let disposed = false;
  const restore = restoreRunnerOutputSnapshot(fake.term, snapshot(), { isDisposed: () => disposed });
  const rejected = expect(restore).rejects.toMatchObject({ name: "AbortError" });
  disposed = true;
  await vi.advanceTimersByTimeAsync(25);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
  expect(fake.scrollToLine).not.toHaveBeenCalled();
});

it("restores an empty snapshot without queuing a parser write", async () => {
  const fake = fakeTerminal();
  await restoreRunnerOutputSnapshot(fake.term, snapshot(""));
  expect(fake.reset).toHaveBeenCalledOnce();
  expect(fake.write).not.toHaveBeenCalled();
  expect(fake.scrollToLine).toHaveBeenCalledWith(0);
});

import { expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import { createTerminalOutputAcknowledgements } from "./terminalOutputAcknowledgements";
import { createTerminalOutputFrameGate } from "./terminalOutputFrames";
import { createTerminalImeOutputGate } from "./terminalImeOutput";

it("keeps credits through frame and IME buffering until the real parser completes", async () => {
  vi.useFakeTimers();
  const parsed: Array<() => void> = [];
  const writes: string[] = [];
  const acknowledgements = createTerminalOutputAcknowledgements({
    buffered: () => frame.getPendingWriteChars() + ime.getBufferedChars() > 0,
    afterParsed: (done) => parsed.push(done),
  });
  const ime = createTerminalImeOutputGate((text) => {
    writes.push(text); acknowledgements.schedule();
  }, (callback) => Number(setTimeout(callback, 0)), clearTimeout);
  const frame = createTerminalOutputFrameGate((text) => ime.write(text), { enabled: true });
  const completed = vi.fn();
  try {
    ime.compositionStart();
    const first = acknowledgements.track(() => frame.write("\x1b[?2026h中文"));
    void first.then(completed);
    await Promise.resolve();
    expect(parsed).toHaveLength(0);
    const second = acknowledgements.track(() => frame.write("\x1b[?2026l"));
    await Promise.resolve();
    expect(parsed).toHaveLength(0);
    ime.compositionEnd();
    await vi.advanceTimersByTimeAsync(1);
    expect(writes.join("")).toBe("\x1b[?2026h中文\x1b[?2026l");
    expect(completed).not.toHaveBeenCalled();
    parsed[0]();
    await Promise.all([first, second]);
    expect(completed).toHaveBeenCalledOnce();
  } finally {
    frame.dispose(); ime.dispose(); acknowledgements.dispose(); vi.useRealTimers();
  }
});

it("unmount releases both buffered and pending parser acknowledgements", async () => {
  let buffered = false;
  const callbacks: Array<() => void> = [];
  const acknowledgements = createTerminalOutputAcknowledgements({ buffered: () => buffered, afterParsed: (done) => callbacks.push(done) });
  const parsing = acknowledgements.track(() => {});
  await Promise.resolve();
  buffered = true;
  const waiting = acknowledgements.track(() => {});
  acknowledgements.dispose();
  await Promise.all([parsing, waiting]);
  callbacks[0]();
  expect(callbacks).toHaveLength(1);
});

it("does not deadlock when every transport chunk ends in an incomplete control sequence", async () => {
  const writes: string[] = [];
  const acknowledgements = createTerminalOutputAcknowledgements({
    buffered: () => frame.getPendingWriteChars() > 0,
    afterParsed: (done) => queueMicrotask(done),
  });
  const frame = createTerminalOutputFrameGate((text) => writes.push(text), { enabled: true });
  try {
    await acknowledgements.track(() => frame.write("\x1b["));
    // 即使 CSI 超过整个 256 KiB 传输窗口，也能继续读取并按扫描器上限转交 xterm。
    for (let i = 0; i < 8; i++) {
      await acknowledgements.track(() => frame.write("1".repeat(65536)));
      expect(frame.getBufferedChars()).toBeLessThan(256 * 1024);
    }
    await acknowledgements.track(() => frame.write("mEND"));
    expect(writes.join("")).toBe("\x1b[" + "1".repeat(8 * 65536) + "mEND");
  } finally { frame.dispose(); acknowledgements.dispose(); }
});

it("a parser barrier cannot acknowledge writes submitted after that barrier", async () => {
  const callbacks: Array<() => void> = [];
  const acknowledgements = createTerminalOutputAcknowledgements({ buffered: () => false, afterParsed: (done) => callbacks.push(done) });
  const first = acknowledgements.track(() => {});
  await Promise.resolve();
  const done = vi.fn();
  const second = acknowledgements.track(() => {}).then(done);
  await Promise.resolve();
  callbacks[0]();
  await first;
  expect(done).not.toHaveBeenCalled();
  callbacks[1]();
  await second;
  expect(done).toHaveBeenCalledOnce();
  acknowledgements.dispose();
});

it("streams over 50 MB through a credit window without parser overflow or missing output", async () => {
  const terminal = new Terminal({ cols: 80, rows: 24, scrollback: 50 });
  const acknowledgements = createTerminalOutputAcknowledgements({ buffered: () => false, afterParsed: (done) => terminal.write("", done) });
  let completed = 0;
  const chunk = "x".repeat(65534) + "\r\n";
  try {
    for (let batch = 0; batch < 224; batch++) {
      await Promise.all(Array.from({ length: 4 }, () => acknowledgements.track(() => terminal.write(chunk)).then(() => { completed++; })));
    }
    await acknowledgements.track(() => terminal.write("MEMORY-REVIEW-END"));
    expect(completed * chunk.length).toBe(58_720_256);
    expect(terminal.buffer.active.getLine(terminal.buffer.active.baseY + terminal.buffer.active.cursorY)?.translateToString(true)).toBe("MEMORY-REVIEW-END");
  } finally { acknowledgements.dispose(); terminal.dispose(); }
}, 30_000);

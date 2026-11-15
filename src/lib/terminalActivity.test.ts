import { describe, expect, it, vi } from "vitest";
import { createTerminalActivityTracker } from "./terminalActivity";

describe("acknowledged terminal conversation submissions", () => {
  it("counts a nonempty message only after its Enter was successfully written", () => {
    const submitted = vi.fn();
    const tracker = createTerminalActivityTracker(submitted);
    tracker.written("你好");
    expect(submitted).not.toHaveBeenCalled();
    tracker.written("\r");
    expect(submitted).toHaveBeenCalledTimes(1);
    tracker.written("\r");
    expect(submitted).toHaveBeenCalledTimes(1);
  });

  it.each(["\x1b[A", "\x1b[B", "\x1b[I", "\x1b[O", "\x1b]7501;?\x1b\\"])(
    "does not count navigation or protocol input %j", (data) => {
      const submitted = vi.fn();
      const tracker = createTerminalActivityTracker(submitted);
      tracker.written(data);
      tracker.written("\r");
      expect(submitted).not.toHaveBeenCalled();
    },
  );

  it("requires a separate Enter after a multiline paste, including a trailing newline", () => {
    const submitted = vi.fn();
    const tracker = createTerminalActivityTracker(submitted);
    tracker.written("\x1b[200~first\rsecond\r\x1b[201~", true);
    expect(submitted).not.toHaveBeenCalled();
    tracker.written("\r");
    expect(submitted).toHaveBeenCalledTimes(1);
  });

  it("recognizes voice and file-reference insertions without counting the insertion", () => {
    const submitted = vi.fn();
    const tracker = createTerminalActivityTracker(submitted);
    tracker.written('"D:/project/file.ts"', true);
    expect(submitted).not.toHaveBeenCalled();
    tracker.written("\r");
    expect(submitted).toHaveBeenCalledTimes(1);
  });

  it("does not count a rejected message or Enter write, and allows a later retry", async () => {
    const submitted = vi.fn();
    const tracker = createTerminalActivityTracker(submitted);
    const rejected = () => Promise.reject(new Error("queue full"));
    await expect(tracker.write("message", rejected)).rejects.toThrow("queue full");
    tracker.written("\r");
    expect(submitted).not.toHaveBeenCalled();
    await tracker.write("retry", () => Promise.resolve());
    await expect(tracker.write("\r", rejected)).rejects.toThrow("queue full");
    expect(submitted).not.toHaveBeenCalled();
    await tracker.write("\r", () => Promise.resolve());
    expect(submitted).toHaveBeenCalledTimes(1);
  });

  it.each(["\x03", "\x15", "\u007f\u007f\u007f\u007f\u007f"])(
    "does not submit a discarded draft %j", (discard) => {
      const submitted = vi.fn();
      const tracker = createTerminalActivityTracker(submitted);
      tracker.written("draft");
      tracker.written(discard);
      tracker.written("\r");
      expect(submitted).not.toHaveBeenCalled();
    },
  );

  it("ignores late acknowledgements after the terminal is disposed", () => {
    const submitted = vi.fn();
    const tracker = createTerminalActivityTracker(submitted);
    tracker.written("draft");
    tracker.dispose();
    tracker.written("\r");
    expect(submitted).not.toHaveBeenCalled();
  });

  it("preserves already written text when a later character is rejected", async () => {
    const submitted = vi.fn();
    const tracker = createTerminalActivityTracker(submitted);
    tracker.written("message");
    await expect(tracker.write("!", () => Promise.reject(new Error("queue full"))))
      .rejects.toThrow("queue full");
    expect(submitted).not.toHaveBeenCalled();
    tracker.written("\r");
    expect(submitted).toHaveBeenCalledTimes(1);
  });

  it("waits for the write acknowledgement and ignores it after disposal", async () => {
    const submitted = vi.fn();
    const tracker = createTerminalActivityTracker(submitted);
    tracker.written("message");
    let acknowledge!: () => void;
    const pending = tracker.write("\r", () => new Promise<void>((resolve) => { acknowledge = resolve; }));
    expect(submitted).not.toHaveBeenCalled();
    tracker.dispose();
    acknowledge();
    await pending;
    expect(submitted).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { createTerminalImeOutputGate, MAX_TERMINAL_IME_BUFFERED_CHARS, MAX_TERMINAL_IME_HOLD_MS } from "./terminalImeOutput";

afterEach(() => vi.useRealTimers());

describe("terminal IME output gate", () => {
  it("holds PTY output until after xterm can commit an IME composition", () => {
    const write = vi.fn();
    const scheduled: Array<() => void> = [];
    const gate = createTerminalImeOutputGate(
      write,
      (callback) => {
        scheduled.push(callback);
        return scheduled.length;
      },
      () => {},
    );

    gate.compositionStart();
    gate.write("background output");
    gate.compositionEnd();

    expect(write).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    scheduled[0]();
    expect(write).toHaveBeenCalledWith("background output");
  });

  it("also holds output that arrives during composition settlement", () => {
    const write = vi.fn();
    const scheduled: Array<() => void> = [];
    const gate = createTerminalImeOutputGate(write, (callback) => {
      scheduled.push(callback);
      return scheduled.length;
    }, () => {});

    gate.compositionStart();
    gate.compositionEnd();
    gate.write("reply");
    scheduled[0]();

    expect(write).toHaveBeenCalledWith("reply");
  });

  it("flushes in order at the character budget and bypasses the rest of that composition", () => {
    vi.useFakeTimers();
    const output: string[] = [];
    const gate = createTerminalImeOutputGate((data) => output.push(data),
      (callback) => Number(setTimeout(callback, 0)), (handle) => clearTimeout(handle));
    gate.compositionStart();
    const chunk = "x".repeat(64 * 1024);
    for (let index = 0; index < 128; index++) {
      gate.write(chunk);
      expect(gate.getBufferedChars()).toBeLessThan(MAX_TERMINAL_IME_BUFFERED_CHARS);
    }
    expect(output.join("")).toBe(chunk.repeat(128));
    expect(gate.getBufferedChars()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    gate.compositionEnd();
    gate.write("settling reply");
    expect(output.join("")).not.toContain("settling reply");
    vi.advanceTimersByTime(0);
    expect(output[output.length - 1]).toBe("settling reply");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("limits the hold time if compositionend never arrives and protects the next composition", () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const gate = createTerminalImeOutputGate(write,
      (callback) => Number(setTimeout(callback, 0)), (handle) => clearTimeout(handle));
    gate.compositionStart();
    gate.write("first");
    vi.advanceTimersByTime(MAX_TERMINAL_IME_HOLD_MS - 1);
    expect(write).not.toHaveBeenCalled();
    gate.write("second");
    vi.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledExactlyOnceWith("firstsecond");
    gate.write("third");
    expect(write).toHaveBeenLastCalledWith("third");
    expect(gate.getBufferedChars()).toBe(0);

    gate.compositionEnd();
    vi.advanceTimersByTime(0);
    gate.compositionStart();
    gate.write("next composition");
    expect(write).not.toHaveBeenCalledWith("next composition");
    gate.compositionEnd();
    vi.advanceTimersByTime(0);
    expect(write).toHaveBeenLastCalledWith("next composition");
  });

  it("passes a single oversized chunk through without copying it into the paused buffer", () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const gate = createTerminalImeOutputGate(write, () => 1, () => {});
    gate.compositionStart();
    const chunk = "字".repeat(MAX_TERMINAL_IME_BUFFERED_CHARS + 1);
    gate.write(chunk);
    expect(write).toHaveBeenCalledExactlyOnceWith(chunk);
    expect(gate.getBufferedChars()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not let an old settlement flush interrupt a new composition", () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const callbacks = new Map<number, () => void>();
    let nextHandle = 0;
    const gate = createTerminalImeOutputGate(write, (callback) => {
      callbacks.set(++nextHandle, callback);
      return nextHandle;
    }, (handle) => { callbacks.delete(handle); });
    gate.compositionStart();
    gate.write("one");
    gate.compositionEnd();
    gate.compositionStart();
    expect(callbacks.size).toBe(0);
    expect(write).not.toHaveBeenCalled();
    gate.write("two");
    gate.compositionEnd();
    callbacks.get(nextHandle)!();
    expect(write).toHaveBeenCalledExactlyOnceWith("onetwo");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears pressure and settlement timers on dispose and ignores late callbacks", () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const scheduled: Array<() => void> = [];
    const cancelled = vi.fn();
    const gate = createTerminalImeOutputGate(write, (callback) => { scheduled.push(callback); return scheduled.length; }, cancelled);
    gate.compositionStart();
    gate.write("pending");
    gate.compositionEnd();
    gate.dispose();
    expect(cancelled).toHaveBeenCalledWith(1);
    expect(vi.getTimerCount()).toBe(0);
    scheduled[0]();
    gate.write("late output");
    vi.advanceTimersByTime(MAX_TERMINAL_IME_HOLD_MS);
    expect(write).not.toHaveBeenCalled();
    expect(gate.getBufferedChars()).toBe(0);
  });
});

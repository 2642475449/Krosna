import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTerminalSizeReconciler, type PtyGridSize } from "./terminalSizeReconcile";
import type { TerminalGridSize } from "./terminalResize";

function fixture() {
  let grid: TerminalGridSize | null = { rows: 30, cols: 90 };
  let applied: PtyGridSize | null = { rows: 40, cols: 120, instanceId: 1 };
  let ready = true;
  const getSize = vi.fn(async () => applied && { ...applied });
  const resize = vi.fn(async (size: TerminalGridSize, instanceId: number) => {
    applied = { ...size, instanceId };
  });
  const onError = vi.fn();
  const reconcile = createTerminalSizeReconciler({
    isReady: () => ready,
    measure: () => grid && { ...grid },
    getSize,
    resize,
    onError,
  });
  return {
    reconcile, getSize, resize, onError,
    setGrid: (value: TerminalGridSize | null) => { grid = value; },
    setApplied: (value: PtyGridSize | null) => { applied = value; },
    setReady: (value: boolean) => { ready = value; },
  };
}

describe("terminal applied-size reconciliation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("repairs the startup grid and verifies it without duplicate resizes", async () => {
    const f = fixture();
    f.reconcile.request();
    await vi.runAllTimersAsync();
    expect(f.resize.mock.calls).toEqual([[{ rows: 30, cols: 90 }, 1]]);
    expect(f.getSize).toHaveBeenCalledTimes(3);
    f.reconcile.request();
    await vi.runAllTimersAsync();
    expect(f.resize).toHaveBeenCalledTimes(1);
  });

  it("retries when the view mounts before a PTY exists", async () => {
    const f = fixture();
    f.setApplied(null);
    f.reconcile.request();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.resize).not.toHaveBeenCalled();
    f.setApplied({ rows: 40, cols: 120, instanceId: 2 });
    await vi.runAllTimersAsync();
    expect(f.resize).toHaveBeenCalledWith({ rows: 30, cols: 90 }, 2);
  });

  it("retries the same target after a rejected resize", async () => {
    const f = fixture();
    f.resize.mockRejectedValueOnce(new Error("not ready"));
    f.reconcile.request();
    await vi.runAllTimersAsync();
    expect(f.resize.mock.calls).toEqual([
      [{ rows: 30, cols: 90 }, 1], [{ rows: 30, cols: 90 }, 1],
    ]);
    expect(f.onError).not.toHaveBeenCalled();
  });

  it("checks applied size rather than trusting an acknowledged resize", async () => {
    const f = fixture();
    f.resize.mockImplementationOnce(async () => {});
    f.reconcile.request();
    await vi.runAllTimersAsync();
    expect(f.resize).toHaveBeenCalledTimes(2);
  });

  it("discards a delayed read when layout changes without another event", async () => {
    const f = fixture();
    let resolve!: (value: PtyGridSize) => void;
    f.getSize.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    f.reconcile.request();
    f.setGrid({ rows: 25, cols: 75 });
    resolve({ rows: 40, cols: 120, instanceId: 1 });
    await vi.runAllTimersAsync();
    expect(f.resize.mock.calls).toEqual([[{ rows: 25, cols: 75 }, 1]]);
  });

  it("coalesces requests while an earlier read is in flight", async () => {
    const f = fixture();
    let resolve!: (value: PtyGridSize) => void;
    f.getSize.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    f.reconcile.request();
    f.setGrid({ rows: 25, cols: 75 });
    f.reconcile.request();
    f.setGrid({ rows: 20, cols: 65 });
    f.reconcile.request();
    expect(f.getSize).toHaveBeenCalledTimes(1);
    resolve({ rows: 40, cols: 120, instanceId: 1 });
    await vi.runAllTimersAsync();
    expect(f.resize.mock.calls).toEqual([[{ rows: 20, cols: 65 }, 1]]);
  });

  it("does not apply old results after a terminal is hidden or disposed", async () => {
    for (const dispose of [false, true]) {
      const f = fixture();
      let resolve!: (value: PtyGridSize) => void;
      f.getSize.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
      f.reconcile.request();
      if (dispose) f.reconcile.dispose();
      else { f.setGrid(null); f.reconcile.invalidate(); }
      resolve({ rows: 40, cols: 120, instanceId: 1 });
      await vi.runAllTimersAsync();
      expect(f.resize).not.toHaveBeenCalled();
      if (!dispose) {
        f.setGrid({ rows: 30, cols: 90 });
        f.reconcile.request();
        await vi.runAllTimersAsync();
        expect(f.resize).toHaveBeenCalledTimes(1);
      }
    }
  });

  it("re-reads the instance after a restarted PTY rejects a stale correction", async () => {
    const f = fixture();
    f.resize.mockImplementationOnce(async () => {
      f.setApplied({ rows: 40, cols: 120, instanceId: 2 });
      throw new Error("instance changed");
    });
    f.reconcile.request();
    await vi.runAllTimersAsync();
    expect(f.resize.mock.calls).toEqual([
      [{ rows: 30, cols: 90 }, 1], [{ rows: 30, cols: 90 }, 2],
    ]);
  });

  it("waits for session readiness and stops retries after a bounded failure", async () => {
    const f = fixture();
    f.setReady(false);
    f.reconcile.request();
    await vi.runAllTimersAsync();
    expect(f.getSize).not.toHaveBeenCalled();
    f.setReady(true);
    f.getSize.mockRejectedValue(new Error("unavailable"));
    f.reconcile.request();
    await vi.runAllTimersAsync();
    expect(f.getSize).toHaveBeenCalledTimes(6);
    expect(f.onError).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends with readback rather than another unverified resize when the PTY never converges", async () => {
    const f = fixture();
    f.resize.mockImplementation(async () => {});
    f.reconcile.request();
    await vi.runAllTimersAsync();
    expect(f.getSize).toHaveBeenCalledTimes(6);
    expect(f.resize).toHaveBeenCalledTimes(5);
    expect(f.onError).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

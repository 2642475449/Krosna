import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startStorageDiagnostics, type StorageDiagnosticTarget, type StorageDiagnosticsController } from "./storageDiagnostics";

const running: StorageDiagnosticsController[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  running.splice(0).forEach((controller) => controller.stop());
  vi.useRealTimers();
});

function setup() {
  const values = new Map<string, string>();
  const target: StorageDiagnosticTarget = {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => { values.set(key, value); }),
  };
  const get = target.getItem;
  const set = target.setItem;
  const start = (options: Parameters<typeof startStorageDiagnostics>[0] = {}) => {
    const controller = startStorageDiagnostics({ enabled: true, target, now: Date.now, ...options });
    if (!controller) throw new Error("Expected enabled diagnostics");
    running.push(controller);
    return controller;
  };
  return { target, values, get, set, start };
}

describe("opt-in storage diagnostics", () => {
  it("does nothing unless explicitly enabled, including not reading storage or heap", () => {
    const { target, get, set } = setup();
    const readHeap = vi.fn();
    expect(startStorageDiagnostics({ target, readHeap })).toBeNull();
    expect(startStorageDiagnostics({ enabled: false, target, readHeap })).toBeNull();
    expect(startStorageDiagnostics()).toBeNull();
    expect(target.getItem).toBe(get);
    expect(target.setItem).toBe(set);
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(readHeap).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("counts reads and writes without additional reads or changing values", () => {
    const { target, get, set, start } = setup();
    const controller = start();
    target.setItem("krosna-settings", "中文🙂");
    expect(target.getItem("krosna-settings")).toBe("中文🙂");
    expect(target.getItem("missing-secret-key")).toBeNull();
    vi.advanceTimersByTime(2000);
    const result = controller.snapshot();
    expect(result.keys[0]).toMatchObject({ key: "krosna-settings",
      get: { calls: 1, errors: 0, chars: 4, estimatedUtf16Bytes: 8 },
      set: { calls: 1, errors: 0, chars: 4, estimatedUtf16Bytes: 8 },
      getCallsPerSecond: 0.5, setCallsPerSecond: 0.5 });
    expect(get).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("中文");
    expect(JSON.stringify(result)).not.toContain("missing-secret-key");
  });

  it("preserves receiver and exactly the thrown exception while measuring failures", () => {
    const error = new Error("private quota detail");
    let time = 0;
    const target: StorageDiagnosticTarget = {
      getItem() { expect(this).toBe(target); time += 4; throw error; },
      setItem() { expect(this).toBe(target); time += 7; throw error; },
    };
    const { start } = setup();
    const controller = start({ target, now: () => time });
    expect(() => target.getItem("secret-key")).toThrow(error);
    expect(() => target.setItem("secret-key", "secret-value")).toThrow(error);
    expect(controller.snapshot().keys[0]).toMatchObject({ key: "[other]",
      get: { calls: 1, errors: 1, durationMs: 4, maxDurationMs: 4 },
      set: { calls: 1, errors: 1, chars: 12, durationMs: 7, maxDurationMs: 7 } });
    expect(JSON.stringify(controller.snapshot())).not.toContain("private quota");
  });

  it("caps unknown-key tracking, stack samples and heap history", () => {
    const { target, start } = setup();
    const captureStack = vi.fn(() => "Error: sensitive-message\n    at persist (C:/Users/private/assets/app.js:12:3)\n    at handler (https://private.example/path/file.js?token=secret:4:5)");
    const controller = start({ captureStack,
      readHeap: () => ({ usedJSHeapSize: 1, totalJSHeapSize: 2, jsHeapSizeLimit: 3 }) });
    for (let index = 0; index < 1000; index++) target.setItem(`private-key-${index}`, "secret-value");
    expect(controller.snapshot().keys).toHaveLength(1);
    expect(captureStack).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 30; index++) {
      vi.advanceTimersByTime(30_000);
      target.setItem("private-key", "x");
    }
    const result = controller.snapshot();
    expect(result.stacks).toHaveLength(16);
    expect(result.heap).toHaveLength(60);
    expect(result.stacks[0].frames).toEqual(["persist app.js:12:3", "handler"]);
    const serialized = JSON.stringify(result);
    for (const secret of ["private-key", "secret-value", "private.example", "C:/Users", "sensitive-message", "token="]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("restores original descriptors on stop, freezes duration and can restart", () => {
    const { target, get, set, start } = setup();
    const descriptor = Object.getOwnPropertyDescriptor(target, "getItem");
    const controller = start();
    expect(startStorageDiagnostics({ enabled: true, target })).toBe(controller);
    target.setItem("krosna-settings", "x");
    vi.advanceTimersByTime(1000);
    controller.stop();
    controller.stop();
    expect(target.getItem).toBe(get);
    expect(target.setItem).toBe(set);
    expect(Object.getOwnPropertyDescriptor(target, "getItem")).toEqual(descriptor);
    expect(vi.getTimerCount()).toBe(0);
    target.setItem("krosna-settings", "later");
    vi.advanceTimersByTime(5000);
    expect(controller.snapshot()).toMatchObject({ active: false, elapsedMs: 1000 });
    expect(controller.snapshot().keys[0].set.calls).toBe(1);
    const next = start();
    expect(next).not.toBe(controller);
  });

  it("does not overwrite a later wrapper and disables captured wrappers after stopping", () => {
    const { target, start } = setup();
    const controller = start();
    const instrumented = target.setItem;
    const external = vi.fn((key: string, value: string) => instrumented.call(target, key, value));
    target.setItem = external;
    controller.stop();
    expect(target.setItem).toBe(external);
    target.setItem("secret", "value");
    expect(controller.snapshot().keys).toEqual([]);
    expect(target.getItem("secret")).toBe("value");
  });

  it("preserves nonstandard adapter return values and prototype receivers", () => {
    const sentinel = Symbol("adapter result");
    class MemoryStorage {
      values = new Map<string, string>();
      getItem(key: string) { return this.values.get(key) ?? null; }
      setItem(key: string, value: string) { this.values.set(key, value); return sentinel; }
    }
    const original = MemoryStorage.prototype.setItem;
    const { start } = setup();
    const controller = start({ target: MemoryStorage.prototype });
    const instance = new MemoryStorage();
    expect(instance.setItem("krosna-settings", "ok")).toBe(sentinel);
    expect(instance.getItem("krosna-settings")).toBe("ok");
    expect(controller.snapshot().keys[0]).toMatchObject({ get: { calls: 1 }, set: { calls: 1 } });
    controller.stop();
    expect(MemoryStorage.prototype.setItem).toBe(original);
  });

  it("isolates failing clock, heap and stack adapters and returns detached snapshots", () => {
    const { target, start } = setup();
    const controller = start({ now: () => { throw new Error("clock unavailable"); },
      readHeap: () => { throw new Error("heap unavailable"); },
      captureStack: () => { throw new Error("stack unavailable"); } });
    target.setItem("krosna-settings", "ok");
    expect(target.getItem("krosna-settings")).toBe("ok");
    vi.advanceTimersByTime(4000);
    const result = controller.snapshot();
    result.keys[0].set.calls = 100;
    expect(controller.snapshot().keys[0].set.calls).toBe(1);
    expect(controller.snapshot().heap).toEqual([]);
  });

  it("rolls back partial installation when the second method cannot be wrapped", () => {
    const { target, get, set, start } = setup();
    Object.defineProperty(target, "setItem", { value: set, configurable: false, writable: false });
    expect(() => start()).toThrow();
    expect(target.getItem).toBe(get);
    expect(target.setItem).toBe(set);
    expect(vi.getTimerCount()).toBe(0);
  });
});

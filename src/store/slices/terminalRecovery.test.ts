import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RunnerOutputSnapshot } from "@/lib/runnerOutputSnapshot";
import { TerminalRecoveryCaptureSizeError } from "@/lib/terminalRecoverySnapshot";

const api = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/api", () => ({ saveTerminalRecovery: api.save, readTerminalRecovery: api.read }));
import {
  flushTerminalRecovery, loadTerminalRecovery, markTerminalRecoveryDirty, markTerminalRecoveryReady,
  registerTerminalRecovery, resetTerminalRecoveryForTests, TERMINAL_RECOVERY_SAVE_MS,
  waitForTerminalRecoveryReady, retainTerminalRecovery, terminalRecoveryKey, useTerminalRecoveryStore,
} from "./terminalRecovery";

const snapshot: RunnerOutputSnapshot = { version: 1, data: "saved output", cols: 80, rows: 24, viewportY: 0, selection: null };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}
async function tick() { for (let i = 0; i < 15; i += 1) await Promise.resolve(); }
function mount(id = "a", path = "C:/project") {
  const capture = vi.fn(async () => snapshot);
  return { capture, dispose: registerTerminalRecovery(id, path, { capture }) };
}
beforeEach(() => {
  vi.useFakeTimers(); resetTerminalRecoveryForTests(); vi.clearAllMocks();
  api.save.mockResolvedValue(undefined); api.read.mockResolvedValue(snapshot);
});
afterEach(() => { resetTerminalRecoveryForTests(); vi.useRealTimers(); });

it("checkpoints only dirty output at most once per interval without debounce starvation", async () => {
  const terminal = mount();
  await vi.advanceTimersByTimeAsync(TERMINAL_RECOVERY_SAVE_MS * 2);
  expect(terminal.capture).not.toHaveBeenCalled();
  markTerminalRecoveryDirty("a");
  await vi.advanceTimersByTimeAsync(TERMINAL_RECOVERY_SAVE_MS - 1);
  markTerminalRecoveryDirty("a");
  expect(api.save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(api.save).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(TERMINAL_RECOVERY_SAVE_MS * 2);
  expect(api.save).toHaveBeenCalledOnce();
});

it("flush drains serialized captures and disk writes without losing dirtiness during a save", async () => {
  const terminal = mount();
  const write = deferred<void>();
  api.save.mockReturnValueOnce(write.promise);
  markTerminalRecoveryDirty("a");
  const first = flushTerminalRecovery(); await tick();
  markTerminalRecoveryDirty("a");
  const second = flushTerminalRecovery(); await tick();
  expect(terminal.capture).toHaveBeenCalledOnce();
  write.resolve(); await Promise.all([first, second]);
  expect(api.save).toHaveBeenCalledTimes(2);
});

it("flush reports failures and retains dirty output for retry", async () => {
  mount(); markTerminalRecoveryDirty("a");
  api.save.mockRejectedValueOnce(new Error("disk full"));
  await expect(flushTerminalRecovery()).rejects.toThrow("disk full");
  await flushTerminalRecovery();
  expect(api.save).toHaveBeenCalledTimes(2);
});

it("flush filters the selected project and saves the others later", async () => {
  mount("a", "C:/first"); mount("b", "C:/second");
  markTerminalRecoveryDirty("a"); markTerminalRecoveryDirty("b");
  await flushTerminalRecovery("C:/first");
  expect(api.save).toHaveBeenCalledWith("C:/first", "a", snapshot);
  expect(api.save).toHaveBeenCalledOnce();
  await flushTerminalRecovery(); expect(api.save).toHaveBeenCalledTimes(2);
});

it("cancels a late capture after unmount and never overwrites new view history", async () => {
  const capture = deferred<RunnerOutputSnapshot>();
  const dispose = registerTerminalRecovery("a", "C:/project", { capture: () => capture.promise });
  markTerminalRecoveryDirty("a");
  const oldFlush = flushTerminalRecovery(); await tick(); dispose();
  const next = mount(); markTerminalRecoveryDirty("a");
  const newFlush = flushTerminalRecovery(); capture.resolve({ ...snapshot, data: "old" });
  await Promise.all([oldFlush, newFlush]);
  expect(next.capture).toHaveBeenCalledOnce();
  expect(api.save).toHaveBeenCalledOnce();
  expect(api.save).toHaveBeenCalledWith("C:/project", "a", snapshot);
});

it("deduplicates history reads, caches null, and distinguishes projects", async () => {
  const read = deferred<RunnerOutputSnapshot | null>(); api.read.mockReturnValueOnce(read.promise);
  const first = loadTerminalRecovery("C:/first", "a");
  const second = loadTerminalRecovery("C:/first", "a");
  await tick(); expect(api.read).toHaveBeenCalledOnce();
  read.resolve(null); expect(await first).toBeNull(); expect(await second).toBeNull();
  expect(await loadTerminalRecovery("C:/first", "a")).toBeNull();
  await loadTerminalRecovery("C:/second", "a");
  expect(api.read).toHaveBeenCalledTimes(2);
});

it("readiness waits for listeners and clears when the terminal is disposed", async () => {
  const terminal = mount();
  const ready = vi.fn(); const first = waitForTerminalRecoveryReady("a").then(ready);
  await tick(); expect(ready).not.toHaveBeenCalled();
  markTerminalRecoveryReady("a"); await first;
  expect(ready).toHaveBeenCalledOnce(); terminal.dispose();
  mount();
  const second = waitForTerminalRecoveryReady("a", 10);
  const rejected = expect(second).rejects.toThrow("did not become ready");
  await vi.advanceTimersByTimeAsync(10); await rejected;
});

it("keeps a mounted preview while evicting idle cached histories", async () => {
  const release = retainTerminalRecovery("C:/project", "visible");
  await loadTerminalRecovery("C:/project", "visible");
  for (let i = 0; i < 10; i += 1) await loadTerminalRecovery("C:/project", `idle-${i}`);
  expect(useTerminalRecoveryStore.getState().entries[terminalRecoveryKey("C:/project", "visible")]?.snapshot).toBe(snapshot);
  expect(Object.keys(useTerminalRecoveryStore.getState().entries)).toHaveLength(5);
  release();
});

it("preserves the previous checkpoint and allows exit when a single screen exceeds the history budget", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  registerTerminalRecovery("huge", "C:/project", { capture: async () => { throw new TerminalRecoveryCaptureSizeError(); } });
  markTerminalRecoveryDirty("huge");
  await expect(flushTerminalRecovery()).resolves.toBeUndefined();
  expect(api.save).not.toHaveBeenCalled();
  warning.mockRestore();
});

it("does not clear an open history preview when new output is checkpointed and refreshes it on reopening", async () => {
  const release = retainTerminalRecovery("C:/project", "a");
  await loadTerminalRecovery("C:/project", "a");
  const saved = useTerminalRecoveryStore.getState().entries[terminalRecoveryKey("C:/project", "a")];
  mount(); markTerminalRecoveryDirty("a"); await flushTerminalRecovery();
  expect(useTerminalRecoveryStore.getState().entries[terminalRecoveryKey("C:/project", "a")]).toBe(saved);
  release();
  await loadTerminalRecovery("C:/project", "a"); expect(api.read).toHaveBeenCalledTimes(2);
});

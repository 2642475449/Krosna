import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RunnerOutputSnapshot } from "@/lib/runnerOutputSnapshot";

const api = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/api", () => ({ saveRunnerOutput: api.save, readRunnerOutput: api.read, removeRunnerOutput: api.remove }));

import {
  archiveRunnerOutput, failRunnerOutputRestore, forgetRunnerOutput, markRunnerOutputExited,
  markRunnerOutputRestored, registerRunnerOutputTerminal, resetRunnerOutputsForTests,
  restoreRunnerOutput, RUNNER_OUTPUT_IDLE_MS, setRunnerOutputVisible, useRunnerOutputStore,
} from "./runnerOutput";

const snapshot: RunnerOutputSnapshot = { version: 1, data: "synthetic runner output", cols: 1024, rows: 24, viewportY: 8, selection: null };
const entry = (sessionId: string) => useRunnerOutputStore.getState().entries[sessionId];
async function flush() { for (let index = 0; index < 20; index += 1) await Promise.resolve(); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}
function mount(sessionId: string, bytes = 4 * 1024 * 1024) {
  const controller = { capture: vi.fn(async () => snapshot), estimateBytes: vi.fn(() => bytes) };
  return { ...controller, unregister: registerRunnerOutputTerminal(sessionId, controller) };
}
async function archived(sessionId: string) {
  const controller = mount(sessionId);
  markRunnerOutputExited(sessionId);
  await archiveRunnerOutput(sessionId);
  controller.unregister();
  return controller;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  resetRunnerOutputsForTests();
  vi.clearAllMocks();
  api.save.mockResolvedValue(undefined);
  api.remove.mockResolvedValue(undefined);
  api.read.mockResolvedValue(snapshot);
});
afterEach(() => { resetRunnerOutputsForTests(); vi.useRealTimers(); });

it("never archives before the real drained PTY exit, even over budget and idle", async () => {
  const terminals = [mount("a", 24 * 1024 * 1024), mount("b", 24 * 1024 * 1024), mount("c", 24 * 1024 * 1024)];
  await vi.advanceTimersByTimeAsync(RUNNER_OUTPUT_IDLE_MS * 3);
  await archiveRunnerOutput("a");
  expect(api.save).not.toHaveBeenCalled();
  terminals.forEach((terminal) => expect(terminal.capture).not.toHaveBeenCalled());
  expect(entry("a")).toMatchObject({ phase: "live", exited: false });
});

it("protects visible completed terminals and starts the idle allowance at exit", async () => {
  const visible = mount("visible", 64 * 1024 * 1024);
  mount("hidden");
  setRunnerOutputVisible("visible", true);
  await vi.advanceTimersByTimeAsync(RUNNER_OUTPUT_IDLE_MS * 2);
  markRunnerOutputExited("visible");
  markRunnerOutputExited("hidden");
  await vi.advanceTimersByTimeAsync(RUNNER_OUTPUT_IDLE_MS - 1);
  expect(api.save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(entry("hidden").phase).toBe("archived");
  expect(entry("visible").phase).toBe("live");
  expect(visible.capture).not.toHaveBeenCalled();
});

it("evicts the oldest hidden completed view when the global count exceeds two", async () => {
  mount("old"); markRunnerOutputExited("old");
  vi.setSystemTime(1100);
  mount("middle"); markRunnerOutputExited("middle");
  vi.setSystemTime(1200);
  mount("new"); markRunnerOutputExited("new");
  await flush();
  expect(api.save.mock.calls.map(([sessionId]) => sessionId)).toEqual(["old"]);
  expect(entry("middle").phase).toBe("live");
  expect(entry("new").phase).toBe("live");
});

it("applies the combined byte budget even with only two hidden completed views", async () => {
  mount("old", 20 * 1024 * 1024); markRunnerOutputExited("old");
  vi.setSystemTime(1100);
  mount("new", 20 * 1024 * 1024); markRunnerOutputExited("new");
  await flush();
  expect(entry("old")).toMatchObject({ phase: "archived", estimatedBytes: 0 });
  expect(entry("new").phase).toBe("live");
});

it("captures and saves only one terminal at a time while enforcing the budget", async () => {
  const firstSave = deferred<void>();
  api.save.mockImplementationOnce(() => firstSave.promise);
  const terminals = [mount("a"), mount("b"), mount("c"), mount("d")];
  ["a", "b", "c", "d"].forEach(markRunnerOutputExited);
  await flush();
  expect(api.save).toHaveBeenCalledTimes(1);
  expect(terminals[0].capture).toHaveBeenCalledTimes(1);
  terminals.slice(1).forEach((terminal) => expect(terminal.capture).not.toHaveBeenCalled());
  firstSave.resolve();
  await flush();
  expect(api.save.mock.calls.map(([sessionId]) => sessionId)).toEqual(["a", "b"]);
  expect([entry("c").phase, entry("d").phase]).toEqual(["live", "live"]);
});

it("queues explicit archive requests for another session behind the active save", async () => {
  const firstSave = deferred<void>(); api.save.mockReturnValueOnce(firstSave.promise);
  mount("a"); mount("b");
  markRunnerOutputExited("a"); markRunnerOutputExited("b");
  const first = archiveRunnerOutput("a");
  const second = archiveRunnerOutput("b");
  await flush();
  expect(api.save.mock.calls.map(([sessionId]) => sessionId)).toEqual(["a"]);
  firstSave.resolve(); await Promise.all([first, second]);
  expect(api.save.mock.calls.map(([sessionId]) => sessionId)).toEqual(["a", "b"]);
});

it.each(["capture", "save"])("keeps live output on %s failure and waits for an explicit retry", async (source) => {
  const terminal = mount("a");
  if (source === "capture") terminal.capture.mockRejectedValueOnce(new Error("snapshot unavailable"));
  else api.save.mockRejectedValueOnce(new Error("disk full"));
  markRunnerOutputExited("a");
  await vi.advanceTimersByTimeAsync(RUNNER_OUTPUT_IDLE_MS);
  expect(entry("a")).toMatchObject({ phase: "live" });
  expect(entry("a").error).toBeTruthy();
  const calls = terminal.capture.mock.calls.length;
  await vi.advanceTimersByTimeAsync(RUNNER_OUTPUT_IDLE_MS * 5);
  expect(terminal.capture).toHaveBeenCalledTimes(calls);
  expect(api.remove).not.toHaveBeenCalled();
  await archiveRunnerOutput("a");
  expect(entry("a")).toMatchObject({ phase: "archived", error: null });
});

it("retries a failed archive after another visible-to-hidden transition", async () => {
  mount("a"); markRunnerOutputExited("a");
  api.save.mockRejectedValueOnce(new Error("temporary failure"));
  await archiveRunnerOutput("a");
  setRunnerOutputVisible("a", true);
  expect(entry("a").error).toContain("temporary failure");
  setRunnerOutputVisible("a", false);
  await vi.advanceTimersByTimeAsync(RUNNER_OUTPUT_IDLE_MS);
  expect(entry("a")).toMatchObject({ phase: "archived", error: null });
});

it("retains the live view if it becomes visible during an in-flight save", async () => {
  const save = deferred<void>();
  api.save.mockReturnValueOnce(save.promise);
  mount("a"); markRunnerOutputExited("a");
  const work = archiveRunnerOutput("a");
  await flush();
  setRunnerOutputVisible("a", true);
  save.resolve(); await work; await flush();
  expect(entry("a")).toMatchObject({ phase: "live", visible: true });
  await vi.advanceTimersByTimeAsync(RUNNER_OUTPUT_IDLE_MS * 3);
  expect(api.save).toHaveBeenCalledTimes(1);
});

it("does not suppress a newer hide transition when an obsolete save fails", async () => {
  const save = deferred<void>(); api.save.mockReturnValueOnce(save.promise);
  mount("a"); markRunnerOutputExited("a");
  const work = archiveRunnerOutput("a"); await flush();
  setRunnerOutputVisible("a", true);
  setRunnerOutputVisible("a", false);
  save.reject(new Error("old save failed")); await work; await flush();
  await vi.advanceTimersByTimeAsync(RUNNER_OUTPUT_IDLE_MS);
  expect(entry("a").phase).toBe("archived");
  expect(api.save).toHaveBeenCalledTimes(2);
});

it("does not write a capture if the view becomes visible before capture completes", async () => {
  const captured = deferred<RunnerOutputSnapshot>();
  const terminal = mount("a"); terminal.capture.mockReturnValueOnce(captured.promise);
  markRunnerOutputExited("a");
  const work = archiveRunnerOutput("a"); await flush();
  setRunnerOutputVisible("a", true);
  captured.resolve(snapshot); await work;
  expect(api.save).not.toHaveBeenCalled();
  expect(entry("a").phase).toBe("live");
});

it("forgets synchronously and deletes after a late save without leaving an orphan", async () => {
  const save = deferred<void>();
  const order: string[] = [];
  api.save.mockImplementationOnce(async () => { order.push("save-start"); await save.promise; order.push("save-end"); });
  api.remove.mockImplementation(async () => { order.push("remove"); });
  mount("a"); markRunnerOutputExited("a");
  const work = archiveRunnerOutput("a"); await flush();
  const forgotten = forgetRunnerOutput("a");
  expect(forgetRunnerOutput("a")).toBe(forgotten);
  expect(entry("a")).toBeUndefined();
  expect(api.remove).not.toHaveBeenCalled();
  save.resolve(); await Promise.all([work, forgotten]); await flush();
  expect(order).toEqual(["save-start", "save-end", "remove"]);
  expect(entry("a")).toBeUndefined();
});

it("cancels a forgotten capture before it can start a disk write", async () => {
  const captured = deferred<RunnerOutputSnapshot>();
  const terminal = mount("a"); terminal.capture.mockReturnValueOnce(captured.promise);
  markRunnerOutputExited("a");
  const work = archiveRunnerOutput("a"); await flush();
  await forgetRunnerOutput("a");
  captured.resolve(snapshot); await work;
  expect(api.save).not.toHaveBeenCalled();
  expect(entry("a")).toBeUndefined();
});

it("does not reject an unmount cleanup when removing the disk cache fails", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  api.remove.mockRejectedValueOnce(new Error("cache is locked"));
  mount("a");
  await expect(forgetRunnerOutput("a")).resolves.toBeUndefined();
  expect(entry("a")).toBeUndefined();
  expect(warning).toHaveBeenCalledTimes(1);
  warning.mockRestore();
});

it("ignores a late disk read after forgetting the session", async () => {
  await archived("a");
  setRunnerOutputVisible("a", true);
  const read = deferred<RunnerOutputSnapshot>(); api.read.mockReturnValueOnce(read.promise);
  const work = restoreRunnerOutput("a"); await flush();
  await forgetRunnerOutput("a");
  read.resolve(snapshot); await work;
  expect(entry("a")).toBeUndefined();
});

it("does not let an old unregister or save detach a replacement terminal", async () => {
  const save = deferred<void>(); api.save.mockReturnValueOnce(save.promise);
  const old = mount("a"); markRunnerOutputExited("a");
  const work = archiveRunnerOutput("a"); await flush();
  const replacement = mount("a", 1024);
  old.unregister(); save.resolve(); await work; await flush();
  expect(entry("a")).toMatchObject({ phase: "live", estimatedBytes: 1024 });
  await archiveRunnerOutput("a");
  expect(replacement.capture).toHaveBeenCalledTimes(1);
  expect(entry("a").phase).toBe("archived");
});

it("releases an unmounted controller and its idle timer without capturing it", async () => {
  const terminal = mount("a"); markRunnerOutputExited("a");
  expect(vi.getTimerCount()).toBe(1);
  terminal.unregister();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(RUNNER_OUTPUT_IDLE_MS * 2);
  await archiveRunnerOutput("a");
  expect(terminal.capture).not.toHaveBeenCalled();
});

it("deduplicates reads and retains the restore snapshot until replay is acknowledged", async () => {
  await archived("a");
  setRunnerOutputVisible("a", true);
  const read = deferred<RunnerOutputSnapshot>(); api.read.mockReturnValueOnce(read.promise);
  const work = restoreRunnerOutput("a");
  expect(restoreRunnerOutput("a")).toBe(work);
  expect(entry("a").phase).toBe("loading");
  read.resolve(snapshot); await work;
  expect(entry("a")).toMatchObject({ phase: "live", snapshot });
  const terminal = mount("a", 64 * 1024 * 1024);
  setRunnerOutputVisible("a", false);
  await vi.advanceTimersByTimeAsync(RUNNER_OUTPUT_IDLE_MS * 2);
  expect(terminal.capture).not.toHaveBeenCalled();
  setRunnerOutputVisible("a", true);
  markRunnerOutputRestored("a");
  expect(entry("a").snapshot).toBeUndefined();
  expect(api.read).toHaveBeenCalledTimes(1);
  expect(api.remove).not.toHaveBeenCalled();
});

it("keeps disk data on read or replay failure and supports retry", async () => {
  await archived("a");
  setRunnerOutputVisible("a", true);
  api.read.mockRejectedValueOnce(new Error("temporarily unavailable"));
  await restoreRunnerOutput("a");
  expect(entry("a")).toMatchObject({ phase: "restore-error" });
  await restoreRunnerOutput("a");
  const terminal = mount("a");
  failRunnerOutputRestore("a", new Error("parser rejected snapshot"));
  expect(entry("a")).toMatchObject({ phase: "restore-error", snapshot: undefined });
  await vi.advanceTimersByTimeAsync(RUNNER_OUTPUT_IDLE_MS * 2);
  expect(terminal.capture).not.toHaveBeenCalled();
  expect(api.remove).not.toHaveBeenCalled();
  await restoreRunnerOutput("a");
  expect(entry("a")).toMatchObject({ phase: "live", snapshot, error: null });
});

it("rejects a late restore after a new terminal identity has registered", async () => {
  await archived("a");
  setRunnerOutputVisible("a", true);
  const read = deferred<RunnerOutputSnapshot>(); api.read.mockReturnValueOnce(read.promise);
  const work = restoreRunnerOutput("a"); await flush();
  mount("a");
  read.resolve(snapshot); await work;
  expect(entry("a").phase).toBe("live");
  expect(entry("a").snapshot).toBeUndefined();
});

it("drops a late read snapshot after switching away and keeps the disk cache for a later reveal", async () => {
  const original = await archived("a");
  setRunnerOutputVisible("a", true);
  const read = deferred<RunnerOutputSnapshot>(); api.read.mockReturnValueOnce(read.promise);
  const work = restoreRunnerOutput("a"); await flush();
  setRunnerOutputVisible("a", false);
  read.resolve(snapshot); await work;
  expect(entry("a")).toMatchObject({ phase: "archived", visible: false, error: null });
  expect(entry("a").snapshot).toBeUndefined();
  await vi.advanceTimersByTimeAsync(RUNNER_OUTPUT_IDLE_MS * 2);
  expect(original.capture).toHaveBeenCalledTimes(1);
  expect(api.save).toHaveBeenCalledTimes(1);
  expect(api.remove).not.toHaveBeenCalled();
  setRunnerOutputVisible("a", true);
  await restoreRunnerOutput("a");
  expect(entry("a")).toMatchObject({ phase: "live", snapshot });
  expect(api.read).toHaveBeenCalledTimes(2);
});

it("uses the latest visible state when a loading tab is hidden and shown again", async () => {
  await archived("a");
  setRunnerOutputVisible("a", true);
  const read = deferred<RunnerOutputSnapshot>(); api.read.mockReturnValueOnce(read.promise);
  const work = restoreRunnerOutput("a"); await flush();
  setRunnerOutputVisible("a", false);
  setRunnerOutputVisible("a", true);
  read.resolve(snapshot); await work;
  expect(entry("a")).toMatchObject({ phase: "live", visible: true, snapshot });
  expect(api.read).toHaveBeenCalledTimes(1);
});

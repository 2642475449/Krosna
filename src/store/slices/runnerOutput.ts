import { create } from "zustand";
import { readRunnerOutput, removeRunnerOutput, saveRunnerOutput } from "@/lib/api";
import type { RunnerOutputSnapshot } from "@/lib/runnerOutputSnapshot";
import type { RunnerOutputEntry, RunnerOutputState } from "../types";

export const RUNNER_OUTPUT_HOT_COUNT = 2;
// 隐藏且已退出视图的字符网格估算值；不代表整个应用的内存硬上限。
export const RUNNER_OUTPUT_HOT_BYTES = 32 * 1024 * 1024;
export const RUNNER_OUTPUT_IDLE_MS = 30_000;

export interface RunnerOutputTerminalController {
  capture: () => Promise<RunnerOutputSnapshot>;
  estimateBytes: () => number;
}

interface SessionLifetime {
  hiddenAt: number | null;
  visibilityRevision: number;
  archiveFailed: boolean;
  restoreRevision: number;
  restoring?: Promise<void>;
}
interface Registration {
  controller: RunnerOutputTerminalController | null;
}

export const useRunnerOutputStore = create<RunnerOutputState>(() => ({ entries: {} }));
const lifetimes = new Map<string, SessionLifetime>();
const terminals = new Map<string, Registration>();
// 同会话的写入和删除按次序落盘，避免关闭时晚到的 save 再留下孤儿文件。
const diskTails = new Map<string, Promise<void>>();
const forgetting = new Map<string, Promise<void>>();
let timer: ReturnType<typeof setTimeout> | undefined;
let archiveInFlight: Promise<void> | undefined;
let archivingSessionId: string | undefined;

function updateEntry(sessionId: string, patch: Partial<RunnerOutputEntry>) {
  useRunnerOutputStore.setState((state) => {
    const entry = state.entries[sessionId];
    return entry ? { entries: { ...state.entries, [sessionId]: { ...entry, ...patch } } } : state;
  });
}

function ensureSession(sessionId: string) {
  let lifetime = lifetimes.get(sessionId);
  if (!lifetime) {
    lifetime = { hiddenAt: Date.now(), visibilityRevision: 0, archiveFailed: false, restoreRevision: 0 };
    lifetimes.set(sessionId, lifetime);
    useRunnerOutputStore.setState((state) => ({ entries: {
      ...state.entries,
      [sessionId]: { phase: "live", visible: false, exited: false, estimatedBytes: 0, error: null },
    } }));
  }
  return lifetime;
}

function estimate(controller: RunnerOutputTerminalController) {
  try {
    const bytes = controller.estimateBytes();
    return Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  } catch { return 0; }
}

function diskOperation(sessionId: string, operation: () => Promise<void>) {
  const result = (diskTails.get(sessionId) ?? Promise.resolve()).then(operation);
  const tail = result.catch(() => undefined);
  diskTails.set(sessionId, tail);
  void tail.then(() => { if (diskTails.get(sessionId) === tail) diskTails.delete(sessionId); });
  return result;
}

function hotTerminals() {
  const hot: Array<{ sessionId: string; lifetime: SessionLifetime; bytes: number }> = [];
  for (const [sessionId, registration] of terminals) {
    const entry = useRunnerOutputStore.getState().entries[sessionId];
    const lifetime = lifetimes.get(sessionId);
    if (!registration.controller || !entry || !lifetime || !entry.exited || entry.visible || entry.phase !== "live" || entry.snapshot) continue;
    const bytes = estimate(registration.controller);
    if (entry.estimatedBytes !== bytes) updateEntry(sessionId, { estimatedBytes: bytes });
    hot.push({ sessionId, lifetime, bytes });
  }
  return hot.sort((left, right) => (left.lifetime.hiddenAt ?? 0) - (right.lifetime.hiddenAt ?? 0));
}

function scheduleArchive() {
  clearTimeout(timer);
  timer = undefined;
  if (archiveInFlight) return;
  const hot = hotTerminals();
  const overBudget = hot.length > RUNNER_OUTPUT_HOT_COUNT
    || hot.reduce((sum, item) => sum + item.bytes, 0) > RUNNER_OUTPUT_HOT_BYTES;
  const eligible = hot.filter(({ lifetime }) => !lifetime.archiveFailed && lifetime.hiddenAt !== null);
  const candidate = eligible.find(({ lifetime }) => overBudget || Date.now() - lifetime.hiddenAt! >= RUNNER_OUTPUT_IDLE_MS);
  if (candidate) {
    void archiveRunnerOutput(candidate.sessionId);
  } else if (eligible.length) {
    const deadline = Math.min(...eligible.map(({ lifetime }) => lifetime.hiddenAt! + RUNNER_OUTPUT_IDLE_MS));
    timer = setTimeout(scheduleArchive, Math.max(0, deadline - Date.now()));
  }
}

export function registerRunnerOutputTerminal(sessionId: string, controller: RunnerOutputTerminalController) {
  const lifetime = ensureSession(sessionId);
  const previous = terminals.get(sessionId);
  if (previous) previous.controller = null;
  const registration: Registration = { controller };
  terminals.set(sessionId, registration);
  lifetime.archiveFailed = false;
  const entry = useRunnerOutputStore.getState().entries[sessionId];
  lifetime.restoreRevision += 1;
  if (entry.phase === "loading") lifetime.restoring = undefined;
  updateEntry(sessionId, { estimatedBytes: estimate(controller),
    ...(["saving", "loading"].includes(entry.phase) ? { phase: "live" } : {}) });
  scheduleArchive();
  return () => {
    registration.controller = null;
    if (terminals.get(sessionId) !== registration) return;
    terminals.delete(sessionId);
    if (useRunnerOutputStore.getState().entries[sessionId]?.phase === "saving") updateEntry(sessionId, { phase: "live" });
    scheduleArchive();
  };
}

/** 只在真实 PTY 退出且末尾输出解析完毕后调用，命令 OSC 完成不代表 PTY 已退出。 */
export function markRunnerOutputExited(sessionId: string) {
  const lifetime = ensureSession(sessionId);
  const entry = useRunnerOutputStore.getState().entries[sessionId];
  if (!entry.exited && !entry.visible) lifetime.hiddenAt = Date.now();
  updateEntry(sessionId, { exited: true });
  scheduleArchive();
}

export function setRunnerOutputVisible(sessionId: string, visible: boolean) {
  const lifetime = ensureSession(sessionId);
  const entry = useRunnerOutputStore.getState().entries[sessionId];
  if (entry.visible !== visible) {
    lifetime.visibilityRevision += 1;
    lifetime.hiddenAt = visible ? null : Date.now();
    lifetime.archiveFailed = false;
    // 失败提示保留到下次实际重试成功；否则隐藏时失败、切回来就会被清掉。
    updateEntry(sessionId, { visible });
  }
  scheduleArchive();
}

/** 显式调用也用于重试；全局只允许一份大快照正在捕获/保存。 */
export function archiveRunnerOutput(sessionId: string): Promise<void> {
  if (archiveInFlight) return archivingSessionId === sessionId ? archiveInFlight
    : archiveInFlight.then(() => archiveRunnerOutput(sessionId));
  const lifetime = lifetimes.get(sessionId);
  const registration = terminals.get(sessionId);
  const entry = useRunnerOutputStore.getState().entries[sessionId];
  if (!lifetime || !registration?.controller || !entry || entry.phase !== "live" || !entry.exited || entry.visible || entry.snapshot) return Promise.resolve();
  const revision = lifetime.visibilityRevision;
  const current = () => lifetimes.get(sessionId) === lifetime && terminals.get(sessionId) === registration;
  const canArchive = () => {
    const latest = useRunnerOutputStore.getState().entries[sessionId];
    return current() && latest?.exited && !latest.visible && !latest.snapshot && lifetime.visibilityRevision === revision;
  };
  lifetime.archiveFailed = false;
  // 先占据全局名额，再进入 capture，避免同步订阅触发第二个归档。
  const work = Promise.resolve().then(async () => {
    try {
      if (!canArchive() || !registration.controller) return;
      const snapshot = await registration.controller.capture();
      if (!canArchive()) return;
      await diskOperation(sessionId, async () => {
        if (canArchive()) await saveRunnerOutput(sessionId, snapshot);
      });
      if (canArchive()) updateEntry(sessionId, { phase: "archived", estimatedBytes: 0 });
    } catch (error) {
      if (current()) {
        lifetime.archiveFailed = lifetime.visibilityRevision === revision;
        updateEntry(sessionId, { error: String(error) });
      }
    } finally {
      if (current() && useRunnerOutputStore.getState().entries[sessionId]?.phase === "saving") {
        updateEntry(sessionId, { phase: "live" });
      }
    }
  });
  archiveInFlight = work;
  archivingSessionId = sessionId;
  updateEntry(sessionId, { phase: "saving", error: null });
  void work.finally(() => {
    if (archiveInFlight === work) {
      archiveInFlight = undefined;
      archivingSessionId = undefined;
      scheduleArchive();
    }
  });
  return work;
}

export function restoreRunnerOutput(sessionId: string): Promise<void> {
  const lifetime = lifetimes.get(sessionId);
  const entry = useRunnerOutputStore.getState().entries[sessionId];
  if (!lifetime || !entry || !["archived", "restore-error", "loading"].includes(entry.phase)) return Promise.resolve();
  if (lifetime.restoring) return lifetime.restoring;
  const revision = ++lifetime.restoreRevision;
  const current = () => lifetimes.get(sessionId) === lifetime && lifetime.restoreRevision === revision;
  const work = Promise.resolve().then(async () => {
    try {
      const snapshot = await readRunnerOutput(sessionId);
      if (current()) {
        // 读盘期间切走就保留冷缓存，不在后台重建大终端后又立即归档。
        const visible = useRunnerOutputStore.getState().entries[sessionId]?.visible;
        updateEntry(sessionId, visible ? { phase: "live", snapshot, error: null }
          : { phase: "archived", snapshot: undefined, error: null });
      }
    } catch (error) {
      if (current()) updateEntry(sessionId, { phase: "restore-error", error: String(error) });
    } finally {
      if (lifetime.restoring === work) lifetime.restoring = undefined;
    }
  });
  lifetime.restoring = work;
  updateEntry(sessionId, { phase: "loading", error: null });
  return work;
}

/** 磁盘读取和 xterm 重放分别可能失败；保留磁盘正文供用户重试。 */
export function failRunnerOutputRestore(sessionId: string, error: unknown) {
  const lifetime = lifetimes.get(sessionId);
  if (!lifetime) return;
  lifetime.restoreRevision += 1;
  lifetime.restoring = undefined;
  const registration = terminals.get(sessionId);
  if (registration) registration.controller = null;
  terminals.delete(sessionId);
  updateEntry(sessionId, { phase: "restore-error", snapshot: undefined, error: String(error) });
  scheduleArchive();
}

export function markRunnerOutputRestored(sessionId: string) {
  if (!lifetimes.has(sessionId)) return;
  updateEntry(sessionId, { snapshot: undefined });
  scheduleArchive();
}

export function forgetRunnerOutput(sessionId: string): Promise<void> {
  const existed = lifetimes.delete(sessionId);
  const registration = terminals.get(sessionId);
  if (registration) registration.controller = null;
  terminals.delete(sessionId);
  useRunnerOutputStore.setState((state) => {
    if (!state.entries[sessionId]) return state;
    const entries = { ...state.entries };
    delete entries[sessionId];
    return { entries };
  });
  scheduleArchive();
  const previous = forgetting.get(sessionId);
  if (!existed && previous) return previous;
  const work = diskOperation(sessionId, () => removeRunnerOutput(sessionId)).catch((error: unknown) => {
    // 前端已忘记此会话，清理失败不能从 React 卸载路径冒出未处理拒绝。
    console.warn("Failed to remove archived runner output:", error);
  });
  forgetting.set(sessionId, work);
  void work.then(() => {
    if (forgetting.get(sessionId) === work) forgetting.delete(sessionId);
  }, () => { if (forgetting.get(sessionId) === work) forgetting.delete(sessionId); });
  return work;
}

export function resetRunnerOutputsForTests() {
  clearTimeout(timer);
  timer = undefined;
  lifetimes.clear();
  for (const registration of terminals.values()) registration.controller = null;
  terminals.clear();
  diskTails.clear();
  forgetting.clear();
  archiveInFlight = undefined;
  archivingSessionId = undefined;
  useRunnerOutputStore.setState({ entries: {} });
}

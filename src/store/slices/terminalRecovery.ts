import { create } from "zustand";
import { readTerminalRecovery, saveTerminalRecovery } from "@/lib/api";
import type { RunnerOutputSnapshot } from "@/lib/runnerOutputSnapshot";
import type { TerminalRecoveryEntry, TerminalRecoveryState } from "../types";
import { TerminalRecoveryCaptureSizeError } from "@/lib/terminalRecoverySnapshot";

export const TERMINAL_RECOVERY_SAVE_MS = 5_000;
const MAX_CACHED_HISTORY = 4;
export interface TerminalRecoveryController { capture: () => Promise<RunnerOutputSnapshot>; }
interface Registration {
  sessionId: string;
  projectPath: string;
  controller: TerminalRecoveryController;
  revision: number;
  savedRevision: number;
  ready: boolean;
  disposed: boolean;
  timer?: ReturnType<typeof setTimeout>;
}
interface ReadyWaiter { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; }

export const useTerminalRecoveryStore = create<TerminalRecoveryState>((set) => ({
  entries: {}, historySession: null,
  setHistorySession: (historySession) => set({ historySession }),
}));
const registrations = new Map<string, Registration>();
const reads = new Map<string, Promise<RunnerOutputSnapshot | null>>();
const writes = new Map<string, Promise<void>>();
const waiters = new Map<string, Set<ReadyWaiter>>();
const readers = new Map<string, number>();
const invalidatedCache = new Set<string>();
let captureTail = Promise.resolve();

export function terminalRecoveryKey(projectPath: string, sessionId: string): string {
  return JSON.stringify([projectPath, sessionId]);
}

function setEntry(key: string, entry: TerminalRecoveryEntry) {
  useTerminalRecoveryStore.setState((state) => {
    const entries = { ...state.entries };
    delete entries[key];
    entries[key] = entry;
    const idle = Object.keys(entries).filter((item) => !readers.has(item));
    for (const oldest of idle.slice(0, Math.max(0, idle.length - MAX_CACHED_HISTORY))) delete entries[oldest];
    return { entries };
  });
}

/** 挂载中的历史视图不可被后台标签的读取逐出，否则可见预览会变回永久 loading。 */
export function retainTerminalRecovery(projectPath: string, sessionId: string): () => void {
  const key = terminalRecoveryKey(projectPath, sessionId);
  readers.set(key, (readers.get(key) ?? 0) + 1);
  return () => {
    const count = readers.get(key) ?? 0;
    if (count > 1) readers.set(key, count - 1);
    else {
      readers.delete(key);
      if (invalidatedCache.delete(key)) useTerminalRecoveryStore.setState((state) => {
        const entries = { ...state.entries }; delete entries[key]; return { entries };
      });
    }
  };
}

export function loadTerminalRecovery(projectPath: string, sessionId: string): Promise<RunnerOutputSnapshot | null> {
  const key = terminalRecoveryKey(projectPath, sessionId);
  const cached = useTerminalRecoveryStore.getState().entries[key];
  if (cached?.phase === "ready") return Promise.resolve(cached.snapshot);
  const pending = reads.get(key);
  if (pending) return pending;
  setEntry(key, { phase: "loading", snapshot: null, error: null });
  const work = (writes.get(key) ?? Promise.resolve()).then(() => readTerminalRecovery(projectPath, sessionId)).then((snapshot) => {
    setEntry(key, { phase: "ready", snapshot, error: null });
    return snapshot;
  }, (error: unknown) => {
    setEntry(key, { phase: "error", snapshot: null, error: String(error) });
    throw error;
  });
  reads.set(key, work);
  void work.finally(() => { if (reads.get(key) === work) reads.delete(key); }).catch(() => undefined);
  return work;
}

function persist(registration: Registration): Promise<void> {
  clearTimeout(registration.timer);
  registration.timer = undefined;
  const key = terminalRecoveryKey(registration.projectPath, registration.sessionId);
  const work = (writes.get(key) ?? Promise.resolve()).then(async () => {
    if (registration.disposed || registration.revision === registration.savedRevision) return;
    const revision = registration.revision;
    let snapshot: RunnerOutputSnapshot | undefined;
    const capture = captureTail.then(async () => {
      if (!registration.disposed) snapshot = await registration.controller.capture();
    });
    captureTail = capture.catch(() => undefined);
    try { await capture; }
    catch (error) {
      // 极端尺寸/单屏富文本超限只跳过本次画面；保留旧快照，不能把用户锁在退出流程。
      if (!(error instanceof TerminalRecoveryCaptureSizeError)) throw error;
      registration.savedRevision = revision;
      console.warn("Skipped oversized terminal recovery screen:", registration.sessionId);
      return;
    }
    if (registration.disposed || !snapshot) return;
    await saveTerminalRecovery(registration.projectPath, registration.sessionId, snapshot);
    registration.savedRevision = revision;
    // 已落盘内容由历史视图按需读取，避免为每个活动终端长期保留一份大字符串。
    useTerminalRecoveryStore.setState((state) => {
      // 打开的只读预览固定本次读取的画面；新 checkpoint 不应让它清空或反复回放。
      if (readers.has(key)) { invalidatedCache.add(key); return state; }
      const entries = { ...state.entries }; delete entries[key]; return { entries };
    });
  });
  const tail = work.catch(() => undefined);
  writes.set(key, tail);
  void tail.then(() => { if (writes.get(key) === tail) writes.delete(key); });
  return work;
}

export function registerTerminalRecovery(sessionId: string, projectPath: string, controller: TerminalRecoveryController): () => void {
  const old = registrations.get(sessionId);
  if (old) { old.disposed = true; clearTimeout(old.timer); }
  const registration: Registration = { sessionId, projectPath, controller, revision: 0, savedRevision: 0, ready: false, disposed: false };
  registrations.set(sessionId, registration);
  return () => {
    registration.disposed = true;
    clearTimeout(registration.timer);
    if (registrations.get(sessionId) === registration) registrations.delete(sessionId);
  };
}

export function markTerminalRecoveryDirty(sessionId: string): void {
  const registration = registrations.get(sessionId);
  if (!registration) return;
  registration.revision += 1;
  if (!registration.timer) registration.timer = setTimeout(() => {
    void persist(registration).catch((error: unknown) => console.warn("Failed to checkpoint terminal history:", error));
  }, TERMINAL_RECOVERY_SAVE_MS);
}

export async function flushTerminalRecovery(projectPath?: string): Promise<void> {
  const selected = [...registrations.values()].filter((item) => projectPath === undefined || item.projectPath === projectPath);
  const results = await Promise.allSettled(selected.map(persist));
  const failure = results.find((item) => item.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}

export function markTerminalRecoveryReady(sessionId: string): void {
  const registration = registrations.get(sessionId);
  if (!registration) return;
  registration.ready = true;
  for (const waiter of waiters.get(sessionId) ?? []) { clearTimeout(waiter.timer); waiter.resolve(); }
  waiters.delete(sessionId);
}

export function waitForTerminalRecoveryReady(sessionId: string, timeoutMs = 15_000): Promise<void> {
  if (registrations.get(sessionId)?.ready) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const waiter: ReadyWaiter = { resolve, reject, timer: setTimeout(() => {
      waiters.get(sessionId)?.delete(waiter);
      reject(new Error("Terminal view did not become ready"));
    }, timeoutMs) };
    const list = waiters.get(sessionId) ?? new Set<ReadyWaiter>();
    list.add(waiter); waiters.set(sessionId, list);
  });
}

export function resetTerminalRecoveryForTests(): void {
  for (const registration of registrations.values()) { registration.disposed = true; clearTimeout(registration.timer); }
  registrations.clear(); reads.clear(); writes.clear(); readers.clear(); invalidatedCache.clear(); captureTail = Promise.resolve();
  for (const list of waiters.values()) for (const waiter of list) { clearTimeout(waiter.timer); waiter.reject(new Error("Terminal recovery reset")); }
  waiters.clear(); useTerminalRecoveryStore.setState({ entries: {}, historySession: null });
}

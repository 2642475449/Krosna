/** 仅在隔离诊断中显式开启；导入本模块不会读取存储、修改原型或启动定时器。 */
export interface StorageDiagnosticTarget {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StorageHeapSample {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

type Operation = "get" | "set";
interface OperationCounts {
  calls: number;
  errors: number;
  chars: number;
  estimatedUtf16Bytes: number;
  durationMs: number;
  maxDurationMs: number;
}
interface KeyCounts {
  key: string;
  get: OperationCounts;
  set: OperationCounts;
}
interface StackSample {
  atMs: number;
  key: string;
  operation: Operation;
  frames: string[];
}

export interface StorageDiagnosticsSnapshot {
  active: boolean;
  elapsedMs: number;
  keys: Array<KeyCounts & { getCallsPerSecond: number; setCallsPerSecond: number }>;
  stacks: StackSample[];
  heap: Array<StorageHeapSample & { atMs: number }>;
}

export interface StorageDiagnosticsController {
  snapshot(): StorageDiagnosticsSnapshot;
  stop(): void;
}

interface StorageDiagnosticsOptions {
  enabled?: boolean;
  target?: StorageDiagnosticTarget;
  now?: () => number;
  readHeap?: () => StorageHeapSample | undefined;
  captureStack?: () => string | undefined;
}

// 只能新增固定应用键；未知键汇总到同一个桶，绝不保留用户提供的键名。
const SAFE_KEYS = new Set([
  "krosna-settings", "krosna-recent-projects-v1", "krosna-clipboard-cache",
  "krosna-project-icon-colors", "krosna-bottom-runner-storage", "krosna-auxiliary-dock",
  "krosna-memory-probe",
]);
const OTHER_KEY = "[other]";
const MAX_STACKS = 16;
const STACK_INTERVAL_MS = 10_000;
const MAX_HEAP_SAMPLES = 60;
const SAMPLE_INTERVAL_MS = 2_000;
const activeTargets = new WeakMap<StorageDiagnosticTarget, StorageDiagnosticsController>();

function emptyCounts(): OperationCounts {
  return { calls: 0, errors: 0, chars: 0, estimatedUtf16Bytes: 0, durationMs: 0, maxDurationMs: 0 };
}

function defaultHeap(): StorageHeapSample | undefined {
  const heap = (globalThis.performance as Performance & { memory?: StorageHeapSample } | undefined)?.memory;
  return heap && {
    usedJSHeapSize: heap.usedJSHeapSize,
    totalJSHeapSize: heap.totalJSHeapSize,
    jsHeapSizeLimit: heap.jsHeapSizeLimit,
  };
}

/** 只留下函数名、脚本文件名与行列，去掉路径、URL 参数和任意首行错误消息。 */
function safeFrames(stack: string | undefined): string[] {
  return (stack ?? "").slice(0, 4096).split("\n").slice(1, 9).map((line) => {
    const name = /^\s*at\s+([\w$.<>]+)(?:\s|\()/.exec(line)?.[1];
    const source = /(?:[/\\])([\w.-]+\.[a-z]+):([0-9]+):([0-9]+)\)?\s*$/i.exec(line);
    return [name ?? "[frame]", source ? `${source[1]}:${source[2]}:${source[3]}` : ""].filter(Boolean).join(" ");
  });
}

/**
 * 显式 enabled:true 才开始；不读取旧值，不存正文，不输出控制台或写磁盘。
 * 可在开发入口将返回的控制器临时放到 window，按需 snapshot() / stop()。
 */
export function startStorageDiagnostics(options: StorageDiagnosticsOptions = {}): StorageDiagnosticsController | null {
  if (options.enabled !== true) return null;
  const target = options.target ?? (typeof Storage === "undefined" ? undefined : Storage.prototype);
  if (!target) return null;
  const existing = activeTargets.get(target);
  if (existing) return existing;
  const clock = options.now ?? (() => performance.now());
  const readHeap = options.readHeap ?? defaultHeap;
  const captureStack = options.captureStack ?? (() => new Error().stack);
  // 诊断适配器故障不得改变存储的返回值或异常。
  const now = () => {
    try { const value = clock(); return Number.isFinite(value) ? value : 0; }
    catch { return 0; }
  };
  const startedAt = now();
  let endedAt: number | undefined;
  let active = true;
  let recording = false;
  const counts = new Map<string, KeyCounts>();
  const stacks: StackSample[] = [];
  const lastStacks = new Map<string, number>();
  const heap: StorageDiagnosticsSnapshot["heap"] = [];
  const descriptors = {
    getItem: Object.getOwnPropertyDescriptor(target, "getItem"),
    setItem: Object.getOwnPropertyDescriptor(target, "setItem"),
  };
  const originalGet = target.getItem;
  const originalSet = target.setItem;

  function record(operation: Operation, rawKey: unknown, chars: number, duration: number, error: boolean) {
    if (!active || recording) return;
    recording = true;
    try {
      const key = typeof rawKey === "string" && SAFE_KEYS.has(rawKey) ? rawKey : OTHER_KEY;
      let bucket = counts.get(key);
      if (!bucket) {
        bucket = { key, get: emptyCounts(), set: emptyCounts() };
        counts.set(key, bucket);
      }
      const stat = bucket[operation];
      stat.calls++;
      stat.errors += Number(error);
      stat.chars += chars;
      stat.estimatedUtf16Bytes += chars * 2;
      stat.durationMs += duration;
      stat.maxDurationMs = Math.max(stat.maxDurationMs, duration);
      const at = now();
      const stackKey = `${operation}:${key}`;
      if (stacks.length < MAX_STACKS && at - (lastStacks.get(stackKey) ?? -Infinity) >= STACK_INTERVAL_MS) {
        lastStacks.set(stackKey, at);
        stacks.push({ atMs: Math.max(0, at - startedAt), key, operation, frames: safeFrames(captureStack()) });
      }
    } catch { /* 诊断失败不能中断应用。 */ }
    finally { recording = false; }
  }

  function getItem(this: StorageDiagnosticTarget, key: string) {
    if (!active || recording) return originalGet.apply(this, arguments as unknown as [string]);
    const before = now();
    let result: string | null = null;
    let failed = true;
    try { result = originalGet.apply(this, arguments as unknown as [string]); failed = false; return result; }
    finally { record("get", key, typeof result === "string" ? result.length : 0, Math.max(0, now() - before), failed); }
  }
  function setItem(this: StorageDiagnosticTarget, key: string, value: string) {
    if (!active || recording) return originalSet.apply(this, arguments as unknown as [string, string]);
    const before = now();
    let failed = true;
    try { const result = originalSet.apply(this, arguments as unknown as [string, string]); failed = false; return result; }
    finally { record("set", key, typeof value === "string" ? value.length : 0, Math.max(0, now() - before), failed); }
  }

  const restore = (method: "getItem" | "setItem", wrapper: StorageDiagnosticTarget[typeof method]) => {
    if (target[method] !== wrapper) return;
    const descriptor = descriptors[method];
    if (descriptor) Object.defineProperty(target, method, descriptor);
    else Reflect.deleteProperty(target, method);
  };
  try {
    Object.defineProperty(target, "getItem", { configurable: true, writable: true, value: getItem });
    Object.defineProperty(target, "setItem", { configurable: true, writable: true, value: setItem });
  } catch (error) {
    restore("getItem", getItem);
    restore("setItem", setItem);
    throw error;
  }
  const sampleHeap = () => {
    if (!active) return;
    try {
      const sample = readHeap();
      if (!sample || ![sample.usedJSHeapSize, sample.totalJSHeapSize, sample.jsHeapSizeLimit].every(Number.isFinite)) return;
      heap.push({ atMs: Math.max(0, now() - startedAt), usedJSHeapSize: sample.usedJSHeapSize,
        totalJSHeapSize: sample.totalJSHeapSize, jsHeapSizeLimit: sample.jsHeapSizeLimit });
      if (heap.length > MAX_HEAP_SAMPLES) heap.shift();
    } catch { /* 某些运行时不提供堆统计。 */ }
  };
  const timer = setInterval(sampleHeap, SAMPLE_INTERVAL_MS);
  const controller: StorageDiagnosticsController = {
    snapshot() {
      const elapsedMs = Math.max(0, (endedAt ?? now()) - startedAt);
      const seconds = elapsedMs / 1000;
      return {
        active, elapsedMs,
        keys: [...counts.values()].map((entry) => ({ key: entry.key, get: { ...entry.get }, set: { ...entry.set },
          getCallsPerSecond: seconds ? entry.get.calls / seconds : 0,
          setCallsPerSecond: seconds ? entry.set.calls / seconds : 0 })),
        stacks: stacks.map((sample) => ({ ...sample, frames: [...sample.frames] })),
        heap: heap.map((sample) => ({ ...sample })),
      };
    },
    stop() {
      if (!active) return;
      active = false;
      endedAt = now();
      clearInterval(timer);
      restore("getItem", getItem);
      restore("setItem", setItem);
      activeTargets.delete(target);
    },
  };
  activeTargets.set(target, controller);
  sampleHeap();
  return controller;
}

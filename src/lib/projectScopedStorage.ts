import type { StateStorage } from "zustand/middleware";

const PROJECT_FIELDS = [
  "projectSessions",
  "projectArchivedSessions",
  "projectWorkspaces",
  "projectAttentionItems",
] as const;

type PersistedEnvelope = {
  state: Record<string, unknown> & { __writerProjectPath?: string | null };
  version?: number;
};

function isEnvelope(value: unknown): value is PersistedEnvelope {
  return value !== null && typeof value === "object" &&
    "state" in value && value.state !== null && typeof value.state === "object";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 每个窗口只写自己项目的数据，避免其他窗口的旧快照覆盖新会话。 */
export function mergeProjectScopedPersistedState(
  currentValue: string | null,
  nextValue: string,
): string {
  const next: unknown = JSON.parse(nextValue);
  if (!isEnvelope(next)) return nextValue;

  const projectPath = next.state.__writerProjectPath;
  delete next.state.__writerProjectPath;

  if (!currentValue) return JSON.stringify(next);
  let current: unknown;
  try {
    current = JSON.parse(currentValue);
  } catch {
    return JSON.stringify(next);
  }
  if (!isEnvelope(current)) return JSON.stringify(next);

  for (const field of PROJECT_FIELDS) {
    const existing = isRecord(current.state[field]) ? current.state[field] : {};
    const incoming = isRecord(next.state[field]) ? next.state[field] : {};
    next.state[field] = projectPath
      ? { ...existing, [projectPath]: incoming[projectPath] ?? existing[projectPath] ?? [] }
      : existing;
  }
  return JSON.stringify(next);
}

export function createProjectScopedStorage(storage: StateStorage): StateStorage {
  // 只记住本窗口成功提交的意图，不缓存共享存储内容。其他窗口修改或删除后，
  // 无变化的旧快照不能重新写回；真正变化时仍读取底层最新值再合并。
  const successfulInputs = new Map<string, string>();
  let pending: Promise<void> | undefined;

  function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
    return value !== null && (typeof value === "object" || typeof value === "function") &&
      "then" in value && typeof value.then === "function";
  }

  function serialize<T>(operation: () => T | PromiseLike<T>): T | Promise<T> {
    const result = pending ? pending.then(operation) : operation();
    if (!isPromiseLike(result)) return result;
    const promise = Promise.resolve(result);
    // 仅队列尾部恢复失败状态，原始 Promise 的错误仍返回调用方。
    const settled = promise.then(() => {}, () => {});
    pending = settled;
    void settled.then(() => {
      if (pending === settled) pending = undefined;
    });
    return promise;
  }

  return {
    getItem: (name) => serialize(() => storage.getItem(name)),
    removeItem: (name) => serialize(() => {
      const result = storage.removeItem(name);
      if (isPromiseLike(result)) {
        return Promise.resolve(result).then((removed) => {
          successfulInputs.delete(name);
          return removed;
        });
      }
      successfulInputs.delete(name);
      return result;
    }),
    setItem: (name, value) => serialize(() => {
      if (successfulInputs.get(name) === value) return;
      const write = (current: string | null) => {
        const merged = mergeProjectScopedPersistedState(current, value);
        if (merged === current) {
          successfulInputs.set(name, value);
          return;
        }
        const result = storage.setItem(name, merged);
        if (isPromiseLike(result)) {
          return Promise.resolve(result).then((saved) => {
            successfulInputs.set(name, value);
            return saved;
          });
        }
        successfulInputs.set(name, value);
        return result;
      };
      const current = storage.getItem(name);
      return isPromiseLike(current) ? Promise.resolve(current).then(write) : write(current);
    }),
  };
}

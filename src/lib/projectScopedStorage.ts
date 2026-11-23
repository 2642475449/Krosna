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

type StoredItemMutation<T> = (current: string | null) => { value: string | null; result: T };
type SessionStorageSnapshot = {
  projectPath: string;
  targetIds: ReadonlySet<string>;
  sessions: { id: string }[];
  archives: { id: string }[];
};
type ProjectScopedStorage = StateStorage & {
  mutateItem<T>(name: string, mutate: StoredItemMutation<T>): T | Promise<T>;
  acknowledgeSessionChanges(name: string, changes: SessionStorageSnapshot[]): void;
};

function isEnvelope(value: unknown): value is PersistedEnvelope {
  return value !== null && typeof value === "object" &&
    "state" in value && value.state !== null && typeof value.state === "object";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return value !== null && (typeof value === "object" || typeof value === "function") &&
    "then" in value && typeof value.then === "function";
}

function readAndMutate<T>(storage: StateStorage, name: string, mutate: StoredItemMutation<T>) {
  const apply = (current: string | null) => {
    const { value, result } = mutate(current);
    if (value === null || value === current) return result;
    const saved = storage.setItem(name, value);
    return isPromiseLike(saved) ? Promise.resolve(saved).then(() => result) : result;
  };
  const current = storage.getItem(name);
  return isPromiseLike(current) ? Promise.resolve(current).then(apply) : apply(current);
}

export function mutateStoredItem<T>(storage: StateStorage, name: string, mutate: StoredItemMutation<T>) {
  if ("mutateItem" in storage && typeof storage.mutateItem === "function") {
    return (storage as ProjectScopedStorage).mutateItem(name, mutate);
  }
  return readAndMutate(storage, name, mutate);
}

export function acknowledgeStoredSessionChanges(storage: StateStorage, name: string, changes: SessionStorageSnapshot[]) {
  if ("acknowledgeSessionChanges" in storage && typeof storage.acknowledgeSessionChanges === "function") {
    (storage as ProjectScopedStorage).acknowledgeSessionChanges(name, changes);
  }
}

function mergeSessionChanges(existing: unknown, previous: unknown, incoming: unknown, archived: boolean) {
  if (!Array.isArray(previous) || !Array.isArray(incoming)) return incoming;
  const baseline = JSON.stringify(previous);
  if (JSON.stringify(existing) === baseline) return incoming;
  if (JSON.stringify(incoming) === baseline) return existing ?? [];
  const byId = (rows: unknown[]) => new Map(rows.flatMap((row) =>
    isRecord(row) && typeof row.id === "string" ? [[row.id, row] as const] : []));
  const diskRows = byId(Array.isArray(existing) ? existing : []);
  const oldRows = byId(previous);
  const newRows = byId(incoming);
  const result = new Map(diskRows);
  for (const [id, row] of oldRows) {
    if (!newRows.has(id) && (!archived || diskRows.get(id)?.archivedAt === row.archivedAt)) result.delete(id);
  }
  for (const [id, row] of newRows) {
    const prior = oldRows.get(id);
    // 归档记录在读取旧版本时会被补字段，只有新归档或重新归档才是写入意图。
    if (!prior || (diskRows.has(id) && (archived ? row.archivedAt !== prior.archivedAt : JSON.stringify(row) !== JSON.stringify(prior)))) {
      result.set(id, row);
    }
  }
  // 优先使用写入方的排序，再保留其他窗口增加的会话。
  return Array.from(new Set([...newRows.keys(), ...diskRows.keys()]))
    .flatMap((id) => result.has(id) ? [result.get(id)] : []);
}

/** 每个窗口只写自己项目的数据，避免其他窗口的旧快照覆盖新会话。 */
export function mergeProjectScopedPersistedState(
  currentValue: string | null,
  nextValue: string,
  previousValue?: string,
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

  let previous: unknown;
  try {
    previous = previousValue === undefined ? null : JSON.parse(previousValue);
  } catch {
    previous = null;
  }

  for (const field of PROJECT_FIELDS) {
    const existing = isRecord(current.state[field]) ? current.state[field] : {};
    const incoming = isRecord(next.state[field]) ? next.state[field] : {};
    if (!projectPath) {
      next.state[field] = existing;
      continue;
    }
    const incomingRows = incoming[projectPath] ?? existing[projectPath] ?? [];
    const previousGroups = isEnvelope(previous) ? previous.state[field] : null;
    const rows = (field === "projectSessions" || field === "projectArchivedSessions") && isEnvelope(previous)
      ? mergeSessionChanges(
        existing[projectPath],
        isRecord(previousGroups) ? previousGroups[projectPath] ?? [] : [],
        incomingRows,
        field === "projectArchivedSessions",
      )
      : incomingRows;
    next.state[field] = { ...existing, [projectPath]: rows };
  }
  return JSON.stringify(next);
}

export function createProjectScopedStorage(storage: StateStorage): ProjectScopedStorage {
  // 只记住本窗口成功提交的意图，不缓存共享存储内容。其他窗口修改或删除后，
  // 无变化的旧快照不能重新写回；真正变化时仍读取底层最新值再合并。
  const successfulInputs = new Map<string, string>();
  const lastInputs = new Map<string, string>();
  let pending: Promise<void> | undefined;

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
    getItem: (name) => serialize(() => {
      const remember = (value: string | null) => {
        if (value && !lastInputs.has(name)) lastInputs.set(name, value);
        return value;
      };
      const value = storage.getItem(name);
      return isPromiseLike(value) ? Promise.resolve(value).then(remember) : remember(value);
    }),
    mutateItem: (name, mutate) => serialize(() => readAndMutate(storage, name, mutate)),
    acknowledgeSessionChanges: (name, changes) => {
      const last = lastInputs.get(name);
      let snapshot: unknown = null;
      try {
        if (last !== undefined) snapshot = JSON.parse(last);
      } catch {
        return;
      }
      if (!isEnvelope(snapshot)) return;
      for (const field of ["projectSessions", "projectArchivedSessions"]) {
        const groups = snapshot.state[field];
        const updated = isRecord(groups) ? { ...groups } : {};
        for (const { projectPath, targetIds, sessions, archives } of changes) {
          const rows = updated[projectPath];
          const untouched = Array.isArray(rows) ? rows.filter((row) => !isRecord(row) || !targetIds.has(String(row.id))) : [];
          updated[projectPath] = [...(field === "projectSessions" ? sessions : archives), ...untouched];
        }
        snapshot.state[field] = updated;
      }
      // 已提交的归档变更成为本窗口新基线，后续设置写入不会再执行同一次操作。
      lastInputs.set(name, JSON.stringify(snapshot));
      successfulInputs.delete(name);
    },
    removeItem: (name) => serialize(() => {
      const result = storage.removeItem(name);
      if (isPromiseLike(result)) {
        return Promise.resolve(result).then((removed) => {
          successfulInputs.delete(name);
          lastInputs.delete(name);
          return removed;
        });
      }
      successfulInputs.delete(name);
      lastInputs.delete(name);
      return result;
    }),
    setItem: (name, value) => serialize(() => {
      if (successfulInputs.get(name) === value) return;
      const write = (current: string | null) => {
        const merged = mergeProjectScopedPersistedState(current, value, lastInputs.get(name));
        if (merged === current) {
          successfulInputs.set(name, value);
          lastInputs.set(name, value);
          return;
        }
        const result = storage.setItem(name, merged);
        if (isPromiseLike(result)) {
          return Promise.resolve(result).then((saved) => {
            successfulInputs.set(name, value);
            lastInputs.set(name, value);
            return saved;
          });
        }
        successfulInputs.set(name, value);
        lastInputs.set(name, value);
        return result;
      };
      const current = storage.getItem(name);
      return isPromiseLike(current) ? Promise.resolve(current).then(write) : write(current);
    }),
  };
}

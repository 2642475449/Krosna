import { describe, expect, it, vi } from "vitest";
import { createProjectScopedStorage, mergeProjectScopedPersistedState } from "./projectScopedStorage";

const pathA = "E:/projects/a";
const pathB = "E:/projects/b";

function snapshot(
  writer: string | null,
  sessions: Record<string, unknown[]>,
  archived: Record<string, unknown[]> = {},
) {
  return JSON.stringify({
    version: 3,
    state: {
      __writerProjectPath: writer,
      projectSessions: sessions,
      projectArchivedSessions: archived,
      projectWorkspaces: {},
      projectAttentionItems: {},
    },
  });
}

describe("project scoped persistence", () => {
  it("preserves new sessions when a stale launcher or voice window writes", () => {
    const current = snapshot(pathA, { [pathA]: [{ id: "new" }] });
    const stale = snapshot(null, { [pathA]: [] });
    const merged = JSON.parse(mergeProjectScopedPersistedState(current, stale));
    expect(merged.state.projectSessions[pathA]).toEqual([{ id: "new" }]);
    expect(merged.state).not.toHaveProperty("__writerProjectPath");
  });

  it("updates only the writing project's sessions and archived sessions", () => {
    const current = snapshot(pathA, {
      [pathA]: [{ id: "a" }],
      [pathB]: [{ id: "b" }],
    });
    const next = snapshot(pathB, {
      [pathA]: [],
      [pathB]: [],
    }, { [pathB]: [{ id: "b" }] });
    const merged = JSON.parse(mergeProjectScopedPersistedState(current, next));
    expect(merged.state.projectSessions[pathA]).toEqual([{ id: "a" }]);
    expect(merged.state.projectSessions[pathB]).toEqual([]);
    expect(merged.state.projectArchivedSessions[pathB]).toEqual([{ id: "b" }]);
  });

  it("keeps another project's workspace and attention state", () => {
    const current = JSON.parse(snapshot(pathA, { [pathA]: [] }));
    current.state.projectWorkspaces[pathA] = { marker: "workspace-a" };
    current.state.projectAttentionItems[pathA] = [{ id: "attention-a" }];
    const next = snapshot(pathB, { [pathB]: [] });
    const merged = JSON.parse(mergeProjectScopedPersistedState(JSON.stringify(current), next));
    expect(merged.state.projectWorkspaces[pathA]).toEqual({ marker: "workspace-a" });
    expect(merged.state.projectAttentionItems[pathA]).toEqual([{ id: "attention-a" }]);
  });

  it("skips reading and writing an unchanged successful input", () => {
    let saved: string | null = null;
    const getItem = vi.fn(() => saved);
    const setItem = vi.fn((_name: string, value: string) => { saved = value; });
    const storage = createProjectScopedStorage({ getItem, setItem, removeItem: vi.fn() });
    const value = snapshot(pathA, { [pathA]: [{ id: "a" }] });

    storage.setItem("settings", value);
    for (let index = 0; index < 100; index++) storage.setItem("settings", value);

    expect(getItem).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("does not write when merging produces the existing value", () => {
    const value = snapshot(pathA, { [pathA]: [{ id: "a" }] });
    const initial = mergeProjectScopedPersistedState(null, value);
    const current = mergeProjectScopedPersistedState(initial, value);
    const getItem = vi.fn(() => current);
    const setItem = vi.fn();
    const storage = createProjectScopedStorage({ getItem, setItem, removeItem: vi.fn() });

    storage.setItem("settings", value);
    storage.setItem("settings", value);

    expect(getItem).toHaveBeenCalledTimes(1);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("preserves external updates and reads the latest value for a changed input", () => {
    let saved: string | null = null;
    const backend = {
      getItem: vi.fn(() => saved),
      setItem: vi.fn((_name: string, value: string) => { saved = value; }),
      removeItem: vi.fn(() => { saved = null; }),
    };
    const windowA = createProjectScopedStorage(backend);
    const windowB = createProjectScopedStorage(backend);
    const valueA = snapshot(pathA, { [pathA]: [{ id: "a" }] });
    windowA.setItem("settings", valueA);
    windowB.setItem("settings", snapshot(pathB, { [pathA]: [], [pathB]: [{ id: "b" }] }));
    const external = saved;

    windowA.setItem("settings", valueA);
    expect(saved).toBe(external);
    expect(backend.getItem).toHaveBeenCalledTimes(2);
    windowA.setItem("settings", snapshot(pathA, { [pathA]: [], [pathB]: [] }, { [pathA]: [{ id: "a" }] }));

    const result = JSON.parse(saved!);
    expect(result.state.projectSessions[pathA]).toEqual([]);
    expect(result.state.projectSessions[pathB]).toEqual([{ id: "b" }]);
    expect(result.state.projectArchivedSessions[pathA]).toEqual([{ id: "a" }]);
    expect(backend.getItem).toHaveBeenCalledTimes(3);
  });

  it("does not restore external changes or deletions from an unchanged old input", () => {
    let saved: string | null = null;
    const backend = {
      getItem: vi.fn(() => saved),
      setItem: vi.fn((_name: string, value: string) => { saved = value; }),
      removeItem: vi.fn(() => { saved = null; }),
    };
    const storage = createProjectScopedStorage(backend);
    const stale = snapshot(pathA, { [pathA]: [{ id: "old" }] });
    storage.setItem("settings", stale);
    saved = snapshot(pathA, { [pathA]: [] });
    expect(storage.getItem("settings")).toBe(saved);
    storage.setItem("settings", stale);
    expect(JSON.parse(saved).state.projectSessions[pathA]).toEqual([]);

    saved = null;
    expect(storage.getItem("settings")).toBeNull();
    storage.setItem("settings", stale);
    expect(saved).toBeNull();
    storage.setItem("settings", snapshot(pathA, { [pathA]: [{ id: "new" }] }));
    expect(JSON.parse(saved!).state.projectSessions[pathA]).toEqual([{ id: "new" }]);
  });

  it("clears successful input only after removing the key successfully", () => {
    let saved: string | null = null;
    const removeError = new Error("remove failed");
    const removeItem = vi.fn(() => { saved = null; });
    const setItem = vi.fn((_name: string, value: string) => { saved = value; });
    const storage = createProjectScopedStorage({ getItem: () => saved, setItem, removeItem });
    const value = snapshot(pathA, { [pathA]: [] });
    storage.setItem("settings", value);
    removeItem.mockImplementationOnce(() => { throw removeError; });

    expect(() => storage.removeItem("settings")).toThrow(removeError);
    storage.setItem("settings", value);
    expect(setItem).toHaveBeenCalledTimes(1);
    storage.removeItem("settings");
    storage.setItem("settings", value);
    expect(setItem).toHaveBeenCalledTimes(2);
  });

  it("propagates read and write errors and retries the same input", () => {
    let saved: string | null = null;
    const readError = new Error("read failed");
    const writeError = new Error("write failed");
    const getItem = vi.fn(() => saved);
    const setItem = vi.fn((_name: string, value: string) => { saved = value; });
    const storage = createProjectScopedStorage({ getItem, setItem, removeItem: vi.fn() });
    const value = snapshot(pathA, { [pathA]: [] });
    getItem.mockImplementationOnce(() => { throw readError; });
    expect(() => storage.setItem("settings", value)).toThrow(readError);
    setItem.mockImplementationOnce(() => { throw writeError; });
    expect(() => storage.setItem("settings", value)).toThrow(writeError);

    expect(storage.setItem("settings", value)).toBeUndefined();
    expect(getItem).toHaveBeenCalledTimes(3);
    expect(setItem).toHaveBeenCalledTimes(2);
    storage.setItem("settings", value);
    expect(getItem).toHaveBeenCalledTimes(3);
  });

  it("serializes asynchronous writes before later writes and reads", async () => {
    let saved: string | null = null;
    let releaseWrite: () => void = () => {};
    let notifyStarted: () => void = () => {};
    const blocked = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const getItem = vi.fn(async () => saved);
    const setItem = vi.fn(async (_name: string, value: string) => {
      notifyStarted();
      await blocked;
      saved = value;
    });
    const storage = createProjectScopedStorage({ getItem, setItem, removeItem: vi.fn() });
    const first = storage.setItem("settings", snapshot(pathA, { [pathA]: [{ id: "first" }] }));
    const second = storage.setItem("settings", snapshot(pathB, { [pathB]: [{ id: "second" }] }));
    const read = storage.getItem("settings");
    await started;
    expect(getItem).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledTimes(1);
    releaseWrite();
    await Promise.all([first, second]);

    const result = JSON.parse((await read)!);
    expect(result.state.projectSessions[pathA]).toEqual([{ id: "first" }]);
    expect(result.state.projectSessions[pathB]).toEqual([{ id: "second" }]);
    expect(getItem).toHaveBeenCalledTimes(3);
  });

  it("deduplicates identical inputs queued before an asynchronous write completes", async () => {
    let saved: string | null = null;
    const getItem = vi.fn(async () => saved);
    const setItem = vi.fn(async (_name: string, value: string) => { saved = value; });
    const storage = createProjectScopedStorage({ getItem, setItem, removeItem: vi.fn() });
    const value = snapshot(pathA, { [pathA]: [] });

    await Promise.all([storage.setItem("settings", value), storage.setItem("settings", value)]);

    expect(getItem).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("propagates asynchronous read errors and lets the next input retry", async () => {
    let saved: string | null = null;
    const error = new Error("async read failed");
    const getItem = vi.fn(async () => saved);
    getItem.mockRejectedValueOnce(error);
    const setItem = vi.fn(async (_name: string, value: string) => { saved = value; });
    const storage = createProjectScopedStorage({ getItem, setItem, removeItem: vi.fn() });
    const value = snapshot(pathA, { [pathA]: [] });
    const failed = storage.setItem("settings", value);
    const retry = storage.setItem("settings", value);

    await expect(failed).rejects.toThrow(error);
    await retry;
    expect(getItem).toHaveBeenCalledTimes(2);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("retries a queued identical input after an asynchronous write failure", async () => {
    let saved: string | null = null;
    const error = new Error("async write failed");
    const getItem = vi.fn(async () => saved);
    const setItem = vi.fn(async (_name: string, value: string) => { saved = value; });
    setItem.mockRejectedValueOnce(error);
    const storage = createProjectScopedStorage({ getItem, setItem, removeItem: vi.fn() });
    const value = snapshot(pathA, { [pathA]: [] });
    const failed = storage.setItem("settings", value);
    const retry = storage.setItem("settings", value);

    await expect(failed).rejects.toThrow(error);
    await retry;
    await storage.setItem("settings", value);
    expect(getItem).toHaveBeenCalledTimes(2);
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(saved).not.toBeNull();
  });

  it("serializes asynchronous removal before accepting the same input again", async () => {
    let saved: string | null = null;
    const setItem = vi.fn(async (_name: string, value: string) => { saved = value; });
    const storage = createProjectScopedStorage({
      getItem: async () => saved,
      setItem,
      removeItem: async () => { saved = null; },
    });
    const value = snapshot(pathA, { [pathA]: [{ id: "a" }] });
    await storage.setItem("settings", value);
    const removal = storage.removeItem("settings");
    const nextWrite = storage.setItem("settings", value);
    await Promise.all([removal, nextWrite]);

    expect(setItem).toHaveBeenCalledTimes(2);
    expect(JSON.parse(saved!).state.projectSessions[pathA]).toEqual([{ id: "a" }]);
  });

  it("preserves successful input after asynchronous removal fails", async () => {
    let saved: string | null = null;
    const error = new Error("async remove failed");
    const getItem = vi.fn(async () => saved);
    const setItem = vi.fn(async (_name: string, value: string) => { saved = value; });
    const removeItem = vi.fn(async () => { saved = null; });
    const storage = createProjectScopedStorage({ getItem, setItem, removeItem });
    const value = snapshot(pathA, { [pathA]: [] });
    await storage.setItem("settings", value);
    removeItem.mockRejectedValueOnce(error);

    await expect(storage.removeItem("settings")).rejects.toThrow(error);
    await storage.setItem("settings", value);
    expect(getItem).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(saved).not.toBeNull();
  });
});

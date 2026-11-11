import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFileDocument, findFileDocument, getFileDocument, retainFileDocument, getUnsavedFileDocuments } from "./fileDocument";
import { inspectProjectFile, readProjectFile, writeProjectFile } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  inspectProjectFile: vi.fn(), readProjectFile: vi.fn(), writeProjectFile: vi.fn(),
  readProjectImage: vi.fn(), readProjectPdf: vi.fn(),
}));

const project = "D:/repo";
const path = "D:/repo/report.md";
let disk: string;
let mtime: number;
const status = () => ({ path, name: "report.md", kind: "text" as const, readOnly: false, sizeBytes: disk.length, largeFile: false, modifiedAtMs: mtime });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  disk = "original";
  mtime = 1;
  vi.mocked(inspectProjectFile).mockImplementation(async () => status());
  vi.mocked(readProjectFile).mockImplementation(async () => ({ ...status(), content: disk, encoding: "utf-8" }));
  vi.mocked(writeProjectFile).mockImplementation(async (_project, _path, content) => { disk = content; mtime += 1; });
});

describe("shared file documents", () => {
  it("sends the exact disk baseline to the backend even when the preview strips ANSI", async () => {
    disk = "\u001b[31moriginal\u001b[0m";
    const document = createFileDocument(project, path);
    await document.load();
    document.setContent("local edit");
    expect(await document.save()).toBe(true);
    expect(writeProjectFile).toHaveBeenCalledWith(project, path, "local edit", "utf-8",
      { content: "\u001b[31moriginal\u001b[0m", encoding: "utf-8" });
  });

  it("keeps local edits and marks a conflict when the backend rejects a stale write", async () => {
    const document = createFileDocument(project, path);
    await document.load();
    document.setContent("local edit");
    vi.mocked(writeProjectFile).mockRejectedValueOnce("file-write-conflict");
    expect(await document.save()).toBe(false);
    expect(document.store.getState()).toMatchObject({ content: "local edit", savedContent: "original", conflict: true, error: null });
    expect(disk).toBe("original");
  });

  it("checks the current disk baseline even for an explicit overwrite", async () => {
    const document = createFileDocument(project, path);
    await document.load();
    document.setContent("local edit");
    disk = "external edit";
    mtime++;
    expect(await document.save(true)).toBe(true);
    expect(writeProjectFile).toHaveBeenCalledWith(project, path, "local edit", "utf-8",
      { content: "external edit", encoding: "utf-8" });
  });

  it("includes auxiliary and unmounted dirty documents in the close registry", async () => {
    const document = getFileDocument(project, "D:/repo/close-registry.md");
    await document.load();
    document.setContent("unmounted draft");
    expect(getUnsavedFileDocuments()).toContainEqual({ projectPath: project, path: "D:/repo/close-registry.md", document });
    await document.save();
    expect(getUnsavedFileDocuments().some((item) => item.document === document)).toBe(false);
  });

  it("shares unsaved edits across Windows path spellings and deduplicates loads", async () => {
    const first = getFileDocument(project, path);
    const second = getFileDocument("d:\\REPO\\", "d:\\repo\\REPORT.md");
    expect(first).toBe(second);
    await Promise.all([first.load(), second.load()]);
    expect(readProjectFile).toHaveBeenCalledTimes(1);
    first.setContent("edited");
    expect(second.store.getState().content).toBe("edited");
    expect(second.store.getState().savedContent).toBe("original");
  });

  it("verifies saved content without reloading the editor or showing a loading screen", async () => {
    const document = createFileDocument(project, path);
    await document.load();
    document.setContent("saved");
    const states: boolean[] = [];
    const unsubscribe = document.store.subscribe((state) => states.push(state.loading));
    expect(await document.save()).toBe(true);
    await document.refresh();
    expect(document.store.getState()).toMatchObject({ content: "saved", savedContent: "saved", status: { modifiedAtMs: 2 } });
    expect(readProjectFile).toHaveBeenCalledTimes(2);
    expect(states).not.toContain(true);
    unsubscribe();
  });

  it("drains edits made during an in-flight save, even without another mounted view", async () => {
    const document = createFileDocument(project, path);
    await document.load();
    const write = deferred<void>();
    vi.mocked(writeProjectFile).mockImplementationOnce(async (_project, _path, content) => {
      await write.promise;
      disk = content;
      mtime += 1;
    });
    document.setContent("first edit");
    const saving = document.save();
    await Promise.resolve();
    document.setContent("latest edit");
    const alsoSaving = document.save();
    write.resolve();
    expect(await saving).toBe(true);
    expect(await alsoSaving).toBe(true);
    expect(disk).toBe("latest edit");
    expect(writeProjectFile).toHaveBeenCalledTimes(2);
    expect(document.store.getState().savedContent).toBe("latest edit");
  });

  it("preserves dirty edits on external changes and requires an explicit overwrite", async () => {
    const document = createFileDocument(project, path);
    await document.load();
    document.setContent("my edits");
    disk = "external edits";
    mtime += 1;
    await document.refresh();
    expect(document.store.getState()).toMatchObject({ conflict: true, content: "my edits" });
    expect(await document.save()).toBe(false);
    expect(writeProjectFile).not.toHaveBeenCalled();
    expect(await document.save(true)).toBe(true);
    expect(disk).toBe("my edits");
    expect(document.store.getState().conflict).toBe(false);
  });

  it("checks for external changes immediately before saving", async () => {
    const document = createFileDocument(project, path);
    await document.load();
    document.setContent("my edits");
    mtime += 1;
    expect(await document.save()).toBe(false);
    expect(writeProjectFile).not.toHaveBeenCalled();
    expect(document.store.getState().conflict).toBe(true);
  });

  it("does not adopt an external edit's version after writing", async () => {
    const document = createFileDocument(project, path);
    await document.load();
    document.setContent("my edit");
    vi.mocked(writeProjectFile).mockImplementationOnce(async () => {
      disk = "external edit after write";
      mtime += 2;
    });
    expect(await document.save()).toBe(false);
    expect(document.store.getState()).toMatchObject({
      content: "my edit", savedContent: "original", conflict: true, status: { modifiedAtMs: 1 },
    });
    await document.refresh();
    expect(await document.save()).toBe(false);
    expect(writeProjectFile).toHaveBeenCalledTimes(1);
    expect(disk).toBe("external edit after write");
    expect(await document.save(true)).toBe(true);
    expect(disk).toBe("my edit");
  });

  it("stops draining newer edits when post-write verification finds a conflict", async () => {
    const document = createFileDocument(project, path);
    await document.load();
    document.setContent("first edit");
    vi.mocked(writeProjectFile).mockImplementationOnce(async () => {
      document.setContent("latest local edit");
      disk = "external edit";
      mtime += 2;
    });
    expect(await document.save()).toBe(false);
    expect(writeProjectFile).toHaveBeenCalledTimes(1);
    expect(document.store.getState()).toMatchObject({ content: "latest local edit", conflict: true });
  });

  it("does not mark a write saved if its verification read fails", async () => {
    const document = createFileDocument(project, path);
    await document.load();
    document.setContent("my edit");
    vi.mocked(readProjectFile).mockRejectedValueOnce(new Error("verification failed"));
    expect(await document.save()).toBe(false);
    expect(document.store.getState()).toMatchObject({ savedContent: "original", error: "verification failed", status: { modifiedAtMs: 1 } });
  });

  it("does not absorb an external edit occurring after the verification read", async () => {
    const document = createFileDocument(project, path);
    await document.load();
    document.setContent("my edit");
    vi.mocked(readProjectFile).mockImplementationOnce(async () => {
      const verified = { ...status(), content: disk, encoding: "utf-8" };
      disk = "later external edit";
      mtime += 1;
      return verified;
    });
    expect(await document.save()).toBe(true);
    await document.refresh();
    expect(document.store.getState()).toMatchObject({ content: "later external edit", savedContent: "later external edit" });
  });

  it("cancels a save awaiting its preflight when changes are discarded", async () => {
    const document = createFileDocument(project, path);
    await document.load();
    document.setContent("discard me");
    const check = deferred<Awaited<ReturnType<typeof inspectProjectFile>>>();
    vi.mocked(inspectProjectFile).mockReturnValueOnce(check.promise);
    const saving = document.save();
    const discarding = document.discardChanges();
    check.resolve(status());
    expect(await saving).toBe(false);
    await discarding;
    expect(writeProjectFile).not.toHaveBeenCalled();
    expect(document.store.getState()).toMatchObject({ content: "original", savedContent: "original", autoSavePaused: false });
  });

  it("stops an in-flight write from draining edits after discard", async () => {
    const document = createFileDocument(project, path);
    await document.load();
    const write = deferred<void>();
    vi.mocked(writeProjectFile).mockImplementationOnce(async (_project, _path, content) => {
      await write.promise;
      disk = content;
      mtime += 1;
    });
    document.setContent("already submitted");
    const saving = document.save();
    await Promise.resolve();
    document.setContent("discard me");
    const discarding = document.discardChanges();
    write.resolve();
    await saving;
    await discarding;
    expect(writeProjectFile).toHaveBeenCalledTimes(1);
    expect(document.store.getState()).toMatchObject({ content: "already submitted", savedContent: "already submitted", saving: false });
  });

  it("deduplicates concurrent refreshes from both hosts", async () => {
    const document = createFileDocument(project, path);
    await document.load();
    vi.mocked(inspectProjectFile).mockClear();
    const check = deferred<Awaited<ReturnType<typeof inspectProjectFile>>>();
    vi.mocked(inspectProjectFile).mockReturnValueOnce(check.promise);
    const first = document.refresh();
    const second = document.refresh();
    check.resolve(status());
    await Promise.all([first, second]);
    expect(inspectProjectFile).toHaveBeenCalledTimes(1);
  });

  it("refreshes a clean document in place and supports discarding edits explicitly", async () => {
    const document = createFileDocument(project, path);
    await document.load();
    disk = "external";
    mtime += 1;
    await document.refresh();
    expect(document.store.getState()).toMatchObject({ content: "external", loading: false });
    document.setContent("unsaved");
    await document.load(true);
    expect(document.store.getState()).toMatchObject({ content: "external", savedContent: "external", conflict: false });
  });

  it("does not overwrite typing that occurs during a background read", async () => {
    const document = createFileDocument(project, path);
    await document.load();
    const read = deferred<Awaited<ReturnType<typeof readProjectFile>>>();
    vi.mocked(readProjectFile).mockReturnValueOnce(read.promise);
    const loading = document.load();
    await Promise.resolve();
    document.setContent("typed while reading");
    read.resolve({ ...status(), content: "stale disk", encoding: "utf-8" });
    await loading;
    expect(document.store.getState().content).toBe("typed while reading");
  });

  it("retains edits and surfaces failed writes", async () => {
    const document = createFileDocument(project, path);
    await document.load();
    document.setContent("keep me");
    vi.mocked(writeProjectFile).mockRejectedValueOnce(new Error("disk full"));
    expect(await document.save()).toBe(false);
    expect(document.store.getState()).toMatchObject({ content: "keep me", savedContent: "original", error: "disk full", saving: false });
  });

  it("releases clean documents after handoff while retaining unsaved ones", async () => {
    vi.useFakeTimers();
    try {
      const clean = getFileDocument(project, "D:/repo/clean.md");
      await clean.load();
      const release = retainFileDocument(project, "D:/repo/clean.md");
      release();
      expect(getFileDocument(project, "D:/repo/clean.md")).toBe(clean);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(getFileDocument(project, "D:/repo/clean.md")).not.toBe(clean);
      const dirty = getFileDocument(project, "D:/repo/dirty.md");
      await dirty.load();
      dirty.setContent("unsaved");
      retainFileDocument(project, "D:/repo/dirty.md")();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(getFileDocument(project, "D:/repo/dirty.md")).toBe(dirty);
    } finally { vi.useRealTimers(); }
  });

  it("releases a closed document after a load outlasts its handoff deadline", async () => {
    vi.useFakeTimers();
    try {
      const filePath = "D:/repo/slow-load-cleanup.md";
      const document = getFileDocument(project, filePath);
      const release = retainFileDocument(project, filePath);
      const read = deferred<Awaited<ReturnType<typeof readProjectFile>>>();
      vi.mocked(readProjectFile).mockReturnValueOnce(read.promise);
      const loading = document.load();
      await Promise.resolve();
      release();
      await vi.advanceTimersByTimeAsync(30_001);
      expect(findFileDocument(project, filePath)).toBe(document);

      read.resolve({ ...status(), content: "late content", encoding: "utf-8" });
      await loading;

      expect(document.store.getState()).toMatchObject({ loading: false, content: "late content" });
      expect(findFileDocument(project, filePath)).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("releases a closed document after a slow save completes without losing its edit", async () => {
    vi.useFakeTimers();
    try {
      const filePath = "D:/repo/slow-save-cleanup.md";
      const document = getFileDocument(project, filePath);
      await document.load();
      const release = retainFileDocument(project, filePath);
      const write = deferred<void>();
      vi.mocked(writeProjectFile).mockImplementationOnce(async (_project, _path, content) => {
        await write.promise;
        disk = content;
        mtime += 1;
      });
      document.setContent("save before eviction");
      const saving = document.save();
      release();
      await vi.advanceTimersByTimeAsync(30_001);
      expect(findFileDocument(project, filePath)).toBe(document);

      write.resolve();
      expect(await saving).toBe(true);
      expect(disk).toBe("save before eviction");
      expect(findFileDocument(project, filePath)).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("waits for an in-flight background refresh even when loading is false", async () => {
    vi.useFakeTimers();
    try {
      const filePath = "D:/repo/slow-refresh-cleanup.md";
      const document = getFileDocument(project, filePath);
      await document.load();
      const release = retainFileDocument(project, filePath);
      const check = deferred<Awaited<ReturnType<typeof inspectProjectFile>>>();
      vi.mocked(inspectProjectFile).mockReturnValueOnce(check.promise);
      const refreshing = document.refresh();
      release();
      await vi.advanceTimersByTimeAsync(30_001);
      expect(document.store.getState().loading).toBe(false);
      expect(findFileDocument(project, filePath)).toBe(document);

      check.resolve(status());
      await refreshing;
      expect(findFileDocument(project, filePath)).toBeUndefined();
    } finally { vi.useRealTimers(); }
  });

  it("keeps closed drafts until they become clean and then reclaims them without polling", async () => {
    vi.useFakeTimers();
    try {
      const filePath = "D:/repo/draft-cleanup.md";
      const document = getFileDocument(project, filePath);
      await document.load();
      const release = retainFileDocument(project, filePath);
      document.setContent("unsaved draft");
      release();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(findFileDocument(project, filePath)).toBe(document);
      expect(vi.getTimerCount()).toBe(0);

      document.setContent(document.store.getState().savedContent);
      expect(findFileDocument(project, filePath)).toBeUndefined();
    } finally { vi.useRealTimers(); }
  });

  it("cancels cleanup on a host handoff and makes each release idempotent", async () => {
    vi.useFakeTimers();
    try {
      const filePath = "D:/repo/reopened-cleanup.md";
      const document = getFileDocument(project, filePath);
      await document.load();
      const releaseFirst = retainFileDocument(project, filePath);
      releaseFirst();
      await vi.advanceTimersByTimeAsync(29_999);
      const releaseSecond = retainFileDocument(project, filePath);
      releaseFirst();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(findFileDocument(project, filePath)).toBe(document);

      releaseSecond();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(findFileDocument(project, filePath)).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});

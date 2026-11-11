import { beforeEach, expect, it } from "vitest";
import { useGitConflictDraftStore } from "./gitConflictDraft";

beforeEach(() => useGitConflictDraftStore.setState({ drafts: {}, busy: {} }));

it("admits only one conflict operation per worktree until it finishes", () => {
  const store = useGitConflictDraftStore.getState();
  expect(store.setOperationBusy("a", true)).toBe(true);
  expect(store.setOperationBusy("a", true)).toBe(false);
  expect(store.setOperationBusy("b", true)).toBe(true);
  store.setOperationBusy("a", false);
  expect(store.setOperationBusy("a", true)).toBe(true);
});

it("keeps separate file drafts and preserves their original revision until explicit reload", () => {
  const store = useGitConflictDraftStore.getState();
  const detail = { revision: "old", filePath: "a", hasConflict: true, mergedContent: "markers", baseContent: "base", oursContent: "a", theirsContent: "b" };
  store.setDraft("project-a", detail);
  store.setDraft("project-b", { ...detail, revision: "other" });
  store.setResult("project-a", "edited");
  expect(useGitConflictDraftStore.getState().drafts["project-a"]).toMatchObject({ result: "edited", initialResult: "markers", detail: { revision: "old" } });
  expect(useGitConflictDraftStore.getState().drafts["project-b"].result).toBe("markers");
  store.setDraft("project-a", { ...detail, revision: "new", mergedContent: "disk" });
  expect(useGitConflictDraftStore.getState().drafts["project-a"].result).toBe("disk");
  store.clearDraft("project-a");
  expect(useGitConflictDraftStore.getState().drafts["project-a"]).toBeUndefined();
});

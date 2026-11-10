import { beforeEach, expect, it, vi } from "vitest";
import { discardWorkspaceDocuments, flushWorkspaceDocuments, pauseWorkspaceDocumentAutoSave } from "./workspaceClose";

interface PendingDocument {
  path: string;
  unsaved: boolean;
  document: { save: () => Promise<boolean>; discardChanges: () => Promise<void>; pauseAutoSave: () => () => void };
}
const mocks = vi.hoisted(() => ({ documents: [] as PendingDocument[] }));
vi.mock("@/lib/fileDocument", () => ({ getUnsavedFileDocuments: () => mocks.documents.filter((entry) => entry.unsaved) }));

function addDocument(path: string) {
  const entry: PendingDocument = { path, unsaved: true, document: {
    save: vi.fn(async () => { entry.unsaved = false; return true; }),
    discardChanges: vi.fn(async () => { entry.unsaved = false; }),
    pauseAutoSave: vi.fn(() => vi.fn()),
  } };
  mocks.documents.push(entry);
  return entry;
}
beforeEach(() => { mocks.documents = []; });

it("waits for main, auxiliary and detached registry documents to finish saving", async () => {
  const main = addDocument("main.md");
  const auxiliary = addDocument("auxiliary.md");
  let finish!: () => void;
  const writing = addDocument("already-saving.md");
  writing.document.save = vi.fn(() => new Promise<boolean>((resolve) => {
    finish = () => { writing.unsaved = false; resolve(true); };
  }));
  let finished = false;
  const closing = flushWorkspaceDocuments().then((value) => { finished = true; return value; });
  await Promise.resolve();
  expect(finished).toBe(false);
  finish();
  expect(await closing).toEqual([]);
  expect(main.document.save).toHaveBeenCalledOnce();
  expect(auxiliary.document.save).toHaveBeenCalledOnce();
});

it("reports conflicts, rejected writes and documents edited during a save", async () => {
  const conflict = addDocument("conflict.md");
  const failure = addDocument("failure.md");
  conflict.document.save = vi.fn(async () => false);
  failure.document.save = vi.fn(async () => { addDocument("new-draft.md"); throw new Error("read-only disk"); });
  expect(await flushWorkspaceDocuments()).toEqual(["conflict.md", "failure.md", "new-draft.md"]);
});

it("only discards registry drafts after an explicit discard decision", async () => {
  const entry = addDocument("draft.md");
  const resume = pauseWorkspaceDocumentAutoSave();
  expect(entry.document.pauseAutoSave).toHaveBeenCalledOnce();
  expect(entry.document.discardChanges).not.toHaveBeenCalled();
  expect(await discardWorkspaceDocuments()).toEqual([]);
  expect(entry.document.discardChanges).toHaveBeenCalledOnce();
  resume();
});

it("keeps failed discard operations blocking close", async () => {
  const entry = addDocument("draft.md");
  entry.document.discardChanges = vi.fn(async () => { throw new Error("write still pending"); });
  expect(await discardWorkspaceDocuments()).toEqual(["draft.md"]);
});

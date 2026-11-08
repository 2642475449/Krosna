// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useFileDocument } from "./useFileDocument";
import { getFileDocument } from "@/lib/fileDocument";
import { inspectProjectFile, readProjectFile, writeProjectFile } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  inspectProjectFile: vi.fn(), readProjectFile: vi.fn(), writeProjectFile: vi.fn(),
  readProjectImage: vi.fn(), readProjectPdf: vi.fn(),
}));

let root: Root;
let host: HTMLDivElement;
let project: string;
let path: string;
let disk: string;
let mtime: number;
let sequence = 0;
function View({ active = true }: { active?: boolean }) {
  const state = useFileDocument(project, path, active);
  return createElement("pre", null, state.content);
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  project = `D:/hook-discard-${++sequence}`;
  path = `${project}/file.txt`;
  disk = "original";
  mtime = 1;
  const status = () => ({ path, name: "file.txt", kind: "text" as const, readOnly: false, largeFile: false, sizeBytes: disk.length, modifiedAtMs: mtime });
  vi.mocked(inspectProjectFile).mockImplementation(async () => status());
  vi.mocked(readProjectFile).mockImplementation(async () => ({ ...status(), content: disk, encoding: "utf-8" }));
  vi.mocked(writeProjectFile).mockImplementation(async (_project, _path, content) => { disk = content; mtime += 1; });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("pauses timers and blur saves during a close decision and resumes on cancel", async () => {
  await act(async () => root.render(createElement(View)));
  const document = getFileDocument(project, path);
  let resume!: () => void;
  await act(async () => {
    document.setContent("keep after cancel");
    resume = document.pauseAutoSave();
  });
  await act(async () => {
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(writeProjectFile).not.toHaveBeenCalled();
  await act(async () => resume());
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(disk).toBe("keep after cancel");
});

it("does not save discarded edits during unmount or restore them on reopen", async () => {
  await act(async () => root.render(createElement(View)));
  const document = getFileDocument(project, path);
  await act(async () => {
    document.setContent("discard me");
    const resume = document.pauseAutoSave();
    await document.discardChanges();
    resume();
  });
  await act(async () => root.render(null));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(writeProjectFile).not.toHaveBeenCalled();
  await act(async () => root.render(createElement(View)));
  expect(host.textContent).toBe("original");
  expect(getFileDocument(project, path)).toBe(document);
});

it("discards conflicted edits in the same shared document for both hosts", async () => {
  await act(async () => root.render(createElement("div", null, createElement(View), createElement(View))));
  const document = getFileDocument(project, path);
  await act(async () => {
    document.setContent("discard me");
    disk = "external edit";
    mtime += 1;
    await document.refresh();
  });
  expect(document.store.getState().conflict).toBe(true);
  await act(async () => document.discardChanges());
  expect(Array.from(host.querySelectorAll("pre"), item => item.textContent)).toEqual(["external edit", "external edit"]);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(writeProjectFile).not.toHaveBeenCalled();
  expect(document.store.getState().conflict).toBe(false);
});

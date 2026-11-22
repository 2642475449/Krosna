// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { searchProjectEntries } from "@/lib/api";
import type { FileTreeEntry } from "@/types";
import { useProjectEntrySearch } from "./useProjectEntrySearch";

vi.mock("@/lib/api", () => ({ searchProjectEntries: vi.fn() }));

let root: Root;
let state: ReturnType<typeof useProjectEntrySearch>;
function Probe({ project, query }: { project?: string; query: string }) {
  state = useProjectEntrySearch(project, query);
  return null;
}

function render(project: string | undefined, query: string) {
  return act(async () => root.render(createElement(Probe, { project, query })));
}

function nextReply() {
  let resolve!: (entries: FileTreeEntry[]) => void;
  vi.mocked(searchProjectEntries).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  return async (...paths: string[]) => act(async () => resolve(paths.map((path) => ({
    kind: "file", path, name: path.split("/").pop()!, hasChildren: false,
  }))));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(searchProjectEntries).mockReset();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("starts immediately, filters existing paths and coalesces a burst to the latest query", async () => {
  const first = nextReply();
  const second = nextReply();
  const latest = nextReply();
  await render("/repo", "s");
  expect(searchProjectEntries).toHaveBeenCalledWith("/repo", "s");
  await first("/repo/src/Builder.ts", "/repo/spec.ts");
  await render("/repo", "sb");
  expect(state.entries.map((item) => item.name)).toEqual(["Builder.ts"]);
  expect(state.showLoading).toBe(false);
  await render("/repo", "sbu");
  await render("/repo", "sbui");
  expect(searchProjectEntries).toHaveBeenCalledTimes(2);
  await second("/repo/obsolete.ts");
  expect(searchProjectEntries).toHaveBeenLastCalledWith("/repo", "sbui");
  expect(state.entries.map((item) => item.name)).toEqual(["Builder.ts"]);
  await latest("/repo/src/Builder.ts", "/repo/src/BuildTests.ts");
  expect(state.entries).toHaveLength(2);
  expect(state.pending).toBe(false);
});

it("delays only loading feedback and isolates project changes, closing and failures", async () => {
  const old = nextReply();
  const other = nextReply();
  await render("/old", "file");
  expect(state.showLoading).toBe(false);
  await act(async () => vi.advanceTimersByTime(200));
  expect(state.showLoading).toBe(true);
  await render("/new", "file");
  expect(searchProjectEntries).toHaveBeenLastCalledWith("/new", "file");
  await old("/old/file.ts");
  expect(state.entries).toEqual([]);
  await render(undefined, "file");
  await other("/new/file.ts");
  expect(state.entries).toEqual([]);
  vi.mocked(searchProjectEntries).mockRejectedValueOnce(new Error("search-index-unavailable"));
  await render("/new", "file");
  expect(state.failed).toBe(true);
  expect(state.pending).toBe(false);
  expect(state.showLoading).toBe(false);
});

it("keeps the original input pending across the native catalog timeout", async () => {
  let timeout!: (reason: string) => void;
  vi.mocked(searchProjectEntries).mockReturnValueOnce(new Promise((_, reject) => { timeout = reject; }));
  const ready = nextReply();
  await render("/repo", "archive.log");
  await act(async () => vi.advanceTimersByTime(30_000));
  await act(async () => timeout("search-index-building"));
  expect(state.pending).toBe(true);
  expect(state.failed).toBe(false);
  await act(async () => vi.advanceTimersByTime(1));
  expect(searchProjectEntries).toHaveBeenCalledTimes(2);
  expect(searchProjectEntries).toHaveBeenLastCalledWith("/repo", "archive.log");
  await ready("/repo/archive.log");
  expect(state.entries.map((entry) => entry.name)).toEqual(["archive.log"]);
  expect(state.pending).toBe(false);
});

it("drops the scheduled catalog retry when the finder closes", async () => {
  vi.mocked(searchProjectEntries).mockRejectedValueOnce("search-index-building");
  await render("/repo", "archive.log");
  await render(undefined, "archive.log");
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(searchProjectEntries).toHaveBeenCalledTimes(1);
  expect(state.pending).toBe(false);
});

// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import GlobalTextSearchDialog from "./GlobalTextSearchDialog";

const ipc = vi.hoisted(() => ({
  search: vi.fn(), enable: vi.fn(), resume: vi.fn(), status: vi.fn(), cancel: vi.fn(),
  project: { path: "/repo", name: "Repo" },
  translate: (key: string) => key,
}));
vi.mock("@/lib/api", () => ({
  searchProjectText: ipc.search, setProjectIndexEnabled: ipc.enable, resumeProjectIndex: ipc.resume,
  getSearchIndexStatus: ipc.status, cancelContentSearch: ipc.cancel,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@/store", () => ({
  useAppStore: (select: (state: unknown) => unknown) => select({ currentProject: ipc.project }),
}));
vi.mock("react-i18next", async (original) => ({
  ...await original<typeof import("react-i18next")>(), useTranslation: () => ({ t: ipc.translate }),
}));
vi.mock("@/lib/toast", () => ({ message: {} }));

let root: Root;
const onClose = () => {};
const render = (open = true) => act(async () =>
  root.render(createElement(GlobalTextSearchDialog, { open, onClose })));
const tick = (ms: number) => act(async () => vi.advanceTimersByTime(ms));
async function enterQuery() {
  await render();
  const input = document.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "登录");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await tick(280);
}
const action = () => Array.from(document.querySelectorAll("button"))
  .find((button) => button.textContent === "globalSearch.enableIndexAndSearch");

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  ipc.search.mockReset();
  ipc.enable.mockReset();
  ipc.resume.mockReset();
  ipc.status.mockReset();
  ipc.project = { path: "/repo", name: "Repo" };
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("enables full text on click, waits during reconciliation and searches the same Chinese word", async () => {
  ipc.search.mockRejectedValueOnce("short-query-index-disabled")
    .mockRejectedValueOnce("short-query-index-waiting")
    .mockResolvedValueOnce({ matchCount: 0, matchedFiles: 0 });
  ipc.enable.mockResolvedValueOnce({});
  await enterQuery();
  expect(action()).toBeDefined();
  expect(ipc.enable).not.toHaveBeenCalled();
  await act(async () => action()!.click());
  expect(ipc.enable).toHaveBeenCalledWith("/repo", true);
  await tick(280);
  expect(action()).toBeUndefined();
  expect(document.body.textContent).toContain("globalSearch.shortQueryIndexWaiting");
  await tick(1500);
  expect(ipc.search.mock.calls.map(([request]) => [request.projectPath, request.query])).toEqual(
    Array(3).fill(["/repo", "登录"]));
  expect(document.body.textContent).toContain("globalSearch.noResults");
});

it("stops a waiting search on close and shows a permanent error without retrying", async () => {
  ipc.search.mockRejectedValueOnce("short-query-index-waiting")
    .mockRejectedValueOnce("short-query-index-unavailable");
  await enterQuery();
  await render(false);
  await tick(2000);
  expect(ipc.search).toHaveBeenCalledTimes(1);
  await render();
  await tick(280);
  expect(document.body.textContent).toContain("globalSearch.shortQueryIndexUnavailable");
  await tick(2000);
  expect(ipc.search).toHaveBeenCalledTimes(2);
  expect(action()).toBeUndefined();
});

it("stops polling a paused index until the user resumes it and repeats the original query", async () => {
  ipc.search.mockRejectedValueOnce("short-query-index-waiting")
    .mockRejectedValueOnce("short-query-index-paused")
    .mockResolvedValueOnce({ matchCount: 0, matchedFiles: 0 });
  await enterQuery();
  await tick(1500);
  expect(document.body.textContent).toContain("globalSearch.shortQueryIndexPaused");
  await tick(15_000);
  expect(ipc.search).toHaveBeenCalledTimes(2);
  expect(ipc.resume).not.toHaveBeenCalled();
  const resume = Array.from(document.querySelectorAll("button"))
    .find((button) => button.textContent === "globalSearch.resumeIndexAndSearch")!;
  await act(async () => resume.click());
  expect(ipc.resume).toHaveBeenCalledWith("/repo");
  expect(ipc.enable).not.toHaveBeenCalled();
  await tick(280);
  expect(ipc.search).toHaveBeenCalledTimes(3);
  expect(ipc.search.mock.calls[2][0]).toMatchObject({ projectPath: "/repo", query: "登录" });
  expect(document.body.textContent).toContain("globalSearch.noResults");
});

it("ignores a late enable response after switching projects", async () => {
  let finish!: () => void;
  ipc.search.mockRejectedValue("short-query-index-disabled");
  ipc.enable.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  await enterQuery();
  await act(async () => action()!.click());
  ipc.project = { name: "Next", path: "/next" };
  await render();
  await tick(280);
  await act(async () => finish());
  await tick(2000);
  expect(ipc.enable).toHaveBeenCalledTimes(1);
  expect(ipc.search.mock.calls.map(([request]) => request.projectPath)).toEqual(["/repo", "/next"]);
  expect(action()).toBeDefined();
});

it("continues a paused search if another view has already resumed indexing", async () => {
  ipc.search.mockRejectedValueOnce("short-query-index-paused")
    .mockResolvedValueOnce({ matchCount: 0, matchedFiles: 0 });
  ipc.resume.mockRejectedValueOnce(new Error("No paused index build is available to resume"));
  ipc.status.mockResolvedValueOnce({ state: "ready" });
  await enterQuery();
  const resume = Array.from(document.querySelectorAll("button"))
    .find((button) => button.textContent === "globalSearch.resumeIndexAndSearch")!;
  await act(async () => resume.click());
  await tick(280);
  expect(ipc.status).toHaveBeenCalledWith("/repo");
  expect(document.body.textContent).toContain("globalSearch.noResults");
});

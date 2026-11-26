import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/api", () => ({ gitListBranches: vi.fn() }));
import { gitListBranches } from "@/lib/api";
import { GIT_BRANCH_CACHE_TTL_MS, useGitBranchesStore } from "./gitBranches";
import type { GitBranchListItem } from "@/types";

const branch = (name: string): GitBranchListItem => ({
  name,
  isCurrent: true,
  isRemote: false,
  upstream: null,
  ahead: 0,
  behind: 0,
});
const deferred = () => {
  let resolve!: (branches: GitBranchListItem[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<GitBranchListItem[]>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const refresh = (path = "A", force = false) =>
  useGitBranchesStore.getState().refresh(path, { force });

beforeEach(() => {
  vi.resetAllMocks();
  useGitBranchesStore.setState({ entries: {} });
  vi.spyOn(Date, "now").mockReturnValue(10_000);
});
afterEach(() => vi.restoreAllMocks());

it("a slow project A response cannot replace project B branches", async () => {
  const pending = deferred();
  vi.mocked(gitListBranches).mockReturnValueOnce(pending.promise);
  const a = refresh("A");
  await Promise.resolve();
  vi.mocked(gitListBranches).mockResolvedValue([branch("B-main")]);
  await refresh("B");
  pending.resolve([branch("A-main")]);
  await a;
  expect(useGitBranchesStore.getState().entries.B.branches[0].name).toBe("B-main");
  expect(useGitBranchesStore.getState().entries.A.branches[0].name).toBe("A-main");
});

it("coalesces concurrent reads for the same project", async () => {
  const pending = deferred();
  vi.mocked(gitListBranches).mockReturnValue(pending.promise);
  const first = refresh();
  const second = refresh();
  expect(second).toBe(first);
  await Promise.resolve();
  expect(gitListBranches).toHaveBeenCalledTimes(1);
  pending.resolve([branch("main")]);
  await Promise.all([first, second]);
});

it("reuses fresh results and keeps the list visible when the cache expires", async () => {
  vi.mocked(gitListBranches).mockResolvedValue([branch("main")]);
  await refresh();
  await refresh();
  expect(gitListBranches).toHaveBeenCalledTimes(1);
  vi.mocked(Date.now).mockReturnValue(10_000 + GIT_BRANCH_CACHE_TTL_MS);
  const pending = deferred();
  vi.mocked(gitListBranches).mockReturnValue(pending.promise);
  const request = refresh();
  expect(useGitBranchesStore.getState().entries.A).toMatchObject({
    branches: [branch("main")], loading: true, updatedAt: 10_000,
  });
  pending.resolve([branch("new")]);
  await request;
  expect(useGitBranchesStore.getState().entries.A.branches).toEqual([branch("new")]);
});

it("caches successful empty results too", async () => {
  vi.mocked(gitListBranches).mockResolvedValue([]);
  await refresh();
  await refresh();
  expect(gitListBranches).toHaveBeenCalledTimes(1);
  expect(useGitBranchesStore.getState().entries.A.updatedAt).toBe(10_000);
});

it.each(["success", "failure"])("a forced post-mutation read ignores an older %s", async (outcome) => {
  const pending = deferred();
  vi.mocked(gitListBranches).mockReturnValueOnce(pending.promise);
  const old = refresh();
  await Promise.resolve();
  vi.mocked(gitListBranches).mockResolvedValue([branch("new")]);
  await refresh("A", true);
  if (outcome === "success") pending.resolve([branch("old")]);
  else pending.reject(new Error("old failure"));
  await old;
  expect(useGitBranchesStore.getState().entries.A).toMatchObject({
    branches: [branch("new")], loading: false, error: null,
  });
});

it("preserves cached results on failure and allows a retry inside the TTL", async () => {
  vi.mocked(gitListBranches).mockResolvedValue([branch("main")]);
  await refresh();
  vi.mocked(gitListBranches).mockRejectedValue(new Error("unreadable"));
  await refresh("A", true);
  expect(useGitBranchesStore.getState().entries.A).toMatchObject({
    branches: [branch("main")], loading: false, updatedAt: 10_000,
    error: expect.stringContaining("unreadable"),
  });
  vi.mocked(gitListBranches).mockResolvedValue([branch("recovered")]);
  await refresh();
  expect(useGitBranchesStore.getState().entries.A).toMatchObject({
    branches: [branch("recovered")], error: null,
  });
  expect(gitListBranches).toHaveBeenCalledTimes(3);
});

it("recovers from a failed initial read", async () => {
  vi.mocked(gitListBranches).mockRejectedValue(new Error("offline"));
  await refresh();
  expect(useGitBranchesStore.getState().entries.A).toMatchObject({
    branches: [], loading: false, updatedAt: null, error: expect.stringContaining("offline"),
  });
  vi.mocked(gitListBranches).mockResolvedValue([branch("main")]);
  await refresh();
  expect(useGitBranchesStore.getState().entries.A.branches).toEqual([branch("main")]);
});

it("an old request cannot clear the newer in-flight request", async () => {
  const oldPending = deferred();
  const newPending = deferred();
  vi.mocked(gitListBranches).mockReturnValueOnce(oldPending.promise);
  const old = refresh();
  await Promise.resolve();
  vi.mocked(gitListBranches).mockReturnValueOnce(newPending.promise);
  const next = refresh("A", true);
  await Promise.resolve();
  oldPending.resolve([branch("old")]);
  await old;
  expect(refresh()).toBe(next);
  expect(useGitBranchesStore.getState().entries.A.loading).toBe(true);
  newPending.resolve([branch("new")]);
  await next;
  expect(gitListBranches).toHaveBeenCalledTimes(2);
});

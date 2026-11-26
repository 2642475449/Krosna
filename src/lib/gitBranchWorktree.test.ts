import { describe, expect, it } from "vitest";
import type { GitBranchListItem } from "@/types";
import { formatWorktreeDisplayPath, partitionGitBranches } from "./gitBranchWorktree";

function createBranch(overrides: Partial<GitBranchListItem> & { name: string }): GitBranchListItem {
  return {
    isCurrent: false,
    isRemote: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    ...overrides,
  };
}

describe("partitionGitBranches", () => {
  const branches: GitBranchListItem[] = [
    createBranch({ name: "main", isCurrent: true }),
    createBranch({ name: "feat/sidebar" }),
    createBranch({
      name: "release/krosna-1.8.38",
      worktreePath: "E:/7.project/test/Termflow/.codex-tmp/r1837",
    }),
    createBranch({ name: "origin/HEAD", isRemote: true }),
    createBranch({ name: "origin/main", isRemote: true }),
  ];

  it("splits local, worktree, and remote branches cleanly and omits remote HEAD", () => {
    const result = partitionGitBranches(branches, "");
    expect(result.localBranches.map((b) => b.name)).toEqual(["main", "feat/sidebar"]);
    expect(result.worktreeBranches.map((b) => b.name)).toEqual(["release/krosna-1.8.38"]);
    expect(result.remoteBranches.map((b) => b.name)).toEqual(["origin/main"]);
    expect(result.canQuickCreate).toBe(false);
  });

  it("matches worktree branches by worktree path as well as branch name", () => {
    const result = partitionGitBranches(branches, "r1837");
    expect(result.localBranches).toEqual([]);
    expect(result.worktreeBranches.map((b) => b.name)).toEqual(["release/krosna-1.8.38"]);
    expect(result.remoteBranches).toEqual([]);
    expect(result.canQuickCreate).toBe(true);
  });

  it("disables quick create when query exactly matches a worktree branch name", () => {
    const result = partitionGitBranches(branches, "release/krosna-1.8.38");
    expect(result.canQuickCreate).toBe(false);
    expect(result.worktreeBranches).toHaveLength(1);
  });
});

describe("formatWorktreeDisplayPath", () => {
  it("returns relative path when worktree is inside the current project", () => {
    expect(
      formatWorktreeDisplayPath(
        "E:/7.project/test/Termflow/.codex-tmp/r1837",
        "E:\\7.project\\test\\Termflow",
      ),
    ).toBe(".codex-tmp/r1837");
  });

  it("handles Windows drive letter case differences", () => {
    expect(
      formatWorktreeDisplayPath(
        "e:/7.project/test/Termflow/.worktrees/hotfix",
        "E:/7.project/test/Termflow/",
      ),
    ).toBe(".worktrees/hotfix");
  });

  it("returns sibling relative path when worktree shares parent folder", () => {
    expect(
      formatWorktreeDisplayPath(
        "E:/7.project/test/Termflow-release",
        "E:/7.project/test/Termflow",
      ),
    ).toBe("../Termflow-release");
  });

  it("falls back to last two segments for unrelated deep paths", () => {
    expect(
      formatWorktreeDisplayPath(
        "D:/worktrees/krosna/release-1.8",
        "E:/7.project/test/Termflow",
      ),
    ).toBe("…/krosna/release-1.8");
  });
});

import type { GitBranchListItem } from "@/types";

export interface PartitionedGitBranches {
  localBranches: GitBranchListItem[];
  worktreeBranches: GitBranchListItem[];
  remoteBranches: GitBranchListItem[];
  canQuickCreate: boolean;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isWindowsDrivePath(path: string): boolean {
  return /^[a-zA-Z]:\//.test(path);
}

function isRemoteHeadBranch(name: string): boolean {
  return /\/HEAD$/.test(name);
}

/**
 * 将分支列表按当前仓库本地分支、其他工作树分支与远程分支分组，并结合筛选词过滤。
 * 自动过滤不可检出的远程符号指针（如 `origin/HEAD`）。
 */
export function partitionGitBranches(
  branches: GitBranchListItem[],
  query: string,
): PartitionedGitBranches {
  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();

  const localBranches: GitBranchListItem[] = [];
  const worktreeBranches: GitBranchListItem[] = [];
  const remoteBranches: GitBranchListItem[] = [];

  for (const branch of branches) {
    if (branch.isRemote) {
      if (isRemoteHeadBranch(branch.name)) {
        continue;
      }
      if (!normalizedQuery || branch.name.toLowerCase().includes(normalizedQuery)) {
        remoteBranches.push(branch);
      }
      continue;
    }

    const worktreePath = branch.worktreePath?.trim() ?? "";
    const matchesQuery =
      !normalizedQuery ||
      branch.name.toLowerCase().includes(normalizedQuery) ||
      (worktreePath.length > 0 && worktreePath.toLowerCase().includes(normalizedQuery));

    if (!matchesQuery) {
      continue;
    }

    if (worktreePath.length > 0) {
      worktreeBranches.push(branch);
    } else {
      localBranches.push(branch);
    }
  }

  const hasExactLocal =
    trimmedQuery.length > 0 &&
    branches.some((b) => !b.isRemote && b.name.toLowerCase() === normalizedQuery);

  return {
    localBranches,
    worktreeBranches,
    remoteBranches,
    canQuickCreate: trimmedQuery.length > 0 && !hasExactLocal && !/\s/.test(trimmedQuery),
  };
}

/**
 * 格式化工作树路径用于紧凑展示：
 * - 位于当前项目内部时显示相对路径（如 `.codex-tmp/r1837`）
 * - 与当前项目同级时显示 `../目录名`
 * - 其他情况仅保留末尾两段目录
 */
export function formatWorktreeDisplayPath(
  worktreePath: string,
  projectPath: string | null | undefined,
): string {
  const normalizedWorktree = normalizePath(worktreePath.trim());
  if (!normalizedWorktree) return "";

  const normalizedProject = projectPath ? normalizePath(projectPath.trim()) : "";
  if (normalizedProject) {
    const caseInsensitive =
      isWindowsDrivePath(normalizedWorktree) || isWindowsDrivePath(normalizedProject);
    const comparableWorktree = caseInsensitive
      ? normalizedWorktree.toLowerCase()
      : normalizedWorktree;
    const comparableProject = caseInsensitive
      ? normalizedProject.toLowerCase()
      : normalizedProject;

    if (comparableWorktree.startsWith(`${comparableProject}/`)) {
      return normalizedWorktree.slice(normalizedProject.length + 1);
    }

    const projectLastSlash = normalizedProject.lastIndexOf("/");
    const worktreeLastSlash = normalizedWorktree.lastIndexOf("/");
    if (projectLastSlash > 0 && worktreeLastSlash > 0) {
      const projectParent = comparableProject.slice(0, projectLastSlash);
      const worktreeParent = comparableWorktree.slice(0, worktreeLastSlash);
      if (projectParent === worktreeParent) {
        return `../${normalizedWorktree.slice(worktreeLastSlash + 1)}`;
      }
    }
  }

  const segments = normalizedWorktree.split("/").filter(Boolean);
  if (segments.length <= 2) {
    return normalizedWorktree;
  }
  return `…/${segments.slice(-2).join("/")}`;
}

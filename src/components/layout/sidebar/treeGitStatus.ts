import type { GitFileStatus, GitStatusType } from "@/types";

const STATUS_PRIORITY: Record<GitStatusType, number> = {
  conflicted: 7,
  modified: 6,
  added: 5,
  untracked: 4,
  renamed: 3,
  typechange: 2,
  deleted: 1,
};

export type TreeGitTone = "modified" | "added" | "deleted" | "conflicted";

export interface TreeGitBadge {
  label: string;
  tone: TreeGitTone;
}

export interface TreeGitStatusIndex {
  files: Map<string, GitStatusType>;
  directories: Map<string, GitStatusType>;
}

export interface VirtualWindow {
  startIndex: number;
  endIndex: number;
  paddingTop: number;
  paddingBottom: number;
}

function normalizeGitTreePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function pickHigherPriorityStatus(
  current: GitStatusType | undefined,
  candidate: GitStatusType
): GitStatusType {
  if (!current) return candidate;
  return STATUS_PRIORITY[candidate] > STATUS_PRIORITY[current] ? candidate : current;
}

/**
 * 构建文件树 Git 状态索引，并将文件变更聚合到所有祖先目录。
 */
export function buildTreeGitStatusIndex(
  projectRootPath: string,
  fileStatuses: GitFileStatus[]
): TreeGitStatusIndex {
  const files = new Map<string, GitStatusType>();
  const directories = new Map<string, GitStatusType>();
  const normalizedRoot = normalizeGitTreePath(projectRootPath);
  if (!normalizedRoot || fileStatuses.length === 0) {
    return { files, directories };
  }

  for (const item of fileStatuses) {
    const relative = item.path.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!relative) continue;

    const fullPath = `${normalizedRoot}/${relative.toLowerCase()}`;
    files.set(fullPath, pickHigherPriorityStatus(files.get(fullPath), item.statusType));

    const segments = relative.toLowerCase().split("/").filter(Boolean);
    let currentDir = normalizedRoot;
    for (let index = 0; index < segments.length - 1; index += 1) {
      currentDir = `${currentDir}/${segments[index]}`;
      directories.set(
        currentDir,
        pickHigherPriorityStatus(directories.get(currentDir), item.statusType)
      );
    }
  }

  return { files, directories };
}

export function getTreeEntryGitStatus(
  index: TreeGitStatusIndex,
  entryPath: string,
  isDirectory: boolean
): GitStatusType | null {
  const normalized = normalizeGitTreePath(entryPath);
  if (!normalized) return null;
  return (isDirectory ? index.directories.get(normalized) : index.files.get(normalized)) ?? null;
}

export function getTreeGitBadge(status: GitStatusType): TreeGitBadge {
  switch (status) {
    case "conflicted":
      return { label: "!", tone: "conflicted" };
    case "deleted":
      return { label: "D", tone: "deleted" };
    case "added":
      return { label: "A", tone: "added" };
    case "untracked":
      return { label: "U", tone: "added" };
    case "renamed":
      return { label: "R", tone: "added" };
    case "typechange":
      return { label: "T", tone: "modified" };
    case "modified":
    default:
      return { label: "M", tone: "modified" };
  }
}

/**
 * 计算虚拟滚动窗口；在列表较短或容器未完成测量（如测试环境）时返回全量范围。
 */
export function computeVirtualWindow(
  totalCount: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 15,
  minVirtualizeCount = 80
): VirtualWindow {
  if (totalCount <= minVirtualizeCount || viewportHeight <= 0 || rowHeight <= 0) {
    return {
      startIndex: 0,
      endIndex: totalCount,
      paddingTop: 0,
      paddingBottom: 0,
    };
  }

  const visibleStart = Math.max(0, Math.floor(scrollTop / rowHeight));
  const visibleEnd = Math.min(totalCount, Math.ceil((scrollTop + viewportHeight) / rowHeight));
  const startIndex = Math.max(0, visibleStart - overscan);
  const endIndex = Math.min(totalCount, visibleEnd + overscan);

  return {
    startIndex,
    endIndex,
    paddingTop: startIndex * rowHeight,
    paddingBottom: Math.max(0, (totalCount - endIndex) * rowHeight),
  };
}

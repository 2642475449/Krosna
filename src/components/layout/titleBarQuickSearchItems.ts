import type { FileTreeEntry, FileTreeEntryKind, GitFileStatus } from "@/types";

export const MAX_DEFAULT_QUICK_SEARCH_ITEMS = 10;
export const MAX_PERSISTED_RECENT_FILES = 20;
const QUICK_SEARCH_RECENT_STORAGE_PREFIX = "krosna:quick-search-recent:";

export interface QuickSearchItem {
  key: string;
  path: string;
  name: string;
  relativePath: string;
  parentPath: string;
  kind: FileTreeEntryKind;
  section: "recent" | "search";
}

export interface OpenFileTabSummary {
  resourceId: string;
  title: string;
  lastActivatedAt: number;
}

export interface BuildDefaultQuickSearchItemsParams {
  projectPath: string;
  openFileTabs: OpenFileTabSummary[];
  recentFilePaths: string[];
  gitStatuses: GitFileStatus[];
  fallbackEntries: FileTreeEntry[];
  limit?: number;
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

export function pathDedupeKey(path: string): string {
  return normalizePath(path).toLocaleLowerCase();
}

export function buildRelativePath(rootPath: string, targetPath: string): string {
  const normalizedRoot = normalizePath(rootPath);
  const normalizedTarget = normalizePath(targetPath);
  const prefix = `${normalizedRoot}/`;
  if (normalizedTarget === normalizedRoot) {
    return ".";
  }
  if (normalizedTarget.startsWith(prefix)) {
    return normalizedTarget.slice(prefix.length);
  }
  return targetPath;
}

export function getParentPath(relativePath: string): string {
  const normalized = normalizePath(relativePath);
  const separatorIndex = normalized.lastIndexOf("/");
  return separatorIndex < 0 ? "." : normalized.slice(0, separatorIndex) || ".";
}

function getBaseName(path: string): string {
  const normalized = normalizePath(path);
  const separatorIndex = normalized.lastIndexOf("/");
  return separatorIndex < 0 ? normalized : normalized.slice(separatorIndex + 1) || normalized;
}

function joinProjectPath(rootPath: string, relativePath: string): string {
  const normalizedRoot = normalizePath(rootPath);
  const normalizedRelative = normalizePath(relativePath).replace(/^\/+/, "");
  return normalizedRelative ? `${normalizedRoot}/${normalizedRelative}` : normalizedRoot;
}

function getStorageKey(projectPath: string): string {
  return `${QUICK_SEARCH_RECENT_STORAGE_PREFIX}${pathDedupeKey(projectPath)}`;
}

function dedupePaths(paths: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawPath of paths) {
    const trimmed = rawPath.trim();
    if (!trimmed) continue;
    const key = pathDedupeKey(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
    if (result.length >= limit) break;
  }
  return result;
}

export function loadRecentQuickSearchPaths(projectPath: string): string[] {
  if (typeof window === "undefined" || !projectPath) return [];
  try {
    const raw = window.localStorage.getItem(getStorageKey(projectPath));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return dedupePaths(
      parsed.filter((item): item is string => typeof item === "string"),
      MAX_PERSISTED_RECENT_FILES
    );
  } catch {
    return [];
  }
}

export function saveRecentQuickSearchPaths(projectPath: string, paths: string[]): void {
  if (typeof window === "undefined" || !projectPath) return;
  try {
    const normalized = dedupePaths(paths, MAX_PERSISTED_RECENT_FILES);
    window.localStorage.setItem(getStorageKey(projectPath), JSON.stringify(normalized));
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

export function recordRecentQuickSearchPaths(
  projectPath: string,
  newPaths: string[],
  existingPaths?: string[]
): string[] {
  const basePaths = existingPaths ?? loadRecentQuickSearchPaths(projectPath);
  const merged = dedupePaths([...newPaths, ...basePaths], MAX_PERSISTED_RECENT_FILES);
  saveRecentQuickSearchPaths(projectPath, merged);
  return merged;
}

function createQuickSearchItem(
  projectPath: string,
  fullPath: string,
  name: string,
  kind: FileTreeEntryKind
): QuickSearchItem {
  const relativePath = buildRelativePath(projectPath, fullPath);
  return {
    key: `recent:${pathDedupeKey(fullPath)}`,
    path: fullPath,
    name,
    relativePath,
    parentPath: getParentPath(relativePath),
    kind,
    section: "recent",
  };
}

export function buildDefaultQuickSearchItems({
  projectPath,
  openFileTabs,
  recentFilePaths,
  gitStatuses,
  fallbackEntries,
  limit = MAX_DEFAULT_QUICK_SEARCH_ITEMS,
}: BuildDefaultQuickSearchItemsParams): QuickSearchItem[] {
  if (!projectPath || limit <= 0) return [];

  const seen = new Set<string>();
  const items: QuickSearchItem[] = [];

  const pushItem = (fullPath: string, name: string, kind: FileTreeEntryKind): boolean => {
    const key = pathDedupeKey(fullPath);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    items.push(createQuickSearchItem(projectPath, fullPath, name, kind));
    return items.length >= limit;
  };

  // 1. Currently open file tabs, most recently activated first
  const sortedTabs = [...openFileTabs].sort(
    (left, right) => right.lastActivatedAt - left.lastActivatedAt
  );
  for (const tab of sortedTabs) {
    if (pushItem(tab.resourceId, tab.title || getBaseName(tab.resourceId), "file")) {
      return items;
    }
  }

  // 2. Persisted recently visited files (survives closing tabs)
  for (const filePath of recentFilePaths) {
    if (pushItem(filePath, getBaseName(filePath), "file")) {
      return items;
    }
  }

  // 3. Active Git changed files (excluding deleted files)
  for (const status of gitStatuses) {
    if (status.statusType === "deleted") continue;
    const fullPath = joinProjectPath(projectPath, status.path);
    if (pushItem(fullPath, getBaseName(fullPath), "file")) {
      return items;
    }
  }

  // 4. Project root fallback entries: non-ignored files first, then remaining files, then directories
  const sortedFallback = [...fallbackEntries].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "file" ? -1 : 1;
    }
    const leftIgnored = Boolean(left.ignored);
    const rightIgnored = Boolean(right.ignored);
    if (leftIgnored !== rightIgnored) {
      return leftIgnored ? 1 : -1;
    }
    return left.name.localeCompare(right.name);
  });

  for (const entry of sortedFallback) {
    if (pushItem(entry.path, entry.name, entry.kind)) {
      return items;
    }
  }

  return items;
}

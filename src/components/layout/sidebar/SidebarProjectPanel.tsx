import { Button, Checkbox, Dropdown, Empty, Input, Modal, Spin, Tooltip, message } from "antd";
import { WorkbenchEmptyArtwork } from "@/components/ui/WorkbenchGlyph";
import type { InputRef, MenuProps } from "antd";
import {
  AimOutlined,
  CompressOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  FileOutlined,
  FolderOpenFilled,
  FolderOutlined,
  HistoryOutlined,
  MinusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ScissorOutlined,
  SnippetsOutlined,
} from "@ant-design/icons";
import { open as openDirectoryDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState, useId } from "react";
import { createPortal } from "react-dom";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import {
  copyExternalEntry,
  copyProjectEntries,
  createProjectDirectory,
  createProjectFile,
  deleteProjectEntry,
  listProjectDirectory,
  moveProjectEntries,
  readClipboardFilePaths,
  renameProjectEntry,
  startExternalFileDrag,
} from "@/lib/api";
import {
  EXPLORER_REVEAL_PATH_EVENT,
  EXPLORER_SELECT_ALL_EVENT,
  takePendingExplorerRevealPath,
} from "@/lib/explorer";
import type { ExplorerRevealPathDetail } from "@/lib/explorer";
import { getFileIcon, type FolderTone } from "@/lib/fileIcon";
import { showWorkbenchFeedback } from "@/lib/workbenchFeedback";
import {
  computeMarqueeRect,
  getRenameSelectionRange,
  getTreeNavigation,
  isPointOutsideViewport,
  mergeMarqueeSelection,
  rectsIntersect,
  resolveInternalDropTarget,
  type MarqueeRect,
} from "./treeNavigation";
import { TreeDisclosure } from "./TreeDisclosure";
import {
  buildTreeGitStatusIndex,
  computeVirtualWindow,
  getTreeEntryGitStatus,
  getTreeGitBadge,
} from "./treeGitStatus";
import { openGlobalTextSearch } from "@/lib/globalSearch";
import { dispatchGitFileHistoryOpen } from "@/lib/gitGraphEvents";
import { useAppStore } from "@/store";
import { useGitStatusStore } from "@/store/slices/gitStatus";
import type { FileTreeEntry, FileTreeListing, GitFileStatus } from "@/types";
import { useTranslation } from "react-i18next";

const EXPANDED_PATHS_STORAGE_KEY = "krosna:explorer-expanded-paths:v1";
const MAX_PERSISTED_EXPANDED_PROJECTS = 20;
const TREE_ROW_HEIGHT = 24;
const EMPTY_GIT_FILE_STATUSES: GitFileStatus[] = [];

type FlatTreeRow =
  | { kind: "inline-create"; key: string; depth: number; inheritedTone?: FolderTone; rowTone?: FolderTone }
  | {
      kind: "node";
      key: string;
      node: ResourceTreeNode;
      depth: number;
      inheritedTone?: FolderTone;
      rowTone?: FolderTone;
      inheritedIgnored?: boolean;
    };

function readPersistedExpandedPaths(projectPath: string): Record<string, boolean> {
  if (!projectPath || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(EXPANDED_PATHS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    const key = projectPath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    const list = parsed?.[key];
    if (!Array.isArray(list)) return {};
    const result: Record<string, boolean> = {};
    for (const item of list) {
      if (typeof item === "string" && item.trim()) {
        result[item] = true;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function writePersistedExpandedPaths(projectPath: string, expanded: Record<string, boolean>): void {
  if (!projectPath || typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(EXPANDED_PATHS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    const key = projectPath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    const nextStore: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(parsed ?? {})) {
      if (k !== key && Array.isArray(v)) {
        nextStore[k] = v;
      }
    }
    const activePaths = Object.keys(expanded).filter((p) => expanded[p]);
    if (activePaths.length > 0) {
      nextStore[key] = activePaths;
    }
    const keys = Object.keys(nextStore);
    if (keys.length > MAX_PERSISTED_EXPANDED_PROJECTS) {
      for (const oldKey of keys.slice(0, keys.length - MAX_PERSISTED_EXPANDED_PROJECTS)) {
        delete nextStore[oldKey];
      }
    }
    window.localStorage.setItem(EXPANDED_PATHS_STORAGE_KEY, JSON.stringify(nextStore));
  } catch {
    // 忽略存储配额或隐私模式异常
  }
}

interface ProjectRef {
  name: string;
  path: string;
}

interface SidebarProjectPanelProps {
  currentProject: ProjectRef | null;
  noProjectText: string;
  panelTitle: string;
  refreshText: string;
  loadingText: string;
  emptyFolderText: string;
  openInManagerText: string;
  openInAssociatedAppText: string;
  copyRelativePathText: string;
  copyAbsolutePathText: string;
  copyPathSuccessText: string;
  onOpenInFileManager: (path: string) => void;
  onOpenInAssociatedApp: (path: string) => void;
  onOpenFile: (path: string, options?: { preview?: boolean }) => void;
}

interface ResourceTreeNode {
  entry: FileTreeEntry;
  isExpanded: boolean;
  isLoadingChildren: boolean;
  children: ResourceTreeNode[];
}

interface InlineCreateState {
  kind: "file" | "directory";
  parentPath: string;
  value: string;
}

interface PendingExternalCopy {
  sourcePaths: string[];
  destinationDirectory: string;
  newName: string;
  openAfterCopy: boolean;
}

type ResourceClipboardOperation = "copy" | "cut";

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

function isPathInsideRoot(rootPath: string, targetPath: string): boolean {
  const normalizedRoot = normalizePath(rootPath);
  const normalizedTarget = normalizePath(targetPath);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
}

function joinPath(base: string, parts: string[]): string {
  const separator = base.includes("\\") ? "\\" : "/";
  const normalizedBase = base.replace(/[\\/]+$/, "");
  if (parts.length === 0) return normalizedBase;
  return [normalizedBase, ...parts].join(separator);
}

function buildRelativePath(rootPath: string, targetPath: string): string {
  const normalizedRoot = normalizePath(rootPath);
  const normalizedTarget = normalizePath(targetPath);
  if (normalizedRoot === normalizedTarget) {
    return ".";
  }

  const prefix = `${normalizedRoot}/`;
  if (normalizedTarget.startsWith(prefix)) {
    return normalizedTarget.slice(prefix.length);
  }

  return targetPath;
}

function getDirectoryPathsToExpand(rootPath: string, targetPath: string, targetIsDirectory: boolean): string[] {
  const normalizedRoot = normalizePath(rootPath);
  const normalizedTarget = normalizePath(targetPath);
  if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(`${normalizedRoot}/`)) {
    return [];
  }

  const relative = normalizedTarget === normalizedRoot ? "" : normalizedTarget.slice(normalizedRoot.length + 1);
  const segments = relative ? relative.split("/").filter(Boolean) : [];
  const directorySegments = targetIsDirectory ? segments : segments.slice(0, -1);

  return directorySegments.map((_, index) =>
    joinPath(rootPath, directorySegments.slice(0, index + 1))
  );
}

function getParentPath(rootPath: string, targetPath: string): string {
  const normalizedRoot = normalizePath(rootPath);
  const normalizedTarget = normalizePath(targetPath);
  if (normalizedTarget === normalizedRoot) {
    return rootPath;
  }

  const trimmed = targetPath.replace(/[\\/]+$/, "");
  const lastSeparatorIndex = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  if (lastSeparatorIndex <= 0) {
    return rootPath;
  }

  const parentPath = trimmed.slice(0, lastSeparatorIndex);
  return normalizePath(parentPath).startsWith(normalizedRoot) ? parentPath : rootPath;
}

function getCreateTargetDirectory(rootPath: string, entry: FileTreeEntry): string {
  return entry.kind === "directory" ? entry.path : getParentPath(rootPath, entry.path);
}

function getDefaultCreateDirectory(
  rootPath: string,
  selectedPath: string | null,
  isSelectedDirectory: boolean
): string {
  if (!selectedPath) {
    return rootPath;
  }

  if (normalizePath(selectedPath) === normalizePath(rootPath) || isSelectedDirectory) {
    return selectedPath;
  }

  return getParentPath(rootPath, selectedPath);
}

function getBaseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function isProbablyFilePath(path: string): boolean {
  const name = getBaseName(path);
  return name.includes(".") && !name.endsWith(".");
}

function getExternalCopyTargetNames(copy: PendingExternalCopy): string[] {
  if (copy.sourcePaths.length === 1) {
    return [copy.newName.trim()];
  }

  return copy.sourcePaths.map((path) => getBaseName(path));
}

function isExplicitExternalCopyRename(copy: PendingExternalCopy): boolean {
  return copy.sourcePaths.length === 1 && copy.newName.trim() !== getBaseName(copy.sourcePaths[0] ?? "");
}

function isInvalidEntryName(name: string): boolean {
  const trimmedName = name.trim();
  return (
    !trimmedName ||
    trimmedName === "." ||
    trimmedName === ".." ||
    /[\\/:*?"<>|]/.test(trimmedName)
  );
}

function collectVisiblePaths(nodes: ResourceTreeNode[]): string[] {
  const paths: string[] = [];

  const visit = (items: ResourceTreeNode[]) => {
    for (const node of items) {
      paths.push(node.entry.path);
      if (node.entry.kind === "directory" && node.isExpanded && node.children.length > 0) {
        visit(node.children);
      }
    }
  };

  visit(nodes);
  return paths;
}

function SidebarProjectPanel({
  currentProject,
  noProjectText,
  panelTitle,
  refreshText,
  loadingText,
  emptyFolderText,
  openInManagerText,
  openInAssociatedAppText,
  copyRelativePathText,
  copyAbsolutePathText,
  copyPathSuccessText,
  onOpenInFileManager,
  onOpenInAssociatedApp,
  onOpenFile,
}: SidebarProjectPanelProps) {
  const { t } = useTranslation();
  const projectRootPath = currentProject?.path ?? "";
  const [rootEntries, setRootEntries] = useState<FileTreeEntry[]>([]);
  const [loadedDirectories, setLoadedDirectories] = useState<Record<string, FileTreeEntry[]>>({});
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [selectionAnchorPath, setSelectionAnchorPath] = useState<string | null>(null);
  const [loadingRoot, setLoadingRoot] = useState(false);
  const [loadingDirectories, setLoadingDirectories] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [renamingEntry, setRenamingEntry] = useState<FileTreeEntry | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [deletingEntries, setDeletingEntries] = useState<FileTreeEntry[]>([]);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [pasteSubmitting, setPasteSubmitting] = useState(false);
  const [clipboardReadSubmitting, setClipboardReadSubmitting] = useState(false);
  const [clipboardPaths, setClipboardPaths] = useState<string[]>([]);
  const [clipboardOperation, setClipboardOperation] = useState<ResourceClipboardOperation>("copy");
  const [inlineCreate, setInlineCreate] = useState<InlineCreateState | null>(null);
  const [inlineCreateSubmitting, setInlineCreateSubmitting] = useState(false);
  const [pendingExternalCopy, setPendingExternalCopy] = useState<PendingExternalCopy | null>(null);
  const [externalCopySubmitting, setExternalCopySubmitting] = useState(false);
  const renameInputRef = useRef<InputRef | null>(null);
  const renameCommitInFlightRef = useRef(false);
  const inlineCreateInputRef = useRef<InputRef | null>(null);
  const inlineCreateCommitInFlightRef = useRef(false);
  const suppressNextClickPathRef = useRef<string | null>(null);
  const activeProjectPathRef = useRef(projectRootPath);
  activeProjectPathRef.current = projectRootPath;
  const projectGenerationRef = useRef(0);
  const requestGenerationRef = useRef(0);
  const directoryGenerationRef = useRef<Map<string, number>>(new Map());
  const isDraggingResourceRef = useRef(false);
  const isExternalDragOutActiveRef = useRef(false);
  const isMarqueeSelectingRef = useRef(false);
  const [dragPreview, setDragPreview] = useState<{
    entries: Array<{ path: string; kind: string; name: string }>;
    x: number;
    y: number;
    hintKind: "move" | "terminal" | "none";
    targetName?: string;
  } | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);
  const lastManualScrollAtRef = useRef(0);
  const programmaticScrollAtRef = useRef(0);
  const lastAutoRevealedPathRef = useRef<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [isExternalDragOver, setIsExternalDragOver] = useState(false);
  const [contextMenuPath, setContextMenuPathState] = useState<string | null>(null);
  const [contextMenuEntry, setContextMenuEntry] = useState<FileTreeEntry | null>(null);
  const contextMenuPathRef = useRef<string | null>(null);
  const setContextMenuPath = useCallback((path: string | null) => {
    contextMenuPathRef.current = path;
    setContextMenuPathState(path);
    if (!path) {
      setContextMenuEntry(null);
    }
  }, []);
  const treeContainerRef = useRef<HTMLDivElement | null>(null);
  const [treeScrollTop, setTreeScrollTop] = useState(0);
  const [treeViewportHeight, setTreeViewportHeight] = useState(0);
  const treeId = useId();
  const gitFileStatuses = useGitStatusStore((state) =>
    currentProject
      ? (state.entries[currentProject.path]?.fileStatuses ?? EMPTY_GIT_FILE_STATUSES)
      : EMPTY_GIT_FILE_STATUSES
  );
  const gitStatusIndex = useMemo(
    () =>
      currentProject
        ? buildTreeGitStatusIndex(currentProject.path, gitFileStatuses)
        : { files: new Map(), directories: new Map() },
    [currentProject, gitFileStatuses]
  );
  const setResourceDragState = useAppStore((s) => s.setResourceDragState);
  const activeFileTabPath = useAppStore((s) => {
    if (!s.panesById || !s.tabsById) return null;
    const paneId = s.activePaneId ?? "main";
    const pane = s.panesById[paneId] ?? s.panesById["main"];
    const tabId = pane?.activeTabId;
    if (!tabId) return null;
    const tab = s.tabsById[tabId];
    return tab?.kind === "file" ? tab.resourceId : null;
  });
  const activeProjectFilePath = useMemo(() => {
    if (!currentProject || !activeFileTabPath) return null;
    if (!isPathInsideRoot(currentProject.path, activeFileTabPath)) return null;
    if (normalizePath(activeFileTabPath) === normalizePath(currentProject.path)) return null;
    return activeFileTabPath;
  }, [activeFileTabPath, currentProject]);

  const normalizedSelectedPaths = useMemo(
    () => new Set(selectedPaths.map((path) => normalizePath(path))),
    [selectedPaths]
  );

  const selectOnlyPath = useCallback((path: string | null) => {
    setSelectedPath(path);
    setSelectedPaths(path ? [path] : []);
    setSelectionAnchorPath(path);
  }, []);

  const loadDirectory = useCallback(
    async (directoryPath?: string | null): Promise<FileTreeListing | null> => {
      if (!currentProject) return null;
      const requestProjectPath = currentProject.path;
      const requestPath = directoryPath ?? requestProjectPath;
      const normalizedRequestPath = normalizePath(requestPath);
      const projectGeneration = projectGenerationRef.current;
      const requestGeneration = ++requestGenerationRef.current;
      directoryGenerationRef.current.set(normalizedRequestPath, requestGeneration);

      const isStaleRequest = () =>
        projectGeneration !== projectGenerationRef.current ||
        normalizePath(activeProjectPathRef.current) !== normalizePath(requestProjectPath) ||
        directoryGenerationRef.current.get(normalizedRequestPath) !== requestGeneration;

      if (directoryPath) {
        setLoadingDirectories((prev) => ({ ...prev, [requestPath]: true }));
      } else {
        setLoadingRoot(true);
      }

      try {
        const listing = await listProjectDirectory(requestProjectPath, directoryPath ?? null);
        if (isStaleRequest()) {
          return null;
        }
        setError(null);

        if (directoryPath) {
          setLoadedDirectories((prev) => ({
            ...prev,
            [listing.directoryPath]: listing.entries,
          }));
        } else {
          setRootEntries(listing.entries);
          // A reveal request can load descendants while the initial root request
          // is still in flight. Merge the root result so it cannot erase them.
          setLoadedDirectories((prev) => ({
            ...prev,
            [listing.directoryPath]: listing.entries,
          }));
          setSelectedPath((prev) => prev ?? listing.rootPath);
        }
        return listing;
      } catch (nextError) {
        if (isStaleRequest()) {
          return null;
        }
        setError(nextError instanceof Error ? nextError.message : String(nextError));
        return null;
      } finally {
        const sameProject =
          projectGeneration === projectGenerationRef.current &&
          normalizePath(activeProjectPathRef.current) === normalizePath(requestProjectPath);
        if (sameProject && directoryGenerationRef.current.get(normalizedRequestPath) === requestGeneration) {
          if (directoryPath) {
            setLoadingDirectories((prev) => ({ ...prev, [requestPath]: false }));
          } else {
            setLoadingRoot(false);
          }
        }
      }
    },
    [currentProject]
  );

  useEffect(() => {
    projectGenerationRef.current += 1;
    directoryGenerationRef.current.clear();
    lastAutoRevealedPathRef.current = null;
    setContextMenuPath(null);
    setInlineCreate(null);
    setRenamingEntry(null);
    setRenameValue("");
    setError(null);
    setLoadingRoot(false);
    setLoadingDirectories({});
    if (!currentProject) return;
    const persistedExpanded = readPersistedExpandedPaths(currentProject.path);
    setExpandedPaths(persistedExpanded);
    setLoadedDirectories({});
    setRootEntries([]);
    setSelectedPaths([currentProject.path]);
    setSelectedPath(currentProject.path);
    setSelectionAnchorPath(currentProject.path);
    const persistedList = Object.keys(persistedExpanded)
      .filter((path) => persistedExpanded[path])
      .sort((left, right) => normalizePath(left).split("/").length - normalizePath(right).split("/").length);
    void (async () => {
      const rootListing = await loadDirectory(null);
      if (!rootListing || persistedList.length === 0) return;
      const availableDirs = new Set(
        rootListing.entries
          .filter((entry) => entry.kind === "directory")
          .map((entry) => entry.path)
      );
      const validExpanded: Record<string, boolean> = {};
      for (const dirPath of persistedList) {
        if (!availableDirs.has(dirPath)) continue;
        const listing = await loadDirectory(dirPath);
        if (!listing) continue;
        validExpanded[dirPath] = true;
        for (const entry of listing.entries) {
          if (entry.kind === "directory") {
            availableDirs.add(entry.path);
          }
        }
      }
      if (Object.keys(validExpanded).length !== persistedList.length) {
        setExpandedPaths(validExpanded);
      }
    })();
  }, [currentProject, loadDirectory, setContextMenuPath]);

  useEffect(() => {
    if (!currentProject) return;
    writePersistedExpandedPaths(currentProject.path, expandedPaths);
  }, [currentProject, expandedPaths]);

  useEffect(() => {
    if (!selectedPath) {
      setSelectedPaths((prev) => (prev.length > 0 ? [] : prev));
      return;
    }

    const normalizedSelectedPath = normalizePath(selectedPath);
    setSelectedPaths((prev) => {
      if (prev.length > 1 && prev.some((path) => normalizePath(path) === normalizedSelectedPath)) {
        return prev;
      }
      if (prev.length === 1 && normalizePath(prev[0]) === normalizedSelectedPath) {
        return prev;
      }
      return [selectedPath];
    });
  }, [selectedPath]);

  const revealPath = useCallback(
    async (targetPath: string, targetIsDirectory = false) => {
      if (!currentProject) return;
      const pathsToExpand = getDirectoryPathsToExpand(currentProject.path, targetPath, targetIsDirectory);

      for (const path of pathsToExpand) {
        if (!loadedDirectories[path]) {
          await loadDirectory(path);
        }
      }

      setExpandedPaths((prev) => {
        const next = { ...prev };
        for (const path of pathsToExpand) {
          next[path] = true;
        }
        return next;
      });
      selectOnlyPath(targetPath);
    },
    [currentProject, loadedDirectories, loadDirectory, selectOnlyPath]
  );

  const refreshProjectView = useCallback(
    async (targetPath?: string | null, targetIsDirectory = false) => {
      if (!currentProject) return;

      setExpandedPaths({});
      setLoadedDirectories({});
      setRootEntries([]);
      await loadDirectory(null);

      if (targetPath) {
        const pathsToExpand = getDirectoryPathsToExpand(currentProject.path, targetPath, targetIsDirectory);
        for (const path of pathsToExpand) {
          await loadDirectory(path);
        }
        setExpandedPaths(() => {
          const next: Record<string, boolean> = {};
          for (const path of pathsToExpand) {
            next[path] = true;
          }
          return next;
        });
        selectOnlyPath(targetPath);
      } else {
        selectOnlyPath(currentProject.path);
      }
    },
    [currentProject, loadDirectory, selectOnlyPath]
  );

  useEffect(() => {
    const handleRevealPath = (event: Event) => {
      const detail = (event as CustomEvent<ExplorerRevealPathDetail>).detail;
      if (!detail?.path) return;
      takePendingExplorerRevealPath();
      void revealPath(detail.path, detail.kind === "directory");
    };

    window.addEventListener(EXPLORER_REVEAL_PATH_EVENT, handleRevealPath as EventListener);
    const pendingDetail = takePendingExplorerRevealPath();
    if (pendingDetail?.path) {
      void revealPath(pendingDetail.path, pendingDetail.kind === "directory");
    }
    return () => {
      window.removeEventListener(EXPLORER_REVEAL_PATH_EVENT, handleRevealPath as EventListener);
    };
  }, [revealPath]);

  const revealPathRef = useRef(revealPath);
  revealPathRef.current = revealPath;

  const scrollRowIntoViewIfNeeded = useCallback((row: HTMLElement) => {
    const container = treeContainerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (containerRect.height <= 0) return;
    if (rowRect.top >= containerRect.top - 1 && rowRect.bottom <= containerRect.bottom + 1) {
      return;
    }
    programmaticScrollAtRef.current = Date.now();
    // 仅调整文件树自身的 scrollTop，避免原生 scrollIntoView 向上冒泡滚动外层容器。
    if (rowRect.top < containerRect.top) {
      container.scrollTop += rowRect.top - containerRect.top;
    } else if (rowRect.bottom > containerRect.bottom) {
      container.scrollTop += rowRect.bottom - containerRect.bottom;
    }
  }, []);

  useEffect(() => {
    if (!currentProject || !activeProjectFilePath) {
      lastAutoRevealedPathRef.current = null;
      return;
    }
    if (
      lastAutoRevealedPathRef.current &&
      normalizePath(lastAutoRevealedPathRef.current) === normalizePath(activeProjectFilePath)
    ) {
      return;
    }
    if (
      renamingEntry ||
      inlineCreate ||
      isDraggingResourceRef.current ||
      isMarqueeSelectingRef.current ||
      isExternalDragOver ||
      Date.now() - lastManualScrollAtRef.current < 1500
    ) {
      return;
    }
    lastAutoRevealedPathRef.current = activeProjectFilePath;
    void revealPathRef.current(activeProjectFilePath, false);
  }, [
    activeProjectFilePath,
    currentProject,
    inlineCreate,
    isExternalDragOver,
    renamingEntry,
  ]);

  useEffect(() => {
    if (!currentProject) return;
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    const entry = useGitStatusStore.getState().entries[currentProject.path];
    if (!entry || (entry.isRepo === null && !entry.loading)) {
      void useGitStatusStore.getState().refresh(currentProject.path);
    }
  }, [currentProject]);

  useEffect(() => {
    const container = treeContainerRef.current;
    if (!container) return;
    const syncViewportHeight = () => {
      setTreeViewportHeight(container.clientHeight);
    };
    syncViewportHeight();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(syncViewportHeight);
    observer.observe(container);
    return () => observer.disconnect();
  }, [currentProject]);

  const handleRefresh = useCallback(() => {
    if (!currentProject) return;
    // 已展开的目录此前会命中 loadedDirectories 缓存，导致刷新后仍显示磁盘修改前的内容。
    // 按层级重读当前可见的目录，既更新内容也保留用户展开的位置。
    const expandedDirectoryPaths = Object.keys(loadedDirectories)
      .filter((path) => expandedPaths[path])
      .sort((left, right) => normalizePath(left).split("/").length - normalizePath(right).split("/").length);

    void (async () => {
      const rootListing = await loadDirectory(null);
      if (!rootListing) return;

      const availableDirectoryPaths = new Set(
        rootListing.entries
          .filter((entry) => entry.kind === "directory")
          .map((entry) => entry.path)
      );

      for (const directoryPath of expandedDirectoryPaths) {
        // 若目录已在外部被移动或删除，则其父目录的最新结果中不会再包含它。
        if (!availableDirectoryPaths.has(directoryPath)) continue;

        const listing = await loadDirectory(directoryPath);
        if (!listing) continue;

        for (const entry of listing.entries) {
          if (entry.kind === "directory") {
            availableDirectoryPaths.add(entry.path);
          }
        }
      }
    })();
  }, [currentProject, expandedPaths, loadedDirectories, loadDirectory]);

  const refreshExpandedTreeRef = useRef(handleRefresh);
  refreshExpandedTreeRef.current = handleRefresh;
  const isBusyEditingRef = useRef(false);
  isBusyEditingRef.current = !!inlineCreate || !!renamingEntry || isMarqueeSelectingRef.current;

  useEffect(() => {
    if (!currentProject) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    let debounceTimer: number | null = null;

    const setup = async () => {
      try {
        const remove = await listen<{ projectPath: string; kind: string }>("git:file-change", (event) => {
          if (normalizePath(event.payload.projectPath) !== normalizePath(currentProject.path)) {
            return;
          }
          if (debounceTimer !== null) {
            window.clearTimeout(debounceTimer);
          }
          debounceTimer = window.setTimeout(() => {
            debounceTimer = null;
            if (!isBusyEditingRef.current) {
              refreshExpandedTreeRef.current();
            }
          }, 500);
        });
        if (cancelled) {
          remove();
          return;
        }
        unlisten = remove;
      } catch {
        // 非 Tauri 测试环境无事件总线时静默跳过
      }
    };
    void setup();

    return () => {
      cancelled = true;
      if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer);
      }
      unlisten?.();
    };
  }, [currentProject]);

  const handleCollapseAll = useCallback(() => {
    setExpandedPaths({});
  }, []);

  const handleRetry = useCallback(() => {
    if (!currentProject) return;
    setError(null);
    if (rootEntries.length === 0) {
      void loadDirectory(null);
      return;
    }
    handleRefresh();
  }, [currentProject, handleRefresh, loadDirectory, rootEntries.length]);

  const handleToggleDirectory = useCallback(
    async (entry: FileTreeEntry) => {
      selectOnlyPath(entry.path);
      if (!!expandedPaths[entry.path]) {
        setExpandedPaths((prev) => ({ ...prev, [entry.path]: false }));
        return;
      }

      setExpandedPaths((prev) => ({ ...prev, [entry.path]: true }));
      if (!loadedDirectories[entry.path] && !loadingDirectories[entry.path]) {
        await loadDirectory(entry.path);
      }
    },
    [expandedPaths, loadedDirectories, loadingDirectories, loadDirectory, selectOnlyPath]
  );

  const buildVisibleTree = useCallback(
    (entries: FileTreeEntry[]): ResourceTreeNode[] =>
      entries.map((entry) => {
        const isExpanded = !!expandedPaths[entry.path];
        const children = entry.kind === "directory" && isExpanded
          ? buildVisibleTree(loadedDirectories[entry.path] ?? [])
          : [];

        return {
          entry,
          isExpanded,
          isLoadingChildren: !!loadingDirectories[entry.path],
          children,
        };
      }),
    [expandedPaths, loadedDirectories, loadingDirectories]
  );

  const visibleTree = useMemo(() => buildVisibleTree(rootEntries), [buildVisibleTree, rootEntries]);

  const flatRows = useMemo<FlatTreeRow[]>(() => {
    const result: FlatTreeRow[] = [];
    if (inlineCreate && normalizePath(inlineCreate.parentPath) === normalizePath(projectRootPath)) {
      result.push({ kind: "inline-create", key: "__inline-create__", depth: 0 });
    }
    const visit = (
      nodes: ResourceTreeNode[],
      depth: number,
      inheritedTone?: FolderTone,
      inheritedIgnored = false
    ) => {
      for (const node of nodes) {
        const { entry, isExpanded, children } = node;
        const isDirectory = entry.kind === "directory";
        const visual = getFileIcon(entry.name, isDirectory, isExpanded, inheritedTone);
        const rowTone = visual.tone ?? inheritedTone;
        const rowIgnored = !!entry.ignored || inheritedIgnored;
        result.push({
          kind: "node",
          key: entry.path,
          node,
          depth,
          inheritedTone,
          rowTone,
          inheritedIgnored: rowIgnored,
        });
        if (isDirectory && isExpanded) {
          const hasInlineChild =
            !!inlineCreate && normalizePath(inlineCreate.parentPath) === normalizePath(entry.path);
          if (hasInlineChild) {
            result.push({
              kind: "inline-create",
              key: `__inline-create__:${entry.path}`,
              depth: depth + 1,
              inheritedTone: rowTone,
              rowTone,
            });
          }
          if (children.length > 0) {
            visit(children, depth + 1, rowTone, rowIgnored);
          }
        }
      }
    };
    visit(visibleTree, 0);
    return result;
  }, [inlineCreate, projectRootPath, visibleTree]);

  const virtualWindow = useMemo(
    () => computeVirtualWindow(flatRows.length, treeScrollTop, treeViewportHeight, TREE_ROW_HEIGHT),
    [flatRows.length, treeScrollTop, treeViewportHeight]
  );

  const visibleFlatRows = useMemo(
    () => flatRows.slice(virtualWindow.startIndex, virtualWindow.endIndex),
    [flatRows, virtualWindow.endIndex, virtualWindow.startIndex]
  );

  const visibleSelectablePaths = useMemo(
    () => collectVisiblePaths(visibleTree),
    [visibleTree]
  );

  useEffect(() => {
    if (!selectedPath) return;
    const frame = window.requestAnimationFrame(() => {
      const container = treeContainerRef.current;
      if (!container) return;
      const selectedRow = Array.from(
        container.querySelectorAll<HTMLElement>(".app-file-tree-row[data-path]")
      ).find((row) => normalizePath(row.dataset.path ?? "") === normalizePath(selectedPath));
      if (selectedRow) {
        scrollRowIntoViewIfNeeded(selectedRow);
        return;
      }
      const rowIndex = flatRows.findIndex(
        (item) => item.kind === "node" && normalizePath(item.node.entry.path) === normalizePath(selectedPath)
      );
      if (rowIndex >= 0 && container.clientHeight > 0) {
        const rowTop = rowIndex * TREE_ROW_HEIGHT;
        const rowBottom = rowTop + TREE_ROW_HEIGHT;
        if (rowTop < container.scrollTop) {
          programmaticScrollAtRef.current = Date.now();
          container.scrollTop = rowTop;
        } else if (rowBottom > container.scrollTop + container.clientHeight) {
          programmaticScrollAtRef.current = Date.now();
          container.scrollTop = rowBottom - container.clientHeight;
        }
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [flatRows, scrollRowIntoViewIfNeeded, selectedPath]);
  useEffect(() => {
    if (loadingRoot || error ||
      (contextMenuPath && contextMenuPath !== "__background__" && !visibleSelectablePaths.includes(contextMenuPath))) {
      setContextMenuPath(null);
    }
  }, [contextMenuPath, visibleSelectablePaths, loadingRoot, error]);

  const handleContextMenuOpenChange = useCallback((path: string, open: boolean) => {
    if (!open && contextMenuPathRef.current !== path) return;
    setContextMenuPath(open ? path : null);
    if (!open && document.activeElement?.closest(".ant-dropdown")) {
      treeContainerRef.current?.focus({ preventScroll: true });
    }
    if (!open && path === "__background__") {
      // Returning focus from the menu must not reselect the first folder.
      selectOnlyPath(projectRootPath);
    }
  }, [projectRootPath, selectOnlyPath, setContextMenuPath]);
  const knownEntries = useMemo(
    () => [
      ...rootEntries,
      ...Object.values(loadedDirectories).flat(),
    ],
    [loadedDirectories, rootEntries]
  );
  const externalCopyValidation = useMemo(() => {
    if (!pendingExternalCopy) {
      return {
        targetNames: [] as string[],
        conflictNames: [] as string[],
        hasBlankName: false,
        hasInvalidName: false,
      };
    }

    const targetNames = getExternalCopyTargetNames(pendingExternalCopy);
    const destinationDirectory = pendingExternalCopy.destinationDirectory.trim();
    const knownPaths = new Set(knownEntries.map((entry) => normalizePath(entry.path)));
    const conflictNames = isExplicitExternalCopyRename(pendingExternalCopy)
      ? targetNames.filter((name) => {
          if (!name || !destinationDirectory) return false;
          return knownPaths.has(normalizePath(joinPath(destinationDirectory, [name])));
        })
      : [];

    return {
      targetNames,
      conflictNames,
      hasBlankName: targetNames.some((name) => name.trim().length === 0),
      hasInvalidName: pendingExternalCopy.sourcePaths.length === 1 && isInvalidEntryName(pendingExternalCopy.newName),
    };
  }, [knownEntries, pendingExternalCopy]);
  const selectedEntries = useMemo(() => {
    const entriesByPath = new Map(
      knownEntries.map((entry) => [normalizePath(entry.path), entry] as const)
    );

    return selectedPaths
      .map((path) => entriesByPath.get(normalizePath(path)))
      .filter((entry): entry is FileTreeEntry => !!entry);
  }, [knownEntries, selectedPaths]);
  const actionableSelectedEntries = useMemo(
    () => selectedEntries.filter((entry) => normalizePath(entry.path) !== normalizePath(projectRootPath)),
    [projectRootPath, selectedEntries]
  );
  const hasClipboardEntries = clipboardPaths.length > 0;
  const selectedEntryKind = useMemo(() => {
    if (!selectedPath || normalizePath(selectedPath) === normalizePath(projectRootPath)) {
      return "directory";
    }

    return (
      knownEntries.find((entry) => normalizePath(entry.path) === normalizePath(selectedPath))?.kind ?? "file"
    );
  }, [knownEntries, projectRootPath, selectedPath]);
  const selectionTargetDirectory = useMemo(
    () => getDefaultCreateDirectory(projectRootPath, selectedPath, selectedEntryKind === "directory"),
    [selectedPath, projectRootPath, selectedEntryKind]
  );
  const canCopySelection = actionableSelectedEntries.length > 0 && !renameSubmitting;
  const canCutSelection = canCopySelection;
  const canDeleteSelection = actionableSelectedEntries.length > 0 && !deleteSubmitting && !renameSubmitting;
  const canPaste =
    !pasteSubmitting
    && !clipboardReadSubmitting
    && !externalCopySubmitting
    && !pendingExternalCopy
    && !renameSubmitting;

  const handleSelectEntry = useCallback(
    (entry: FileTreeEntry, event: ReactMouseEvent<HTMLButtonElement>) => {
      const hasPrimaryModifier = event.ctrlKey || event.metaKey;
      const hasRangeModifier = event.shiftKey;
      const targetPath = entry.path;

      if (!hasPrimaryModifier && !hasRangeModifier) {
        selectOnlyPath(targetPath);
        return false;
      }

      if (hasRangeModifier) {
        const anchorPath = selectionAnchorPath ?? selectedPath ?? targetPath;
        const anchorIndex = visibleSelectablePaths.findIndex(
          (path) => normalizePath(path) === normalizePath(anchorPath)
        );
        const targetIndex = visibleSelectablePaths.findIndex(
          (path) => normalizePath(path) === normalizePath(targetPath)
        );
        const rangePaths =
          anchorIndex >= 0 && targetIndex >= 0
            ? visibleSelectablePaths.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)
            : [targetPath];

        setSelectedPaths((previousPaths) => {
          if (!hasPrimaryModifier) {
            return rangePaths;
          }

          const nextPaths = [...previousPaths];
          for (const path of rangePaths) {
            if (!nextPaths.some((selected) => normalizePath(selected) === normalizePath(path))) {
              nextPaths.push(path);
            }
          }
          return nextPaths;
        });
        setSelectedPath(targetPath);
        if (!selectionAnchorPath) {
          setSelectionAnchorPath(anchorPath);
        }
        return true;
      }

      const targetIsSelected = normalizedSelectedPaths.has(normalizePath(targetPath));
      setSelectedPaths((previousPaths) => {
        return targetIsSelected
          ? previousPaths.filter((path) => normalizePath(path) !== normalizePath(targetPath))
          : [...previousPaths, targetPath];
      });
      const remainingPaths = selectedPaths.filter(
        (path) => normalizePath(path) !== normalizePath(targetPath)
      );
      setSelectedPath(targetIsSelected ? remainingPaths[remainingPaths.length - 1] ?? null : targetPath);
      setSelectionAnchorPath(targetPath);
      return true;
    },
    [
      normalizedSelectedPaths,
      selectOnlyPath,
      selectedPath,
      selectedPaths,
      selectionAnchorPath,
      visibleSelectablePaths,
    ]
  );

  const handleSelectAllVisible = useCallback(() => {
    const treeContainer = treeContainerRef.current;
    const activeElement = document.activeElement;
    const isTreeFocused =
      !!treeContainer &&
      activeElement instanceof HTMLElement &&
      (activeElement === treeContainer || treeContainer.contains(activeElement));

    if (!isTreeFocused || visibleSelectablePaths.length === 0) {
      return;
    }

    setSelectedPaths(visibleSelectablePaths);
    setSelectedPath((prev) => {
      if (prev && visibleSelectablePaths.some((path) => normalizePath(path) === normalizePath(prev))) {
        return prev;
      }
      return visibleSelectablePaths[0] ?? prev;
    });
    setSelectionAnchorPath((previousAnchor) => {
      if (previousAnchor && visibleSelectablePaths.some((path) => normalizePath(path) === normalizePath(previousAnchor))) {
        return previousAnchor;
      }
      return visibleSelectablePaths[0] ?? null;
    });
  }, [visibleSelectablePaths]);

  useEffect(() => {
    const handleSelectAll = () => {
      handleSelectAllVisible();
    };

    window.addEventListener(EXPLORER_SELECT_ALL_EVENT, handleSelectAll);
    return () => {
      window.removeEventListener(EXPLORER_SELECT_ALL_EVENT, handleSelectAll);
    };
  }, [handleSelectAllVisible]);

  useEffect(() => {
    if (!currentProject) return;

    const currentWindow = getCurrentWindow();
    const dropPromise = currentWindow.onDragDropEvent((event) => {
      if (isExternalDragOutActiveRef.current) {
        return;
      }
      if (event.payload.type === "leave") {
        setIsExternalDragOver(false);
        setDragOverPath(null);
        return;
      }

      // 将物理像素转换为 CSS 像素
      const pos = event.payload.position;
      const cssX = pos.x / window.devicePixelRatio;
      const cssY = pos.y / window.devicePixelRatio;

      // 使用 elementFromPoint 精确检测鼠标下方的元素
      const element = document.elementFromPoint(cssX, cssY);
      const treeContainer = treeContainerRef.current;
      const isInsideSidebar = element && treeContainer?.contains(element);

      if (!isInsideSidebar) {
        if (event.payload.type !== "drop") {
          setIsExternalDragOver(false);
          setDragOverPath(null);
        }
        return;
      }

      if (event.payload.type === "enter" || event.payload.type === "over") {
        setIsExternalDragOver(true);

        // 向上查找最近的 .app-file-tree-row 元素
        const row = element!.closest(".app-file-tree-row");
        let foundPath: string | null = null;

        if (row) {
          const dataPath = row.getAttribute("data-path");
          if (dataPath) {
            const entry = knownEntries.find(
              (e) => normalizePath(e.path) === normalizePath(dataPath)
            );
            if (entry?.kind === "directory") {
              foundPath = dataPath;
            } else if (entry) {
              foundPath = getParentPath(projectRootPath, entry.path);
            }
          }
        }
        setDragOverPath(foundPath);
        return;
      }

      if (event.payload.type === "drop") {
        setIsExternalDragOver(false);
        const targetDir = dragOverPath ?? currentProject.path;
        setDragOverPath(null);

        const paths = event.payload.paths;
        if (paths.length === 0) return;

        const firstName = getBaseName(paths[0] ?? "");
        setPendingExternalCopy({
          sourcePaths: paths,
          destinationDirectory: targetDir,
          newName: firstName,
          openAfterCopy: paths.length === 1 && isProbablyFilePath(firstName),
        });
      }
    });

    return () => {
      dropPromise.then((unlisten) => unlisten());
    };
  }, [currentProject, dragOverPath, knownEntries, projectRootPath, refreshProjectView, t]);

  useEffect(() => {
    if (!renamingEntry) {
      renameCommitInFlightRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      const inputEl = renameInputRef.current?.input;
      if (inputEl) {
        inputEl.focus();
        const { start, end } = getRenameSelectionRange(renamingEntry.name, renamingEntry.kind);
        inputEl.setSelectionRange(start, end);
      } else {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [renamingEntry]);

  const handleOpenRename = useCallback((entry: FileTreeEntry) => {
    setInlineCreate(null);
    selectOnlyPath(entry.path);
    setRenamingEntry(entry);
    setRenameValue(entry.name);
  }, [selectOnlyPath]);

  const handleCancelRename = useCallback(() => {
    if (renameSubmitting) return;
    renameCommitInFlightRef.current = false;
    setRenamingEntry(null);
    setRenameValue("");
    treeContainerRef.current?.focus({ preventScroll: true });
  }, [renameSubmitting]);

  const handleConfirmRename = useCallback(async () => {
    if (!currentProject || !renamingEntry || renameCommitInFlightRef.current) return;

    renameCommitInFlightRef.current = true;
    setRenameSubmitting(true);
    try {
      const nextPath = await renameProjectEntry(currentProject.path, renamingEntry.path, renameValue);
      setRenamingEntry(null);
      setRenameValue("");
      await refreshProjectView(nextPath, renamingEntry.kind === "directory");
    } catch (nextError) {
      message.error(
        nextError instanceof Error ? nextError.message : t("sidebar.resourceRenameFailed")
      );
    } finally {
      renameCommitInFlightRef.current = false;
      setRenameSubmitting(false);
    }
  }, [currentProject, refreshProjectView, renameValue, renamingEntry, t]);

  const handleRequestDeleteEntries = useCallback((entries: FileTreeEntry[]) => {
    if (entries.length === 0) return;
    setDeletingEntries(entries);
  }, []);

  const handleSetClipboardEntries = useCallback(
    (entries: FileTreeEntry[], operation: ResourceClipboardOperation) => {
      const nextPaths = Array.from(new Set(entries.map((entry) => entry.path)));
      if (nextPaths.length === 0) return;
      setClipboardPaths(nextPaths);
      setClipboardOperation(operation);
      showWorkbenchFeedback(
        t(operation === "cut" ? "sidebar.selectionCut" : "sidebar.selectionCopied", {
          count: nextPaths.length,
        })
      );
    },
    [t]
  );

  const handleCopyEntries = useCallback(
    (entries: FileTreeEntry[]) => handleSetClipboardEntries(entries, "copy"),
    [handleSetClipboardEntries]
  );

  const handleCutEntries = useCallback(
    (entries: FileTreeEntry[]) => handleSetClipboardEntries(entries, "cut"),
    [handleSetClipboardEntries]
  );

  const handleStartResourceDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, entry: FileTreeEntry) => {
      if (event.button !== 0 || event.altKey || !currentProject || renamingEntry) return;

      const dragEntries =
        selectedEntries.some((selected) => normalizePath(selected.path) === normalizePath(entry.path))
          ? selectedEntries
          : [entry];
      if (dragEntries.length === 0) return;

      const dragPaths = dragEntries.map((item) => item.path);
      const sourceElement = event.currentTarget;
      const pointerId = event.pointerId;
      const startedAt = Date.now();
      const startX = event.clientX;
      const startY = event.clientY;
      let dragging = false;
      let externalDragTriggered = false;
      let lastX = startX;
      let lastY = startY;
      let previousUserSelect = "";
      let internalDropTargetDir: string | null = null;

      const nextState = (x: number, y: number, phase: "dragging" | "dropping") => ({
        type: "agent-resource" as const,
        projectPath: currentProject.path,
        entries: dragEntries.map((item) => ({
          path: item.path,
          kind: item.kind,
          name: item.name,
        })),
        x,
        y,
        phase,
        startedAt,
      });

      const releaseCapture = () => {
        try {
          if (sourceElement.hasPointerCapture?.(pointerId)) {
            sourceElement.releasePointerCapture(pointerId);
          }
        } catch {
          // 忽略指针已释放或节点已卸载的异常
        }
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleCancel);
        window.removeEventListener("blur", handleCancel);
        releaseCapture();
        isDraggingResourceRef.current = false;
        setDragPreview(null);
        setDragOverPath(null);
        if (dragging) {
          document.body.style.userSelect = previousUserSelect;
        }
      };

      const beginDragging = () => {
        if (dragging) return;
        dragging = true;
        isDraggingResourceRef.current = true;
        previousUserSelect = document.body.style.userSelect;
        document.body.style.userSelect = "none";
        suppressNextClickPathRef.current = entry.path;
        try {
          sourceElement.setPointerCapture?.(pointerId);
        } catch {
          // 忽略测试环境或不可捕获节点的异常
        }
      };

      const triggerExternalDrag = () => {
        if (externalDragTriggered) return;
        externalDragTriggered = true;
        cleanup();
        setResourceDragState(null);
        isExternalDragOutActiveRef.current = true;
        void startExternalFileDrag(dragPaths)
          .catch((err) => {
            message.error(err instanceof Error ? err.message : t("sidebar.externalDragFailed"));
          })
          .finally(() => {
            isExternalDragOutActiveRef.current = false;
          });
      };

      const handleMove = (moveEvent: PointerEvent) => {
        if (externalDragTriggered) return;
        lastX = moveEvent.clientX;
        lastY = moveEvent.clientY;
        const distance = Math.hypot(lastX - startX, lastY - startY);
        if (!dragging && distance < 6) return;

        beginDragging();
        moveEvent.preventDefault();

        if (isPointOutsideViewport(lastX, lastY, window.innerWidth, window.innerHeight, 2)) {
          triggerExternalDrag();
          return;
        }

        const underPointer = document.elementFromPoint(lastX, lastY) as HTMLElement | null;
        const treeContainer = treeContainerRef.current;
        let nextHintKind: "move" | "terminal" | "none" = "none";
        let nextTargetName: string | undefined;

        if (underPointer && treeContainer?.contains(underPointer)) {
          const row = underPointer.closest(".app-file-tree-row");
          const rowPath = row?.getAttribute("data-path") ?? null;
          const rowEntry = rowPath
            ? knownEntries.find((item) => normalizePath(item.path) === normalizePath(rowPath))
            : undefined;
          const candidateDir = resolveInternalDropTarget({
            hoveredRowPath: rowPath,
            hoveredRowKind: rowEntry ? (rowEntry.kind === "directory" ? "directory" : "file") : null,
            dragPaths,
            projectRootPath: currentProject.path,
          });
          internalDropTargetDir = candidateDir;
          setDragOverPath(candidateDir);
          if (candidateDir) {
            nextHintKind = "move";
            nextTargetName =
              normalizePath(candidateDir) === normalizePath(currentProject.path)
                ? currentProject.name
                : getBaseName(candidateDir);
          }
        } else {
          internalDropTargetDir = null;
          setDragOverPath(null);
          if (underPointer?.closest(".xterm")) {
            nextHintKind = "terminal";
          }
        }

        setDragPreview({
          entries: dragEntries.map((item) => ({
            path: item.path,
            kind: item.kind,
            name: item.name,
          })),
          x: lastX,
          y: lastY,
          hintKind: nextHintKind,
          targetName: nextTargetName,
        });
        setResourceDragState(nextState(lastX, lastY, "dragging"));
      };

      const handleUp = (upEvent: PointerEvent) => {
        const dropTargetDir = internalDropTargetDir;
        cleanup();
        if (!dragging || externalDragTriggered) return;

        if (dropTargetDir) {
          setResourceDragState(null);
          void moveProjectEntries(currentProject.path, dragPaths, dropTargetDir)
            .then((moved) => {
              showWorkbenchFeedback(t("sidebar.resourceMoveSuccess", { count: moved.length }));
              return refreshProjectView();
            })
            .catch((err) => {
              message.error(err instanceof Error ? err.message : t("sidebar.resourceMoveFailed"));
            });
          return;
        }

        lastX = upEvent.clientX;
        lastY = upEvent.clientY;
        setResourceDragState(nextState(lastX, lastY, "dropping"));
        window.setTimeout(() => {
          const current = useAppStore.getState().resourceDragState;
          if (current?.type === "agent-resource" && current.startedAt === startedAt) {
            setResourceDragState(null);
          }
        }, 250);
      };

      const handleCancel = () => {
        cleanup();
        if (dragging && !externalDragTriggered) {
          setResourceDragState(null);
        }
      };

      window.addEventListener("pointermove", handleMove, { passive: false });
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleCancel);
      window.addEventListener("blur", handleCancel);
    },
    [currentProject, knownEntries, refreshProjectView, renamingEntry, selectedEntries, setResourceDragState, t]
  );

  const handleTreeMarqueePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (
        event.button !== 0 ||
        !currentProject ||
        renamingEntry ||
        inlineCreate ||
        loadingRoot ||
        !!error
      ) {
        return;
      }
      const container = treeContainerRef.current;
      const target = event.target as HTMLElement | null;
      if (!container || !target || !container.contains(target)) {
        return;
      }
      if (target.closest("input, textarea, a, [data-inline-create=\"true\"], button:not(.app-file-tree-row)")) {
        return;
      }
      const startedOnRow = !!target.closest(".app-file-tree-row");
      if (startedOnRow && !event.altKey) {
        return;
      }

      const startRect = container.getBoundingClientRect();
      const downClientX = event.clientX;
      const downClientY = event.clientY;
      const startContentX = Math.max(0, Math.min(downClientX - startRect.left + container.scrollLeft, container.scrollWidth));
      const startContentY = Math.max(0, Math.min(downClientY - startRect.top + container.scrollTop, container.scrollHeight));
      const additive = event.ctrlKey || event.metaKey || event.shiftKey;
      const basePaths = additive
        ? selectedPaths.filter((path) => normalizePath(path) !== normalizePath(projectRootPath))
        : [];
      const previousSelectedPath = selectedPath;
      const previousSelectedPaths = selectedPaths;
      const previousAnchorPath = selectionAnchorPath;

      let marqueeActive = false;
      let lastClientX = downClientX;
      let lastClientY = downClientY;
      let autoScrollRaf = 0;
      let previousUserSelect = "";

      const updateSelectionFromClient = (clientX: number, clientY: number) => {
        const currentContainer = treeContainerRef.current;
        if (!currentContainer) return;
        const rect = currentContainer.getBoundingClientRect();
        const maxWidth = Math.max(currentContainer.scrollWidth, rect.width);
        const maxHeight = Math.max(currentContainer.scrollHeight, rect.height);
        const contentX = Math.max(0, Math.min(clientX - rect.left + currentContainer.scrollLeft, maxWidth));
        const contentY = Math.max(0, Math.min(clientY - rect.top + currentContainer.scrollTop, maxHeight));
        const box = computeMarqueeRect(startContentX, startContentY, contentX, contentY);
        setMarqueeRect(box);

        const viewBox = {
          left: rect.left + box.left - currentContainer.scrollLeft,
          top: rect.top + box.top - currentContainer.scrollTop,
          right: rect.left + box.left + box.width - currentContainer.scrollLeft,
          bottom: rect.top + box.top + box.height - currentContainer.scrollTop,
        };
        const rows = currentContainer.querySelectorAll<HTMLElement>(".app-file-tree-row[data-path]");
        const intersected: string[] = [];
        rows.forEach((row) => {
          const path = row.getAttribute("data-path");
          if (!path) return;
          const rowRect = row.getBoundingClientRect();
          if (rectsIntersect(viewBox, rowRect)) {
            intersected.push(path);
          }
        });

        const nextPaths = mergeMarqueeSelection(basePaths, intersected, additive);
        setSelectedPaths(nextPaths);
        const focusTarget = nextPaths[nextPaths.length - 1] ?? projectRootPath;
        setSelectedPath(focusTarget);
        setSelectionAnchorPath(focusTarget);
      };

      const stepAutoScroll = () => {
        autoScrollRaf = 0;
        const currentContainer = treeContainerRef.current;
        if (!marqueeActive || !currentContainer) return;
        const rect = currentContainer.getBoundingClientRect();
        const edgeThreshold = 24;
        let deltaY = 0;
        if (lastClientY < rect.top + edgeThreshold) {
          deltaY = -Math.min(14, Math.max(4, Math.ceil((rect.top + edgeThreshold - lastClientY) / 3)));
        } else if (lastClientY > rect.bottom - edgeThreshold) {
          deltaY = Math.min(14, Math.max(4, Math.ceil((lastClientY - (rect.bottom - edgeThreshold)) / 3)));
        }
        if (deltaY !== 0) {
          const prevScrollTop = currentContainer.scrollTop;
          currentContainer.scrollTop = Math.max(0, prevScrollTop + deltaY);
          if (currentContainer.scrollTop !== prevScrollTop) {
            lastManualScrollAtRef.current = Date.now();
            updateSelectionFromClient(lastClientX, lastClientY);
          }
          autoScrollRaf = window.requestAnimationFrame(stepAutoScroll);
        }
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleCancel);
        window.removeEventListener("keydown", handleEscape, true);
        if (autoScrollRaf) {
          window.cancelAnimationFrame(autoScrollRaf);
          autoScrollRaf = 0;
        }
        if (marqueeActive) {
          document.body.style.userSelect = previousUserSelect;
        }
        isMarqueeSelectingRef.current = false;
        setMarqueeRect(null);
      };

      const handleMove = (moveEvent: PointerEvent) => {
        lastClientX = moveEvent.clientX;
        lastClientY = moveEvent.clientY;
        if (!marqueeActive) {
          if (Math.hypot(lastClientX - downClientX, lastClientY - downClientY) < 4) {
            return;
          }
          marqueeActive = true;
          isMarqueeSelectingRef.current = true;
          previousUserSelect = document.body.style.userSelect;
          document.body.style.userSelect = "none";
          container.focus({ preventScroll: true });
        }
        moveEvent.preventDefault();
        updateSelectionFromClient(lastClientX, lastClientY);
        if (!autoScrollRaf) {
          const rect = container.getBoundingClientRect();
          if (lastClientY < rect.top + 24 || lastClientY > rect.bottom - 24) {
            autoScrollRaf = window.requestAnimationFrame(stepAutoScroll);
          }
        }
      };

      const suppressOneClickIfNeeded = () => {
        if (!marqueeActive) return;
        const suppressClick = (clickEvent: MouseEvent) => {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
        };
        window.addEventListener("click", suppressClick, { capture: true, once: true });
        window.setTimeout(() => {
          window.removeEventListener("click", suppressClick, true);
        }, 0);
      };

      const handleUp = () => {
        const wasActive = marqueeActive;
        cleanup();
        if (wasActive) {
          suppressOneClickIfNeeded();
        }
      };

      const handleCancel = () => {
        cleanup();
      };

      const handleEscape = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key !== "Escape") return;
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        cleanup();
        setSelectedPaths(previousSelectedPaths);
        setSelectedPath(previousSelectedPath);
        setSelectionAnchorPath(previousAnchorPath);
      };

      window.addEventListener("pointermove", handleMove, { passive: false });
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleCancel);
      window.addEventListener("keydown", handleEscape, true);
    },
    [currentProject, error, inlineCreate, loadingRoot, projectRootPath, renamingEntry, selectedPath, selectedPaths, selectionAnchorPath]
  );

  const handlePasteEntries = useCallback(
    async (destinationDirectory: string) => {
      if (!currentProject || clipboardPaths.length === 0 || pasteSubmitting) return;

      setPasteSubmitting(true);
      try {
        const pastedPaths = clipboardOperation === "cut"
          ? await moveProjectEntries(currentProject.path, clipboardPaths, destinationDirectory)
          : await copyProjectEntries(currentProject.path, clipboardPaths, destinationDirectory);
        await refreshProjectView(destinationDirectory, true);
        if (pastedPaths.length > 0) {
          setSelectedPaths(pastedPaths);
          setSelectedPath(pastedPaths[0] ?? destinationDirectory);
          setSelectionAnchorPath(pastedPaths[0] ?? destinationDirectory);
        } else {
          selectOnlyPath(destinationDirectory);
        }
        if (clipboardOperation === "cut") {
          setClipboardPaths([]);
          setClipboardOperation("copy");
        }
        message.success(
          t(clipboardOperation === "cut" ? "sidebar.resourceMoveSuccess" : "sidebar.resourcePasteSuccess", {
            count: pastedPaths.length,
          })
        );
      } catch (nextError) {
        message.error(
          nextError instanceof Error
            ? nextError.message
            : t(clipboardOperation === "cut" ? "sidebar.resourceMoveFailed" : "sidebar.resourcePasteFailed")
        );
      } finally {
        setPasteSubmitting(false);
      }
    },
    [clipboardOperation, clipboardPaths, currentProject, pasteSubmitting, refreshProjectView, selectOnlyPath, t]
  );

  const handlePasteFromClipboard = useCallback(
    async (destinationDirectory: string) => {
      if (!currentProject || !canPaste) return;

      if (hasClipboardEntries) {
        await handlePasteEntries(destinationDirectory);
        return;
      }

      setClipboardReadSubmitting(true);
      try {
        const sourcePaths = await readClipboardFilePaths();
        if (sourcePaths.length === 0) {
          message.warning(t("sidebar.clipboardFilesEmpty"));
          return;
        }

        const firstName = getBaseName(sourcePaths[0] ?? "");
        setPendingExternalCopy({
          sourcePaths,
          destinationDirectory,
          newName: firstName,
          openAfterCopy: sourcePaths.length === 1 && isProbablyFilePath(firstName),
        });
      } catch (nextError) {
        message.error(
          nextError instanceof Error ? nextError.message : t("sidebar.clipboardFilesReadFailed")
        );
      } finally {
        setClipboardReadSubmitting(false);
      }
    },
    [canPaste, currentProject, handlePasteEntries, hasClipboardEntries, t]
  );

  const handleChooseExternalCopyDirectory = useCallback(async () => {
    if (!pendingExternalCopy) return;

    const selected = await openDirectoryDialog({
      directory: true,
      multiple: false,
      defaultPath: pendingExternalCopy.destinationDirectory,
      title: t("sidebar.externalCopyChooseDirectory", { defaultValue: "选择目标目录" }),
    });

    if (typeof selected !== "string") return;

    setPendingExternalCopy((current) =>
      current ? { ...current, destinationDirectory: selected } : current
    );
  }, [pendingExternalCopy, t]);

  const handleConfirmExternalCopy = useCallback(async () => {
    if (!currentProject || !pendingExternalCopy || externalCopySubmitting) return;

    const destinationDirectory = pendingExternalCopy.destinationDirectory.trim();
    const nextName = pendingExternalCopy.newName.trim();
    const isSingleItem = pendingExternalCopy.sourcePaths.length === 1;
    const shouldRenameCopiedSingle = isExplicitExternalCopyRename(pendingExternalCopy);
    const destinationInsideProject = isPathInsideRoot(currentProject.path, destinationDirectory);

    if (!destinationDirectory) {
      message.warning(t("sidebar.externalCopyDestinationRequired", { defaultValue: "请输入目标目录" }));
      return;
    }

    if (isSingleItem && !nextName) {
      message.warning(t("sidebar.externalCopyNameRequired", { defaultValue: "请输入新名称" }));
      return;
    }

    if (isSingleItem && isInvalidEntryName(nextName)) {
      message.warning(t("sidebar.externalCopyInvalidName", { defaultValue: "名称不能包含路径分隔符，也不能是 . 或 .." }));
      return;
    }

    if (externalCopyValidation.conflictNames.length > 0) {
      message.warning(
        isSingleItem
          ? t("sidebar.externalCopyNameExists", { defaultValue: "目标目录已存在同名文件，请修改新名称后再确认" })
          : t("sidebar.externalCopyNamesExist", {
              defaultValue: "目标目录已存在同名项目：{{names}}",
              names: externalCopyValidation.conflictNames.join(", "),
            })
      );
      return;
    }

    setExternalCopySubmitting(true);
    try {
      if (shouldRenameCopiedSingle && destinationInsideProject) {
        const destinationListing = await listProjectDirectory(currentProject.path, destinationDirectory);
        const nameAlreadyExists = destinationListing.entries.some(
          (entry) => entry.name.toLocaleLowerCase() === nextName.toLocaleLowerCase()
        );
        if (nameAlreadyExists) {
          message.warning(t("sidebar.externalCopyNameExists", { defaultValue: "目标目录已存在同名文件，请修改新名称后再确认" }));
          return;
        }
      }

      const copiedPaths = await copyExternalEntry(
        currentProject.path,
        pendingExternalCopy.sourcePaths,
        destinationDirectory,
        shouldRenameCopiedSingle ? nextName : null
      );

      let finalPaths = copiedPaths;
      if (destinationInsideProject) {
        await refreshProjectView(destinationDirectory, true);
        if (finalPaths.length > 0) {
          setSelectedPaths(finalPaths);
          setSelectedPath(finalPaths[0] ?? destinationDirectory);
        } else {
          selectOnlyPath(destinationDirectory);
        }
      }

      if (
        pendingExternalCopy.openAfterCopy &&
        destinationInsideProject &&
        finalPaths.length === 1 &&
        finalPaths[0] &&
        isProbablyFilePath(finalPaths[0])
      ) {
        onOpenFile(finalPaths[0]);
      }

      setPendingExternalCopy(null);
      message.success(t("sidebar.copyExternalSuccess", { count: finalPaths.length }));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("sidebar.copyExternalFailed"));
    } finally {
      setExternalCopySubmitting(false);
    }
  }, [
    currentProject,
    externalCopySubmitting,
    externalCopyValidation.conflictNames,
    onOpenFile,
    pendingExternalCopy,
    refreshProjectView,
    selectOnlyPath,
    t,
  ]);

  useEffect(() => {
    if (!inlineCreate) {
      inlineCreateCommitInFlightRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      inlineCreateInputRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [inlineCreate]);

  const handleStartInlineCreate = useCallback(
    async (kind: "file" | "directory", parentPath: string) => {
      if (!currentProject || inlineCreateSubmitting || renameSubmitting) return;
      if (renamingEntry) {
        setRenamingEntry(null);
        setRenameValue("");
      }

      if (normalizePath(parentPath) !== normalizePath(currentProject.path)) {
        const pathsToExpand = getDirectoryPathsToExpand(currentProject.path, parentPath, true);
        for (const path of pathsToExpand) {
          if (!loadedDirectories[path]) {
            await loadDirectory(path);
          }
        }
        setExpandedPaths((prev) => {
          const next = { ...prev };
          for (const path of pathsToExpand) {
            next[path] = true;
          }
          return next;
        });
      } else {
        await Promise.resolve();
      }

      setInlineCreate({
        kind,
        parentPath,
        value: "",
      });
    },
    [
      currentProject,
      inlineCreateSubmitting,
      loadDirectory,
      loadedDirectories,
      renameSubmitting,
      renamingEntry,
    ]
  );

  const handleCancelInlineCreate = useCallback(() => {
    if (inlineCreateSubmitting) return;
    inlineCreateCommitInFlightRef.current = false;
    setInlineCreate(null);
    treeContainerRef.current?.focus({ preventScroll: true });
  }, [inlineCreateSubmitting]);

  const handleConfirmInlineCreate = useCallback(async () => {
    if (!currentProject || !inlineCreate || inlineCreateCommitInFlightRef.current) return;

    const trimmedName = inlineCreate.value.trim();
    if (!trimmedName) {
      handleCancelInlineCreate();
      return;
    }

    if (isInvalidEntryName(trimmedName)) {
      message.warning(t("sidebar.invalidEntryName"));
      window.setTimeout(() => inlineCreateInputRef.current?.focus(), 0);
      return;
    }

    inlineCreateCommitInFlightRef.current = true;
    setInlineCreateSubmitting(true);
    try {
      const nextPath =
        inlineCreate.kind === "file"
          ? await createProjectFile(currentProject.path, inlineCreate.parentPath, trimmedName)
          : await createProjectDirectory(currentProject.path, inlineCreate.parentPath, trimmedName);
      const createdKind = inlineCreate.kind;
      setInlineCreate(null);
      await refreshProjectView(nextPath, createdKind === "directory");
      if (createdKind === "file") {
        onOpenFile(nextPath);
      }
    } catch (nextError) {
      message.error(
        nextError instanceof Error
          ? nextError.message
          : inlineCreate.kind === "file"
          ? t("sidebar.resourceFileCreateFailed")
          : t("sidebar.resourceFolderCreateFailed")
      );
      window.setTimeout(() => inlineCreateInputRef.current?.focus(), 0);
    } finally {
      inlineCreateCommitInFlightRef.current = false;
      setInlineCreateSubmitting(false);
    }
  }, [currentProject, handleCancelInlineCreate, inlineCreate, onOpenFile, refreshProjectView, t]);

  const handleConfirmDelete = useCallback(async () => {
    if (!currentProject || deletingEntries.length === 0) return;

    setDeleteSubmitting(true);
    try {
      for (const entry of deletingEntries) {
        await deleteProjectEntry(currentProject.path, entry.path);
      }
      setDeletingEntries([]);
      const fallbackPath =
        deletingEntries.length === 1
          ? getParentPath(currentProject.path, deletingEntries[0].path)
          : currentProject.path;
      await refreshProjectView(fallbackPath, true);
      selectOnlyPath(fallbackPath);
      message.success(t("sidebar.resourceDeleted"));
    } catch (nextError) {
      message.error(
        nextError instanceof Error ? nextError.message : t("sidebar.resourceDeleteFailed")
      );
    } finally {
      setDeleteSubmitting(false);
    }
  }, [currentProject, deletingEntries, refreshProjectView, selectOnlyPath, t]);

  const handleBackgroundMenuClick: NonNullable<MenuProps["onClick"]> = useCallback(
    ({ key, domEvent }) => {
      domEvent.preventDefault();
      domEvent.stopPropagation();
      // Blank space represents the project root, independently of keyboard selection.
      selectOnlyPath(projectRootPath);

      if (key === "create-file") {
        void handleStartInlineCreate("file", projectRootPath);
        return;
      }

      if (key === "create-folder") {
        void handleStartInlineCreate("directory", projectRootPath);
        return;
      }

      if (key === "paste") {
        void handlePasteFromClipboard(projectRootPath);
        return;
      }

      if (key === "refresh") {
        handleRefresh();
        return;
      }

      if (key === "open-current-directory") {
        onOpenInFileManager(projectRootPath);
        return;
      }

      if (key === "find-in-directory") {
        openGlobalTextSearch(projectRootPath);
      }
    },
    [projectRootPath, handleStartInlineCreate, handlePasteFromClipboard, handleRefresh, onOpenInFileManager, selectOnlyPath]
  );

  const backgroundMenuItems = useMemo<MenuProps["items"]>(
    () => [
      {
        key: "create-file",
        icon: <FileOutlined />,
        label: t("sidebar.createFile"),
      },
      {
        key: "create-folder",
        icon: <FolderOutlined />,
        label: t("sidebar.createFolder"),
      },
      {
        key: "paste",
        icon: <SnippetsOutlined />,
        label: t("common.paste"),
        disabled: !canPaste,
      },
      { type: "divider" },
      {
        key: "open-current-directory",
        icon: <FolderOpenFilled />,
        label: t("sidebar.openCurrentDirectoryInManager"),
      },
    ],
    [canPaste, t]
  );

  const renderInlineCreateRow = useCallback(
    (depth: number, inheritedTone?: FolderTone): ReactNode => {
      if (!inlineCreate) return null;
      const isDirectory = inlineCreate.kind === "directory";
      const previewName = inlineCreate.value.trim() || (isDirectory ? "folder" : "file");
      const visual = getFileIcon(previewName, isDirectory, false, inheritedTone);

      return (
        <div
          key="__inline-create__"
          className="app-file-tree-row w-full text-left"
          data-inline-create="true"
          data-kind={inlineCreate.kind}
          data-folder-tone={visual.tone}
          style={{ paddingLeft: 8 + depth * 16 }}
          onClick={(event) => event.stopPropagation()}
        >
          {isDirectory ? (
            <TreeDisclosure expanded={false} loading={false} />
          ) : (
            <span className="app-file-tree-arrow" aria-hidden="true" />
          )}
          <span className="app-file-tree-icon" style={{ color: visual.color }}>
            {visual.icon}
          </span>
          <Input
            ref={inlineCreateInputRef}
            size="small"
            value={inlineCreate.value}
            placeholder={
              isDirectory ? t("sidebar.newFolderPlaceholder") : t("sidebar.newFilePlaceholder")
            }
            onChange={(event) => {
              const nextValue = event.target.value;
              setInlineCreate((prev) => (prev ? { ...prev, value: nextValue } : prev));
            }}
            onPressEnter={() => void handleConfirmInlineCreate()}
            onBlur={(event) => {
              const related = event.relatedTarget as HTMLElement | null;
              if (
                !inlineCreate.value.trim() &&
                related &&
                (related === treeContainerRef.current ||
                  !!related.closest('.app-file-tree-row, [role="menu"], [role="menuitem"]'))
              ) {
                window.requestAnimationFrame(() => {
                  inlineCreateInputRef.current?.focus();
                });
                return;
              }
              void handleConfirmInlineCreate();
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") {
                event.preventDefault();
                handleCancelInlineCreate();
              }
            }}
            disabled={inlineCreateSubmitting}
            className="min-w-0"
          />
        </div>
      );
    },
    [
      handleCancelInlineCreate,
      handleConfirmInlineCreate,
      inlineCreate,
      inlineCreateSubmitting,
      t,
    ]
  );

  const activeContextMenu = useMemo<{ items: MenuProps["items"]; onClick: NonNullable<MenuProps["onClick"]> }>(() => {
    if (contextMenuPath === "__background__" || !contextMenuEntry) {
      return {
        items: backgroundMenuItems,
        onClick: (info) => {
          setContextMenuPath(null);
          if (info.key !== "create-file" && info.key !== "create-folder") {
            treeContainerRef.current?.focus({ preventScroll: true });
          }
          handleBackgroundMenuClick(info);
        },
      };
    }

    const entry = contextMenuEntry;
    const isDirectory = entry.kind === "directory";
    const isSelected = normalizedSelectedPaths.has(normalizePath(entry.path));
    const selectionCount = actionableSelectedEntries.length;
    const relativePath = currentProject ? buildRelativePath(currentProject.path, entry.path) : entry.path;

    const items: MenuProps["items"] = [
      { key: "create-file", icon: <FileOutlined />, label: t("sidebar.createFile") },
      { key: "create-folder", icon: <FolderOutlined />, label: t("sidebar.createFolder") },
      { type: "divider" },
      ...(isDirectory
        ? []
        : [{ key: "open-in-associated-app", icon: <ExportOutlined />, label: openInAssociatedAppText }]),
      ...(isDirectory
        ? [{ key: "find-in-directory", icon: <SearchOutlined />, label: t("globalSearch.findInDirectory") }]
        : []),
      { key: "open-in-manager", icon: <FolderOpenFilled />, label: openInManagerText },
      ...(!isDirectory
        ? [{ key: "git-file-history", icon: <HistoryOutlined />, label: t("sidebar.gitFileHistory") }]
        : []),
      { key: "copy", icon: <CopyOutlined />, label: t("common.copy") },
      { key: "cut", icon: <ScissorOutlined />, label: t("common.cut") },
      ...(isDirectory
        ? [{ key: "paste", icon: <SnippetsOutlined />, label: t("common.paste"), disabled: !canPaste }]
        : []),
      {
        key: "copy-path",
        icon: <CopyOutlined />,
        label: t("common.copyPath"),
        children: [
          { key: "copy-relative-path", label: copyRelativePathText },
          { key: "copy-absolute-path", label: copyAbsolutePathText },
        ],
      },
      { type: "divider" },
      { key: "rename", icon: <EditOutlined />, label: t("common.rename") },
      { key: "delete", icon: <DeleteOutlined />, label: t("common.delete"), danger: true },
    ];

    const onClick: NonNullable<MenuProps["onClick"]> = async ({ key, domEvent }) => {
      setContextMenuPath(null);
      if (key !== "create-file" && key !== "create-folder" && key !== "rename") {
        treeContainerRef.current?.focus({ preventScroll: true });
      }
      domEvent.preventDefault();
      domEvent.stopPropagation();
      if (!(isSelected && selectionCount > 1)) {
        selectOnlyPath(entry.path);
      }

      if (key === "create-file") {
        void handleStartInlineCreate("file", getCreateTargetDirectory(projectRootPath, entry));
        return;
      }
      if (key === "create-folder") {
        void handleStartInlineCreate("directory", getCreateTargetDirectory(projectRootPath, entry));
        return;
      }
      if (key === "copy") {
        handleCopyEntries(isSelected && selectionCount > 1 ? actionableSelectedEntries : [entry]);
        return;
      }
      if (key === "cut") {
        handleCutEntries(isSelected && selectionCount > 1 ? actionableSelectedEntries : [entry]);
        return;
      }
      if (key === "paste") {
        void handlePasteFromClipboard(getCreateTargetDirectory(projectRootPath, entry));
        return;
      }
      if (key === "open-in-associated-app") {
        onOpenInAssociatedApp(entry.path);
        return;
      }
      if (key === "open-in-manager") {
        onOpenInFileManager(entry.path);
        return;
      }
      if (key === "git-file-history" && !isDirectory && currentProject) {
        const state = useAppStore.getState();
        state.setSidebarCollapsed(false);
        state.setActiveSidebarSection("git");
        dispatchGitFileHistoryOpen({ projectPath: currentProject.path, filePath: relativePath });
        return;
      }
      if (key === "find-in-directory" && isDirectory) {
        openGlobalTextSearch(entry.path);
        return;
      }
      if (key === "copy-relative-path") {
        await navigator.clipboard.writeText(relativePath);
        showWorkbenchFeedback(copyPathSuccessText);
        return;
      }
      if (key === "copy-absolute-path") {
        await navigator.clipboard.writeText(entry.path);
        showWorkbenchFeedback(copyPathSuccessText);
        return;
      }
      if (key === "rename") {
        handleOpenRename(entry);
        return;
      }
      if (key === "delete") {
        handleRequestDeleteEntries(
          isSelected && selectionCount > 1 ? actionableSelectedEntries : [entry]
        );
      }
    };

    return { items, onClick };
  }, [
    actionableSelectedEntries,
    backgroundMenuItems,
    canPaste,
    contextMenuEntry,
    contextMenuPath,
    copyAbsolutePathText,
    copyPathSuccessText,
    copyRelativePathText,
    currentProject,
    handleBackgroundMenuClick,
    handleCopyEntries,
    handleCutEntries,
    handleOpenRename,
    handlePasteFromClipboard,
    handleRequestDeleteEntries,
    handleStartInlineCreate,
    normalizedSelectedPaths,
    onOpenInAssociatedApp,
    onOpenInFileManager,
    openInAssociatedAppText,
    openInManagerText,
    projectRootPath,
    selectOnlyPath,
    setContextMenuPath,
    t,
  ]);

  const renderFlatRows = useCallback(
    () =>
      visibleFlatRows.map((item, visibleIndex) => {
        const flatIndex = virtualWindow.startIndex + visibleIndex;
        const prevRowTone = flatRows[flatIndex - 1]?.rowTone;
        const nextRowTone = flatRows[flatIndex + 1]?.rowTone;
        const excludedPrev = item.rowTone === "excluded" && prevRowTone === "excluded";
        const excludedNext = item.rowTone === "excluded" && nextRowTone === "excluded";

        if (item.kind === "inline-create") {
          return renderInlineCreateRow(item.depth, item.inheritedTone);
        }

        const { node, depth, inheritedTone, inheritedIgnored } = item;
        const { entry, isExpanded, isLoadingChildren } = node;
        const isDirectory = entry.kind === "directory";
        const isActive = selectedPath === entry.path;
        const isSelected = normalizedSelectedPaths.has(normalizePath(entry.path));
        const selectionCount = actionableSelectedEntries.length;
        const isRenaming =
          !!renamingEntry && normalizePath(renamingEntry.path) === normalizePath(entry.path);
        const visual = getFileIcon(entry.name, isDirectory, isExpanded, inheritedTone);
        const rowTone = visual.tone ?? inheritedTone;
        const isGitIgnored = (!!entry.ignored || !!inheritedIgnored) && rowTone !== "excluded";
        const gitStatus = getTreeEntryGitStatus(gitStatusIndex, entry.path, isDirectory);
        const gitBadge = gitStatus ? getTreeGitBadge(gitStatus) : null;

        return (
          <div
            key={item.key}
            id={`${treeId}-${encodeURIComponent(entry.path)}`}
            role="treeitem"
            aria-label={entry.name}
            aria-level={depth + 1}
            aria-selected={isSelected}
            aria-expanded={isDirectory ? isExpanded : undefined}
            aria-busy={isLoadingChildren || undefined}
          >
            {isRenaming ? (
              <div
                className="app-file-tree-row w-full text-left"
                data-active={isActive ? "true" : "false"}
                data-selected={isSelected ? "true" : "false"}
                data-folder-tone={rowTone}
                data-excluded-prev={excludedPrev ? "true" : undefined}
                data-excluded-next={excludedNext ? "true" : undefined}
                data-git-ignored={isGitIgnored ? "true" : undefined}
                data-git-tone={gitBadge?.tone}
                data-path={entry.path}
                data-drag-over={isDirectory && dragOverPath === entry.path ? "true" : "false"}
                style={{ paddingLeft: 8 + depth * 16 }}
                onClick={(event) => event.stopPropagation()}
              >
                {isDirectory ? (
                  <TreeDisclosure expanded={isExpanded} loading={isLoadingChildren} />
                ) : (
                  <span className="app-file-tree-arrow" aria-hidden="true" />
                )}
                <span className="app-file-tree-icon" style={{ color: visual.color }}>
                  {visual.icon}
                </span>
                <Input
                  ref={renameInputRef}
                  size="small"
                  value={renameValue}
                  status={renameSubmitting ? undefined : undefined}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onPressEnter={() => void handleConfirmRename()}
                  onBlur={() => {
                    void handleConfirmRename();
                  }}
                  onKeyDown={(event) => {
                    // 重命名输入框中的按键不应触发文件树快捷键（如 Delete 删除文件）。
                    event.stopPropagation();
                    if (event.key === "Escape") {
                      event.preventDefault();
                      handleCancelRename();
                    }
                  }}
                  disabled={renameSubmitting}
                  className="min-w-0"
                />
              </div>
            ) : (
              <button
                type="button"
                tabIndex={-1}
                className="app-file-tree-row w-full text-left"
                data-active={isActive ? "true" : "false"}
                data-selected={isSelected ? "true" : "false"}
                data-folder-tone={rowTone}
                data-excluded-prev={excludedPrev ? "true" : undefined}
                data-excluded-next={excludedNext ? "true" : undefined}
                data-git-ignored={isGitIgnored ? "true" : undefined}
                data-git-tone={gitBadge?.tone}
                data-cut={
                  clipboardOperation === "cut" &&
                  clipboardPaths.some((path) => normalizePath(path) === normalizePath(entry.path))
                    ? "true"
                    : "false"
                }
                data-path={entry.path}
                data-drag-over={isDirectory && dragOverPath === entry.path ? "true" : "false"}
                style={{ paddingLeft: 8 + depth * 16 }}
                onMouseDown={(event) => {
                  event.preventDefault();
                  treeContainerRef.current?.focus({ preventScroll: true });
                }}
                onContextMenu={() => {
                  if (!(isSelected && selectionCount > 1)) {
                    selectOnlyPath(entry.path);
                  }
                  setContextMenuEntry(entry);
                  setContextMenuPath(entry.path);
                }}
                onPointerDown={(event) => handleStartResourceDrag(event, entry)}
                onClick={(event) => {
                  if (suppressNextClickPathRef.current === entry.path) {
                    suppressNextClickPathRef.current = null;
                    return;
                  }
                  const isMultiSelectGesture = handleSelectEntry(entry, event);
                  if (isMultiSelectGesture) {
                    return;
                  }
                  if (isDirectory) {
                    void handleToggleDirectory(entry);
                    return;
                  }
                  onOpenFile(entry.path);
                }}
                onDoubleClick={() => {
                  if (!isDirectory) {
                    onOpenFile(entry.path, { preview: false });
                  }
                }}
              >
                {isDirectory ? (
                  <TreeDisclosure expanded={isExpanded} loading={isLoadingChildren} />
                ) : (
                  <span className="app-file-tree-arrow" aria-hidden="true" />
                )}
                <span className="app-file-tree-icon" style={{ color: visual.color }}>
                  {visual.icon}
                </span>
                <span className="app-file-tree-name truncate min-w-0 flex-1">{entry.name}</span>
                {gitBadge && !isDirectory ? (
                  <span className="app-file-tree-git-badge" aria-hidden="true">
                    {gitBadge.label}
                  </span>
                ) : null}
              </button>
            )}
          </div>
        );
      }),
    [
      actionableSelectedEntries.length,
      clipboardOperation,
      clipboardPaths,
      dragOverPath,
      flatRows,
      gitStatusIndex,
      handleCancelRename,
      handleConfirmRename,
      handleSelectEntry,
      handleStartResourceDrag,
      handleToggleDirectory,
      normalizedSelectedPaths,
      onOpenFile,
      renameSubmitting,
      renameValue,
      renamingEntry,
      renderInlineCreateRow,
      selectedPath,
      selectOnlyPath,
      setContextMenuPath,
      treeId,
      virtualWindow.startIndex,
      visibleFlatRows,
    ]
  );

  const handleTreeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      // Portaled context menus belong to this React subtree, but own their keys.
      if (!event.currentTarget.contains(target) ||
        target.closest("input, textarea, [contenteditable='true']") || event.nativeEvent.isComposing ||
        loadingRoot || error || contextMenuPath !== null) return;
      const hasPrimaryModifier = event.ctrlKey || event.metaKey;
      const lowerKey = event.key.toLowerCase();

      if (!hasPrimaryModifier && !event.altKey &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        if ((event.key === "Enter" || event.key === " ") && (event.repeat || event.shiftKey)) return;
        const action = getTreeNavigation(visibleTree, selectedPath, event.key);
        if (!action) return;
        if (action.type === "select") {
          if (event.shiftKey) {
            const anchor = selectionAnchorPath ?? selectedPath ?? action.path;
            const anchorIndex = visibleSelectablePaths.indexOf(anchor);
            const nextIndex = visibleSelectablePaths.indexOf(action.path);
            setSelectedPaths(anchorIndex < 0 ? [action.path] :
              visibleSelectablePaths.slice(Math.min(anchorIndex, nextIndex), Math.max(anchorIndex, nextIndex) + 1));
            setSelectionAnchorPath(anchorIndex < 0 ? action.path : anchor);
            setSelectedPath(action.path);
          } else {
            selectOnlyPath(action.path);
          }
        } else if (action.type === "open") {
          onOpenFile(action.path, { preview: false });
        } else if (action.type === "preview") {
          onOpenFile(action.path, { preview: true });
        } else {
          const entry = knownEntries.find((item) => item.path === action.path);
          if (entry) void handleToggleDirectory(entry);
        }
        return;
      }

      if (!hasPrimaryModifier && !event.shiftKey && !event.altKey && event.key === "F2") {
        if (renameSubmitting || inlineCreate || !selectedPath || normalizePath(selectedPath) === normalizePath(projectRootPath)) {
          return;
        }
        const entry = knownEntries.find(
          (item) => normalizePath(item.path) === normalizePath(selectedPath)
        );
        if (!entry) return;
        event.preventDefault();
        event.stopPropagation();
        handleOpenRename(entry);
        return;
      }

      if (hasPrimaryModifier && !event.shiftKey && !event.altKey && lowerKey === "c") {
        if (!canCopySelection) return;
        event.preventDefault();
        event.stopPropagation();
        handleCopyEntries(actionableSelectedEntries);
        return;
      }

      if (hasPrimaryModifier && !event.shiftKey && !event.altKey && lowerKey === "x") {
        if (!canCutSelection) return;
        event.preventDefault();
        event.stopPropagation();
        handleCutEntries(actionableSelectedEntries);
        return;
      }

      if (hasPrimaryModifier && !event.shiftKey && !event.altKey && lowerKey === "v") {
        if (!canPaste) return;
        event.preventDefault();
        event.stopPropagation();
        void handlePasteFromClipboard(selectionTargetDirectory);
        return;
      }

      if (!hasPrimaryModifier && !event.shiftKey && !event.altKey && (event.key === "Delete" || event.key === "Backspace")) {
        if (!canDeleteSelection) return;
        event.preventDefault();
        event.stopPropagation();
        handleRequestDeleteEntries(actionableSelectedEntries);
        return;
      }

      if (event.key === "Escape" && selectedPaths.length > 1) {
        event.preventDefault();
        event.stopPropagation();
        selectOnlyPath(selectedPath ?? selectionTargetDirectory);
      }
    },
    [
      actionableSelectedEntries,
      selectionTargetDirectory,
      canCopySelection,
      canCutSelection,
      canDeleteSelection,
      canPaste,
      handleCopyEntries,
      handleCutEntries,
      handlePasteFromClipboard,
      handleRequestDeleteEntries,
      selectOnlyPath,
      selectedPath,
      selectedPaths.length,
      visibleTree,
      selectionAnchorPath,
      visibleSelectablePaths,
      knownEntries,
      handleToggleDirectory,
      handleOpenRename,
      inlineCreate,
      projectRootPath,
      renameSubmitting,
      onOpenFile,
      loadingRoot,
      error,
      contextMenuPath,
    ]
  );

  if (!currentProject) {
    return <Empty description={noProjectText} className="mt-16" image={<WorkbenchEmptyArtwork kind="folder" />} />;
  }

  return (
    <div className="app-sidebar-panel flex h-full min-h-0 flex-col">
      <div
        className="app-file-tree-header flex items-center justify-between gap-2 px-2 pb-2 pt-1"
        style={{ borderBottom: "1px solid var(--cs-border-sidebar)" }}
      >
        <Tooltip title={currentProject.path} mouseEnterDelay={0.4}>
          <div
            className="min-w-0 truncate text-sm font-semibold"
            style={{ color: "var(--cs-text-primary)" }}
          >
            {currentProject.name || panelTitle}
          </div>
        </Tooltip>
        <div className="app-file-tree-toolbar flex shrink-0 items-center gap-1">
          <Tooltip title={t("sidebar.locateActiveFile")} mouseEnterDelay={0.4}>
            <button
              type="button"
              className="app-file-toolbar-button"
              disabled={!activeProjectFilePath}
              onClick={() => {
                if (activeProjectFilePath) {
                  void revealPath(activeProjectFilePath, false);
                }
              }}
              aria-label={t("sidebar.locateActiveFile")}
            >
              <AimOutlined />
            </button>
          </Tooltip>
          <Tooltip title={t("sidebar.collapseAll")} mouseEnterDelay={0.4}>
            <button
              type="button"
              className="app-file-toolbar-button"
              onClick={handleCollapseAll}
              aria-label={t("sidebar.collapseAll")}
            >
              <CompressOutlined />
            </button>
          </Tooltip>
          <Tooltip title={refreshText} mouseEnterDelay={0.4}>
            <button
              type="button"
              className="app-file-toolbar-button"
              onClick={handleRefresh}
              aria-label={refreshText}
            >
              <ReloadOutlined />
            </button>
          </Tooltip>
          <Tooltip title={t("titleBar.collapseSidebar")} mouseEnterDelay={0.4}>
            <button
              type="button"
              className="app-file-toolbar-button"
              onClick={() => useAppStore.getState().setSidebarCollapsed(true)}
              aria-label={t("titleBar.collapseSidebar")}
            >
              <MinusOutlined />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 flex-col px-1 py-2">
        <Dropdown
          autoFocus
          open={contextMenuPath !== null}
          onOpenChange={(open) => {
            if (!open) {
              handleContextMenuOpenChange(contextMenuPathRef.current ?? "__background__", false);
            }
          }}
          menu={activeContextMenu}
          trigger={["contextMenu"]}
        >
          <div
            ref={treeContainerRef}
            className="app-project-tree-scroll relative mt-1 flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
            style={{ paddingBottom: 40 }}
            data-explorer-shortcuts="true"
            role="tree"
            aria-label={panelTitle}
            aria-multiselectable="true"
            aria-activedescendant={!loadingRoot && !error && selectedPath && visibleSelectablePaths.includes(selectedPath)
              ? `${treeId}-${encodeURIComponent(selectedPath)}` : undefined}
            data-drag-over={isExternalDragOver && !dragOverPath ? "true" : "false"}
            tabIndex={0}
            onScroll={(event) => {
              setTreeScrollTop(event.currentTarget.scrollTop);
              if (Date.now() - programmaticScrollAtRef.current > 150) {
                lastManualScrollAtRef.current = Date.now();
              }
            }}
            onFocus={(event) => {
              if (!loadingRoot && !error && event.target === event.currentTarget && !visibleSelectablePaths.includes(selectedPath ?? "")) {
                selectOnlyPath(visibleSelectablePaths[0] ?? null);
              }
            }}
            onPointerDown={handleTreeMarqueePointerDown}
            onMouseDown={(event) => {
              const target = event.target as HTMLElement | null;
              if (target && event.currentTarget.contains(target) && !target.closest(".app-file-tree-row")) {
                treeContainerRef.current?.focus({ preventScroll: true });
                selectOnlyPath(projectRootPath);
              }
            }}
            onContextMenu={(event) => {
              const target = event.target as HTMLElement | null;
              if (target?.closest(".app-file-tree-row")) {
                return;
              }
              selectOnlyPath(projectRootPath);
              setContextMenuEntry(null);
              setContextMenuPath("__background__");
            }}
            onKeyDown={handleTreeKeyDown}
          >
            {error ? (
              <div className="flex items-center justify-between gap-2 px-2 py-3 text-[11px]" style={{ color: "#ff7875" }}>
                <span className="min-w-0 break-words">{error}</span>
                <Button
                  size="small"
                  type="link"
                  onClick={handleRetry}
                  className="shrink-0 px-1 text-[11px]"
                >
                  {t("common.retry")}
                </Button>
              </div>
            ) : loadingRoot ? (
              <div className="flex items-center gap-2 px-2 py-3 text-[11px]" style={{ color: "var(--cs-text-tertiary)" }}>
                <Spin size="small" />
                <span>{loadingText}</span>
              </div>
            ) : flatRows.length > 0 ? (
              <div
                className="min-w-0"
                style={{
                  paddingTop: virtualWindow.paddingTop,
                  paddingBottom: virtualWindow.paddingBottom,
                }}
              >
                {renderFlatRows()}
              </div>
            ) : (
              <div className="px-2 py-3 text-[11px]" style={{ color: "var(--cs-text-tertiary)" }}>
                {emptyFolderText}
              </div>
            )}
            {marqueeRect ? (
              <div
                data-testid="explorer-marquee-box"
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: marqueeRect.left,
                  top: marqueeRect.top,
                  width: marqueeRect.width,
                  height: marqueeRect.height,
                  border: "1px solid color-mix(in srgb, var(--cs-primary) 72%, transparent)",
                  background: "color-mix(in srgb, var(--cs-primary) 14%, transparent)",
                  borderRadius: 2,
                  pointerEvents: "none",
                  zIndex: 5,
                }}
              />
            ) : null}
          </div>
        </Dropdown>
      </div>

      <Modal
        centered
        title={
          pendingExternalCopy
            ? pendingExternalCopy.sourcePaths.length === 1
              ? t("sidebar.externalCopyTitleSingle", {
                  defaultValue: "复制文件 {{name}}",
                  name: getBaseName(pendingExternalCopy.sourcePaths[0] ?? ""),
                })
              : t("sidebar.externalCopyTitleMultiple", {
                  defaultValue: "复制 {{count}} 个项目",
                  count: pendingExternalCopy.sourcePaths.length,
                })
            : t("common.copy")
        }
        open={!!pendingExternalCopy}
        okText={t("common.confirm")}
        cancelText={t("common.cancel")}
        confirmLoading={externalCopySubmitting}
        okButtonProps={{
          disabled:
            externalCopySubmitting ||
            externalCopyValidation.hasBlankName ||
            externalCopyValidation.hasInvalidName ||
            externalCopyValidation.conflictNames.length > 0 ||
            !pendingExternalCopy?.destinationDirectory.trim(),
        }}
        onOk={() => void handleConfirmExternalCopy()}
        onCancel={() => {
          if (externalCopySubmitting) return;
          setPendingExternalCopy(null);
        }}
        destroyOnHidden
        width={680}
      >
        {pendingExternalCopy ? (
          <div className="space-y-4 pt-1">
            <div className="rounded-[8px] px-3 py-2 text-[12px]"
              style={{
                background: "color-mix(in srgb, var(--cs-bg-hover) 78%, transparent)",
                color: "var(--cs-text-secondary)",
              }}
            >
              {pendingExternalCopy.sourcePaths.length === 1 ? (
                <span className="break-all">{pendingExternalCopy.sourcePaths[0]}</span>
              ) : (
                <span>
                  {t("sidebar.externalCopySourceSummary", {
                    defaultValue: "已选择 {{count}} 个外部项目",
                    count: pendingExternalCopy.sourcePaths.length,
                  })}
                </span>
              )}
            </div>

            <label className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-3 text-[13px]">
              <span style={{ color: "var(--cs-text-secondary)" }}>
                {t("sidebar.externalCopyNewName", { defaultValue: "新名称" })}
              </span>
              <Input
                value={pendingExternalCopy.newName}
                disabled={pendingExternalCopy.sourcePaths.length !== 1 || externalCopySubmitting}
                status={
                  externalCopyValidation.hasInvalidName ||
                  externalCopyValidation.conflictNames.length > 0
                    ? "error"
                    : undefined
                }
                onChange={(event) =>
                  setPendingExternalCopy((current) =>
                    current ? { ...current, newName: event.target.value } : current
                  )
                }
              />
            </label>
            {externalCopyValidation.hasInvalidName ? (
              <div className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-3 text-[12px]">
                <span />
                <div
                  className="rounded-[6px] px-3 py-2"
                  style={{
                    background: "color-mix(in srgb, var(--cs-error) 12%, transparent)",
                    color: "color-mix(in srgb, var(--cs-error) 88%, var(--cs-text-primary) 12%)",
                  }}
                >
                  {t("sidebar.externalCopyInvalidName", {
                    defaultValue: "名称不能包含路径分隔符，也不能是 . 或 ..",
                  })}
                </div>
              </div>
            ) : null}
            {externalCopyValidation.conflictNames.length > 0 ? (
              <div className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-3 text-[12px]">
                <span />
                <div
                  className="rounded-[6px] px-3 py-2"
                  style={{
                    background: "color-mix(in srgb, var(--cs-error) 12%, transparent)",
                    color: "color-mix(in srgb, var(--cs-error) 88%, var(--cs-text-primary) 12%)",
                  }}
                >
                  {pendingExternalCopy.sourcePaths.length === 1
                    ? t("sidebar.externalCopyNameExists", {
                        defaultValue: "目标目录已存在同名文件，请修改新名称后再确认",
                      })
                    : t("sidebar.externalCopyNamesExist", {
                        defaultValue: "目标目录已存在同名项目：{{names}}",
                        names: externalCopyValidation.conflictNames.join(", "),
                      })}
                </div>
              </div>
            ) : null}

            <label className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-3 text-[13px]">
              <span className="pt-1.5" style={{ color: "var(--cs-text-secondary)" }}>
                {t("sidebar.externalCopyDestination", { defaultValue: "到目录" })}
              </span>
              <div className="min-w-0">
                <div className="flex min-w-0 gap-2">
                  <Input
                    value={pendingExternalCopy.destinationDirectory}
                    disabled={externalCopySubmitting}
                    onChange={(event) =>
                      setPendingExternalCopy((current) =>
                        current ? { ...current, destinationDirectory: event.target.value } : current
                      )
                    }
                  />
                  <Button
                    icon={<FolderOpenFilled />}
                    disabled={externalCopySubmitting}
                    onClick={() => void handleChooseExternalCopyDirectory()}
                  />
                </div>
                <div className="mt-1 text-[11px]" style={{ color: "var(--cs-text-tertiary)" }}>
                  {t("sidebar.externalCopyPathHint", {
                    defaultValue: "可直接输入任意存在的目录，也可以选择一个目录",
                  })}
                </div>
              </div>
            </label>

            <Checkbox
              checked={
                pendingExternalCopy.openAfterCopy &&
                isPathInsideRoot(projectRootPath, pendingExternalCopy.destinationDirectory)
              }
              disabled={
                pendingExternalCopy.sourcePaths.length !== 1 ||
                !isProbablyFilePath(pendingExternalCopy.newName) ||
                !isPathInsideRoot(projectRootPath, pendingExternalCopy.destinationDirectory) ||
                externalCopySubmitting
              }
              onChange={(event) =>
                setPendingExternalCopy((current) =>
                  current ? { ...current, openAfterCopy: event.target.checked } : current
                )
              }
            >
              {t("sidebar.externalCopyOpenAfterCopy", { defaultValue: "复制后在编辑器中打开" })}
            </Checkbox>
          </div>
        ) : null}
      </Modal>

      <Modal
        centered
        title={t("sidebar.resourceDeleteTitle")}
        open={deletingEntries.length > 0}
        okText={t("common.delete")}
        cancelText={t("common.cancel")}
        okButtonProps={{ danger: true }}
        onOk={() => void handleConfirmDelete()}
        confirmLoading={deleteSubmitting}
        onCancel={() => {
          if (deleteSubmitting) return;
          setDeletingEntries([]);
        }}
        destroyOnHidden
      >
        {deletingEntries.length > 1
          ? t("sidebar.resourceDeleteConfirmMultiple", { count: deletingEntries.length })
          : deletingEntries[0]
            ? t("sidebar.resourceDeleteConfirm", { name: deletingEntries[0].name })
            : null}
      </Modal>

      {dragPreview && typeof document !== "undefined"
        ? createPortal(
            <div
              className="app-file-drag-preview"
              style={{
                left: Math.max(8, Math.min(dragPreview.x + 14, window.innerWidth - 292)),
                top: Math.max(8, Math.min(dragPreview.y + 16, window.innerHeight - 44)),
              }}
            >
              <span
                className="app-file-tree-icon"
                style={{
                  color: getFileIcon(
                    dragPreview.entries[0]?.name ?? "",
                    dragPreview.entries[0]?.kind === "directory",
                    false
                  ).color,
                }}
              >
                {
                  getFileIcon(
                    dragPreview.entries[0]?.name ?? "",
                    dragPreview.entries[0]?.kind === "directory",
                    false
                  ).icon
                }
              </span>
              <span className="app-file-drag-preview-name">
                {dragPreview.entries[0]?.name ?? ""}
              </span>
              {dragPreview.entries.length > 1 ? (
                <span className="app-file-drag-preview-count">
                  {t("sidebar.dragItemsCount", { count: dragPreview.entries.length })}
                </span>
              ) : null}
              {dragPreview.hintKind === "move" && dragPreview.targetName ? (
                <span className="app-file-drag-preview-hint">
                  {t("sidebar.dragHintMove", { name: dragPreview.targetName })}
                </span>
              ) : dragPreview.hintKind === "terminal" ? (
                <span className="app-file-drag-preview-hint">
                  {t("sidebar.dragHintTerminal")}
                </span>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

export default SidebarProjectPanel;

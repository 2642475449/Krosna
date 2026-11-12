import type { Session } from "@/types";
import type { AppState, GitDiffDocumentState, LayoutNode, ProjectWorkspace } from "@/store/types";
import { createDefaultWorkspace, normalizeWorkspace } from "@/store/utils/workspace";
import { toPersistedSession } from "./sessions";

export interface RecoveredEditorView {
  lineNumber: number;
  column: number;
  scrollTop: number;
  scrollLeft: number;
}

export interface WorkspaceRecoveryPayload {
  version: 1;
  projectPath: string;
  updatedAt: number;
  sessions: Session[];
  workspace: ProjectWorkspace;
  editorViews: Record<string, RecoveredEditorView>;
  diffs: Record<string, Pick<GitDiffDocumentState, "path" | "oldPath" | "name" | "staged" | "revision">>;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function layoutValid(value: unknown, panes: Record<string, unknown>, seen = new Set<string>(), depth = 0): value is LayoutNode {
  if (!record(value) || depth > 12) return false;
  if (value.type === "pane") {
    if (typeof value.paneId !== "string" || !panes[value.paneId] || seen.has(value.paneId)) return false;
    seen.add(value.paneId);
    return true;
  }
  return value.type === "split" && (value.direction === "horizontal" || value.direction === "vertical")
    && typeof value.ratio === "number" && value.ratio > 0 && value.ratio < 1
    && layoutValid(value.first, panes, seen, depth + 1) && layoutValid(value.second, panes, seen, depth + 1);
}

/** 损坏的记录局部降级；绝不把旧进程的 active 状态当作当前运行状态。 */
export function normalizeWorkspaceRecovery(value: unknown, projectPath: string): WorkspaceRecoveryPayload | null {
  if (!record(value) || value.version !== 1 || value.projectPath !== projectPath || !Array.isArray(value.sessions)
    || !record(value.workspace)) return null;
  const sessions = value.sessions.filter((item): item is Session => record(item)
    && typeof item.id === "string" && item.id.length > 0 && item.id.length <= 256
    && item.path === projectPath && typeof item.name === "string" && typeof item.createdAt === "number"
    && (item.agentId === undefined || ["claude", "codex", "pi", "opencode", "antigravity", "qoder", "cmd", "powershell"].includes(String(item.agentId)))
    && item.presentation !== "auxiliary" && item.presentation !== "bottom-runner" && !item.archived)
    .slice(0, 200).map(toPersistedSession);
  const raw = value.workspace;
  if (!record(raw.tabsById) || !record(raw.panesById) || !record(raw.layout)) return null;
  const workspace = createDefaultWorkspace();
  const sessionIds = new Set(sessions.map((session) => session.id));
  for (const [id, tab] of Object.entries(raw.tabsById).slice(0, 200)) {
    if (!record(tab) || tab.id !== id || typeof tab.resourceId !== "string" || typeof tab.title !== "string") continue;
    if (!(tab.kind === "session" && sessionIds.has(id)) && !["file", "diff", "settings", "scheduled-tasks"].includes(String(tab.kind))) continue;
    workspace.tabsById[id] = {
      id, kind: tab.kind as typeof workspace.tabsById[string]["kind"], resourceId: tab.resourceId,
      title: tab.title, closable: true, pinned: tab.pinned === true, dirty: false, preview: false,
      createdAt: typeof tab.createdAt === "number" ? tab.createdAt : 0,
      lastActivatedAt: typeof tab.lastActivatedAt === "number" ? tab.lastActivatedAt : 0,
    };
  }
  workspace.panesById = {};
  const assigned = new Set<string>();
  for (const [id, pane] of Object.entries(raw.panesById).slice(0, 32)) {
    if (!record(pane) || !Array.isArray(pane.tabIds)) continue;
    const tabIds = pane.tabIds.filter((tabId): tabId is string => typeof tabId === "string" && !!workspace.tabsById[tabId] && !assigned.has(tabId));
    tabIds.forEach((tabId) => assigned.add(tabId));
    workspace.panesById[id] = {
      id, tabIds, activeTabId: typeof pane.activeTabId === "string" && tabIds.includes(pane.activeTabId) ? pane.activeTabId : tabIds.at(-1) ?? null,
      history: Array.isArray(pane.history) ? pane.history.filter((tabId): tabId is string => typeof tabId === "string" && tabIds.includes(tabId)) : [],
    };
  }
  const referencedPanes = new Set<string>();
  if (layoutValid(raw.layout.root, workspace.panesById, referencedPanes) && referencedPanes.size === Object.keys(workspace.panesById).length) {
    workspace.layout = { root: raw.layout.root };
  } else {
    // 结构损坏时保留有效标签，降级为单栏，避免递归崩溃或不可见标签。
    const tabIds = [...assigned];
    workspace.panesById = { main: { id: "main", tabIds, activeTabId: tabIds.at(-1) ?? null, history: tabIds } };
  }
  workspace.activePaneId = typeof raw.activePaneId === "string" ? raw.activePaneId : "main";
  workspace.focusedTabId = typeof raw.focusedTabId === "string" ? raw.focusedTabId : null;
  const editorViews: Record<string, RecoveredEditorView> = {};
  if (record(value.editorViews)) for (const [path, view] of Object.entries(value.editorViews)) {
    if (!record(view)) continue;
    const { lineNumber, column, scrollTop, scrollLeft } = view;
    if ([lineNumber, column, scrollTop, scrollLeft].every((part) => typeof part === "number" && Number.isFinite(part))
      && Number(lineNumber) >= 1 && Number(column) >= 1 && Number(scrollTop) >= 0 && Number(scrollLeft) >= 0) {
      editorViews[path] = { lineNumber: Number(lineNumber), column: Number(column), scrollTop: Number(scrollTop), scrollLeft: Number(scrollLeft) };
    }
  }
  const diffs: WorkspaceRecoveryPayload["diffs"] = {};
  if (record(value.diffs)) for (const [id, diff] of Object.entries(value.diffs)) {
    if (record(diff) && typeof diff.path === "string" && typeof diff.name === "string" && typeof diff.staged === "boolean") {
      diffs[id] = { path: diff.path, name: diff.name, staged: diff.staged,
        oldPath: typeof diff.oldPath === "string" ? diff.oldPath : undefined,
        revision: typeof diff.revision === "string" ? diff.revision : undefined };
    }
  }
  for (const [id, tab] of Object.entries(workspace.tabsById)) if (tab.kind === "diff" && !diffs[id]) delete workspace.tabsById[id];
  return { version: 1, projectPath, updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
    sessions, workspace: normalizeWorkspace(workspace, sessions), editorViews, diffs };
}

/** 工作现场与历史列表分开：普通 Shell 可以恢复标签，但不进入 Agent 历史。 */
export function captureWorkspaceRecovery(state: AppState, editorViews: Record<string, RecoveredEditorView>): WorkspaceRecoveryPayload | null {
  const projectPath = state.currentProject?.path;
  if (!projectPath) return null;
  const source = state.projectWorkspaces[projectPath];
  if (!source) return null;
  const ids = new Set(Object.keys(source.tabsById));
  const sessions = state.sessions.filter((session) => ids.has(session.id)).map(toPersistedSession);
  const filePaths = new Set(Object.values(source.tabsById).filter((tab) => tab.kind === "file").map((tab) => tab.resourceId));
  const openEditorViews = Object.fromEntries(Object.entries(editorViews).filter(([path]) => filePaths.has(path)));
  const diffs = Object.fromEntries(Object.entries(state.gitDiffDocuments).filter(([id, diff]) => ids.has(id) && !diff.revision)
    .map(([id, diff]) => [id, { path: diff.path, oldPath: diff.oldPath, name: diff.name, staged: diff.staged }]));
  return normalizeWorkspaceRecovery({ version: 1, projectPath, updatedAt: Date.now(), sessions,
    workspace: source, editorViews: openEditorViews, diffs }, projectPath);
}

export function getWorkspaceRestoreOrder(payload: WorkspaceRecoveryPayload): string[] {
  const opened = Object.values(payload.workspace.panesById).flatMap((pane) => pane.tabIds);
  const visible = [payload.workspace.focusedTabId, ...Object.values(payload.workspace.panesById).map((pane) => pane.activeTabId)];
  const sessionIds = new Set(payload.sessions.map((session) => session.id));
  return [...new Set([...visible, ...opened].filter((id): id is string => !!id && sessionIds.has(id)))];
}

import type { StateStorage } from "zustand/middleware";
import { normalizeArchivedSessionGroups } from "@/lib/archivedSessions";
import { transitionAttentionItems } from "@/lib/attention";
import { acknowledgeStoredSessionChanges, mutateStoredItem } from "@/lib/projectScopedStorage";
import { toPersistedSession } from "@/lib/sessions";
import type { Session } from "@/types";
import type { AppState, ArchiveSessionActions, ArchivedSessionTarget } from "../types";

type ArchiveState = Pick<AppState, "projectArchivedSessions" | "projectSessions" | "projectAttentionItems">;
type ArchiveChange = "restore" | "remove";

function groupTargets(targets: readonly ArchivedSessionTarget[]) {
  const projects = new Map<string, Set<string>>();
  for (const { projectPath, sessionId } of targets) {
    const ids = projects.get(projectPath) ?? new Set<string>();
    ids.add(sessionId);
    projects.set(projectPath, ids);
  }
  return projects;
}

function restoreSession({ archived: _archived, archivedAt: _time, ...session }: Session): Session {
  return session;
}

function prependMissingSessions(sessions: Session[], restored: Session[]): Session[] {
  const existing = new Set(sessions.map(({ id }) => id));
  const additions = restored.filter(({ id }) => {
    if (existing.has(id)) return false;
    existing.add(id);
    return true;
  });
  return [...additions, ...sessions];
}

function expireAttention(
  items: ArchiveState["projectAttentionItems"][string] = [],
  ids: ReadonlySet<string>,
  now: number,
) {
  return transitionAttentionItems(items, (item) => ids.has(item.sessionId), "expired", "session-deleted", now);
}

interface ArchiveActionOptions {
  set: (updater: (state: AppState) => Partial<AppState>) => void;
  storage: StateStorage;
  storageKey: string;
  syncCurrentProject: (state: AppState, path: string, sessions: Session[]) => Partial<AppState>;
}

export function createArchivedSessionActions({ set, storage, storageKey, syncCurrentProject }: ArchiveActionOptions): ArchiveSessionActions {
  async function applyChange(targets: readonly ArchivedSessionTarget[], change: ArchiveChange) {
    const projects = groupTargets(targets);
    if (projects.size === 0) return 0;
    const now = Date.now();

    // 只修改存储中的目标会话，不把本窗口看到的其他项目旧快照写回。
    const { count, restored, removed } = await mutateStoredItem(storage, storageKey, (current) => {
      const envelope = current === null ? null : JSON.parse(current) as { state?: Partial<ArchiveState> };
      const persisted = envelope?.state;
      const restored = new Map<string, Session[]>();
      const removed = new Map<string, Set<string>>();
      let count = 0;
      if (persisted) {
        for (const [path, ids] of projects) {
          const storedRows = persisted.projectArchivedSessions?.[path];
          const archived = Array.isArray(storedRows) ? storedRows : [];
          const affected = archived.filter((row) => row && ids.has(row.id));
          if (change === "restore") {
            const existing = persisted.projectSessions?.[path] ?? [];
            const normalized = normalizeArchivedSessionGroups({ [path]: affected })[path] ?? [];
            const sessions = normalized.map(restoreSession);
            restored.set(path, prependMissingSessions(existing.filter(({ id }) => ids.has(id)), sessions));
            if (sessions.length > 0) {
              persisted.projectSessions = {
                ...persisted.projectSessions,
                [path]: prependMissingSessions(existing, sessions),
              };
            }
          }
          if (affected.length === 0) continue;
          const affectedIds = new Set(affected.map(({ id }) => id));
          count += affectedIds.size;
          removed.set(path, affectedIds);
          persisted.projectArchivedSessions = {
            ...persisted.projectArchivedSessions,
            [path]: archived.filter((row) => !row || !ids.has(row.id)),
          };
          if (change === "remove" && persisted.projectAttentionItems?.[path]) {
            persisted.projectAttentionItems[path] = expireAttention(persisted.projectAttentionItems[path], affectedIds, now);
          }
        }
      }
      return { value: count > 0 ? JSON.stringify(envelope) : current, result: { count, restored, removed } };
    });

    // 事务成功后一次性更新列表，保留本窗口未参与操作的会话及运行状态。
    set((state) => {
      const activePath = state.currentProject?.path;
      const projectArchivedSessions = { ...state.projectArchivedSessions };
      const projectSessions = change === "restore" ? { ...state.projectSessions } : state.projectSessions;
      const projectAttentionItems = change === "remove" ? { ...state.projectAttentionItems } : state.projectAttentionItems;
      let activeSessions: Session[] | undefined;
      for (const [path, ids] of projects) {
        projectArchivedSessions[path] = (projectArchivedSessions[path] ?? []).filter(({ id }) => !ids.has(id));
        const removedIds = removed.get(path);
        const restoredSessions = restored.get(path);
        if (change === "remove" && removedIds) {
          projectAttentionItems[path] = expireAttention(projectAttentionItems[path], removedIds, now);
        } else if (restoredSessions?.length) {
          projectSessions[path] = prependMissingSessions(projectSessions[path] ?? [], restoredSessions);
          if (path === activePath) activeSessions = projectSessions[path];
        }
      }
      acknowledgeStoredSessionChanges(storage, storageKey, Array.from(projects, ([projectPath, targetIds]) => ({
        projectPath,
        targetIds,
        sessions: (projectSessions[projectPath] ?? []).filter(({ id }) => targetIds.has(id)).map(toPersistedSession),
        archives: [],
      })));
      const current = activePath && activeSessions ? syncCurrentProject(state, activePath, activeSessions) : {};
      return { ...current, projectArchivedSessions, projectSessions, projectAttentionItems };
    });
    return count;
  }

  return {
    restoreArchivedSessions: (targets) => applyChange(targets, "restore"),
    removeArchivedSessions: (targets) => applyChange(targets, "remove"),
  };
}

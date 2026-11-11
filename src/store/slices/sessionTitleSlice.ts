import { useAppStore } from "@/store";
import { generateSessionTitle, readCodexSessionTitles } from "@/lib/api";
import { startCodexTitleSync } from "@/lib/codexSessionTitles";
import { queueSessionTitle, startTitleGeneration } from "@/lib/sessionTitles";
import type { Session } from "@/types";
import { syncWorkspaceSnapshot } from "../utils/workspace";
import { projectPathKey } from "@/lib/openProjects";

const EMPTY_TITLE_SESSIONS: Session[] = [];

function ownedProjectPath(): string | null {
  const state = useAppStore.getState();
  if (!state.windowContextReady || state.windowMode !== "project" || !state.windowProject || !state.currentProject
    || projectPathKey(state.windowProject.path) !== projectPathKey(state.currentProject.path)) return null;
  return state.windowProject.path;
}

function ownedSessions(): Session[] {
  const path = ownedProjectPath();
  if (!path) return EMPTY_TITLE_SESSIONS;
  return Object.entries(useAppStore.getState().projectSessions)
    .find(([entry]) => projectPathKey(entry) === projectPathKey(path))?.[1] ?? EMPTY_TITLE_SESSIONS;
}

function setSessionTitleState(id: string, change: (session: Session) => Session) {
  useAppStore.setState((state) => {
    const projectSessions = { ...state.projectSessions };
    const projectWorkspaces = { ...state.projectWorkspaces };
    let changed = false;
    for (const [path, sessions] of Object.entries(projectSessions)) {
      const current = sessions.find((session) => session.id === id);
      if (!current) continue;
      const next = change(current);
      if (next === current) continue;
      projectSessions[path] = sessions.map((session) => session.id === id ? next : session);
      const name = next.name;
      const workspace = projectWorkspaces[path];
      if (workspace) projectWorkspaces[path] = {
        ...workspace,
        tabsById: Object.fromEntries(Object.entries(workspace.tabsById).map(([tabId, tab]) => [
          tabId, tab.kind === "session" && tab.resourceId === id ? { ...tab, title: name } : tab,
        ])),
      };
      changed = true;
    }
    if (!changed) return state;
    return {
      projectSessions, projectWorkspaces,
      sessions: state.currentProject ? projectSessions[state.currentProject.path] ?? state.sessions : state.sessions,
      ...(state.currentProject && projectWorkspaces[state.currentProject.path]
        ? syncWorkspaceSnapshot(projectWorkspaces[state.currentProject.path]) : {}),
    };
  });
}

export function setSessionTitlePrompt(id: string, prompt: string) {
  setSessionTitleState(id, (session) => queueSessionTitle(session, prompt));
}

export function retrySessionTitle(id: string) {
  setSessionTitleState(id, (session) => queueSessionTitle(session,
    session.titleGeneration?.prompt || session.temporaryTitle || session.firstPromptTitle || "", true));
}

export function startSessionTitleGeneration() {
  const shared = {
    // 历史快照可含其他项目，但只有当前项目的所属窗口有权执行、保存标题任务。
    sessions: ownedSessions,
    update: (id: string, change: (session: Session) => Session) => {
      if (ownedSessions().some((session) => session.id === id)) setSessionTitleState(id, change);
    },
    subscribe: (listener: () => void) => {
      let previous = ownedSessions();
      return useAppStore.subscribe(() => {
        const sessions = ownedSessions();
        if (sessions === previous) return;
        previous = sessions;
        listener();
      });
    },
  };
  let owner: string | null | undefined;
  let stopped = false;
  let stopRuntime = () => {};
  const rebind = () => {
    if (stopped) return;
    const path = ownedProjectPath();
    const next = path ? projectPathKey(path) : null;
    if (next === owner) return;
    // 先变更归属，防止初始化重排任务时同步触发 store 订阅而重复启动。
    owner = next;
    stopRuntime();
    stopRuntime = () => {};
    if (!next) return;
    const stopNative = startCodexTitleSync({ ...shared, read: readCodexSessionTitles });
    const stopGeneration = startTitleGeneration({ ...shared, generate: generateSessionTitle });
    stopRuntime = () => { stopNative(); stopGeneration(); };
  };
  const unsubscribe = useAppStore.subscribe(rebind);
  rebind();
  return () => { stopped = true; unsubscribe(); stopRuntime(); };
}

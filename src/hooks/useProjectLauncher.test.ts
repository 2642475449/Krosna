import { beforeEach, expect, it, vi } from "vitest";
import { createAppStore } from "@/store";

const mocks = vi.hoisted(() => ({ open: vi.fn(), broadcast: vi.fn(), close: vi.fn() }));
vi.mock("react", () => ({ useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn(), useEffect: () => {} }));
vi.mock("react-i18next", async (original) => ({ ...await original<typeof import("react-i18next")>(), useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("antd", () => ({ message: { error: vi.fn() } }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ close: mocks.close }) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@/lib/api", () => ({ openProjectWindow: mocks.open, getExistingProjectPaths: vi.fn() }));
vi.mock("@/hooks/useRecentProjectSync", () => ({ broadcastRecentProjectOpened: mocks.broadcast }));
vi.mock("@/store", async (original) => {
  const actual = await original<typeof import("@/store")>();
  const store = actual.createAppStore();
  return { ...actual, useAppStore: Object.assign((select: (state: ReturnType<typeof actual.useAppStore.getState>) => unknown) => select(store.getState()), { getState: store.getState, setState: store.setState }) };
});
import { useProjectLauncher } from "./useProjectLauncher";
import { useAppStore } from "@/store";

beforeEach(() => {
  vi.clearAllMocks();
  const { setCurrentProject: _set, ...initial } = createAppStore().getState();
  useAppStore.setState({ currentProject: null, sessions: [], projectSessions: {}, projectWorkspaces: {}, fileDocuments: initial.fileDocuments, gitDiffDocuments: initial.gitDiffDocuments });
  useAppStore.setState({ windowLabel: "original", windowMode: "project" });
  useAppStore.getState().setCurrentProject({ path: "D:/original", name: "Original" });
  useAppStore.getState().addSession({ id: "live", path: "D:/original", name: "Live", createdAt: 1, active: true, status: "running" });
});

it("preserves the original workspace and live sessions when the backend focuses another window", async () => {
  mocks.open.mockResolvedValue({ windowLabel: "other", mode: "project", projectPath: "D:/target", projectName: "Target" });
  const before = useAppStore.getState();
  await useProjectLauncher().openProject("D:/target", "current_window");
  const after = useAppStore.getState();
  for (const key of ["currentProject", "sessions", "projectSessions", "projectWorkspaces", "fileDocuments", "gitDiffDocuments"] as const) {
    expect(after[key]).toBe(before[key]);
  }
  expect(after.sessions[0]).toMatchObject({ active: true, status: "running" });
  expect(mocks.close).not.toHaveBeenCalled();
});

it("cleans up the previous project only when the current window really switches", async () => {
  mocks.open.mockResolvedValue({ windowLabel: "original", mode: "project", projectPath: "D:/target", projectName: "Target" });
  await useProjectLauncher().openProject("D:/target", "current_window");
  const state = useAppStore.getState();
  expect(state.currentProject?.path).toBe("D:/target");
  expect(state.projectSessions["D:/original"][0]).toMatchObject({ active: false, status: "stopped" });
  expect(state.projectWorkspaces["D:/original"]).toBeUndefined();
});




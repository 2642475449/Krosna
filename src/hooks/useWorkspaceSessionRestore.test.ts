import { beforeEach, expect, it, vi } from "vitest";
import type { AppState, WorkspaceRecoveryState } from "@/store/types";

type AppSnapshot = Pick<AppState, "currentProject" | "sessions" | "tabsById" | "panesById" | "windowContextReady">;
type RecoverySnapshot = Pick<WorkspaceRecoveryState, "enabled" | "projectPath" | "phase" | "restoreQueue">;
type StoreListener = () => void;
const mocks = vi.hoisted(() => ({
  app: {} as AppSnapshot,
  recovery: {} as RecoverySnapshot,
  background: { exitPreparing: false, closePreparing: false },
  appListeners: new Set<StoreListener>(), recoveryListeners: new Set<StoreListener>(), backgroundListeners: new Set<StoreListener>(),
  effects: [] as Array<() => undefined | (() => void)>,
  dependencies: [] as unknown[][],
  resume: vi.fn(), take: vi.fn(),
}));

vi.mock("react", () => ({ useEffect: (effect: () => undefined | (() => void), dependencies: unknown[]) => {
  mocks.effects.push(effect); mocks.dependencies.push(dependencies);
} }));
vi.mock("@/store", () => ({ useAppStore: Object.assign((select: (state: AppSnapshot) => unknown) => select(mocks.app), {
  getState: () => mocks.app,
  subscribe: (listener: StoreListener) => { mocks.appListeners.add(listener); return () => mocks.appListeners.delete(listener); },
}) }));
vi.mock("@/store/slices/workspaceRecovery", () => ({
  takeWorkspaceRestoreSession: mocks.take,
  useWorkspaceRecoveryStore: Object.assign((select: (state: RecoverySnapshot) => unknown) => select(mocks.recovery), {
    getState: () => mocks.recovery,
    subscribe: (listener: StoreListener) => { mocks.recoveryListeners.add(listener); return () => mocks.recoveryListeners.delete(listener); },
  }),
}));
vi.mock("@/store/slices/background", () => ({ useBackgroundStore: {
  getState: () => mocks.background,
  subscribe: (listener: StoreListener) => { mocks.backgroundListeners.add(listener); return () => mocks.backgroundListeners.delete(listener); },
} }));
vi.mock("./useResumeSession", () => ({ useResumeSession: () => mocks.resume }));

import { useWorkspaceSessionRestore } from "./useWorkspaceSessionRestore";

function emit(listeners: Set<StoreListener>): void { [...listeners].forEach((listener) => listener()); }
async function flush(): Promise<void> { for (let index = 0; index < 8; index += 1) await Promise.resolve(); }
function mount(): () => void {
  useWorkspaceSessionRestore();
  return mocks.effects.pop()!() ?? (() => {});
}
function deferred() {
  let resolve: (result: boolean) => void = () => {};
  const promise = new Promise<boolean>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.effects = []; mocks.dependencies = [];
  mocks.appListeners.clear(); mocks.recoveryListeners.clear(); mocks.backgroundListeners.clear();
  const ids = ["visible", "split", "background", "last"];
  mocks.app = {
    currentProject: { path: "D:/repo", name: "repo" }, windowContextReady: true,
    sessions: ids.map((id) => ({ id, path: "D:/repo", name: id, createdAt: 1, active: false, agentId: "claude" })),
    tabsById: Object.fromEntries(ids.map((id) => [id, { id, kind: "session", resourceId: id }] )) as AppSnapshot["tabsById"],
    panesById: { main: { id: "main", tabIds: ids, activeTabId: "visible", history: ids } },
  };
  mocks.recovery = { enabled: true, projectPath: "D:/repo", phase: "ready", restoreQueue: ids };
  mocks.background = { exitPreparing: false, closePreparing: false };
  mocks.take.mockImplementation(() => {
    const [id, ...rest] = mocks.recovery.restoreQueue;
    if (id) { mocks.recovery = { ...mocks.recovery, restoreQueue: rest }; emit(mocks.recoveryListeners); }
    return id;
  });
  mocks.resume.mockResolvedValue(true);
});

it("restores in queued priority order with at most two sessions in flight", async () => {
  const first = deferred(); const second = deferred();
  mocks.resume.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
  const cleanup = mount();
  await flush();
  expect(mocks.resume.mock.calls.map(([id]) => id)).toEqual(["visible", "split"]);
  expect(mocks.resume.mock.calls[0][1]).toMatchObject({ automatic: true });
  first.resolve(true); await flush();
  expect(mocks.resume.mock.calls.map(([id]) => id)).toEqual(["visible", "split", "background", "last"]);
  expect((mocks.resume.mock.calls[1][1] as { signal: AbortSignal }).signal.aborted).toBe(false);
  second.resolve(true); await flush(); cleanup();
});

it("does not depend on the consumed queue or restart a StrictMode discarded setup", async () => {
  const discard = mount(); discard();
  const cleanup = mount(); await flush();
  expect(mocks.resume).toHaveBeenCalledTimes(4);
  expect(mocks.dependencies.every((dependencies) => dependencies.length === 4 && !dependencies.includes(mocks.recovery.restoreQueue))).toBe(true);
  expect(mocks.appListeners.size).toBe(1);
  cleanup();
  expect(mocks.appListeners.size).toBe(0);
  expect(mocks.recoveryListeners.size).toBe(0);
  expect(mocks.backgroundListeners.size).toBe(0);
});

it("cancels only the active restore whose tab was closed and skips closed queued tabs", async () => {
  const first = deferred(); const second = deferred();
  mocks.resume.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
  const cleanup = mount(); await flush();
  const firstSignal = mocks.resume.mock.calls[0][1].signal as AbortSignal;
  const secondSignal = mocks.resume.mock.calls[1][1].signal as AbortSignal;
  mocks.app = { ...mocks.app, panesById: { main: { ...mocks.app.panesById.main!, tabIds: ["split", "last"] } } };
  emit(mocks.appListeners);
  expect(firstSignal.aborted).toBe(true);
  expect(secondSignal.aborted).toBe(false);
  first.resolve(false); await flush();
  expect(mocks.resume.mock.calls.map(([id]) => id)).toEqual(["visible", "split", "last"]);
  second.resolve(true); cleanup();
});

it.each(["project", "disabled", "phase"])("cancels and stops the batch when %s context changes", async (change) => {
  const inFlight = deferred(); mocks.resume.mockImplementation(() => inFlight.promise);
  const cleanup = mount(); await flush();
  if (change === "project") { mocks.app = { ...mocks.app, currentProject: { name: "other", path: "D:/other" } }; emit(mocks.appListeners); }
  else { mocks.recovery = { ...mocks.recovery, ...(change === "disabled" ? { enabled: false } : { phase: "loading" }) }; emit(mocks.recoveryListeners); }
  for (const [, options] of mocks.resume.mock.calls) expect((options.signal as AbortSignal).aborted).toBe(true);
  inFlight.resolve(false); await flush();
  expect(mocks.resume).toHaveBeenCalledTimes(2);
  cleanup();
});

it.each(["exitPreparing", "closePreparing"] as const)("does not restart a batch when %s is cancelled", async (key) => {
  const inFlight = deferred(); mocks.resume.mockImplementation(() => inFlight.promise);
  const cleanup = mount(); await flush();
  mocks.background = { ...mocks.background, [key]: true }; emit(mocks.backgroundListeners);
  for (const [, options] of mocks.resume.mock.calls) expect((options.signal as AbortSignal).aborted).toBe(true);
  mocks.background = { ...mocks.background, [key]: false }; emit(mocks.backgroundListeners);
  inFlight.resolve(false); await flush();
  expect(mocks.resume).toHaveBeenCalledTimes(2);
  cleanup();
});

it("does not consume the queue when exit preparation has already started", async () => {
  mocks.background.exitPreparing = true;
  const cleanup = mount(); await flush();
  expect(mocks.take).not.toHaveBeenCalled(); expect(mocks.resume).not.toHaveBeenCalled(); cleanup();
});

it("continues after a single restore rejects without emitting an unhandled rejection", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.resume.mockRejectedValueOnce(new Error("CLI missing"));
  try {
    const cleanup = mount(); await flush();
    expect(mocks.resume).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalledOnce(); cleanup();
  } finally { warn.mockRestore(); }
});

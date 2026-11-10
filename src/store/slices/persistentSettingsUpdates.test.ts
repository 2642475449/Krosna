import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyPersistentSettingsToStore, createAppStore, useAppStore } from "@/store";
import type { PersistentSettings } from "@/types";
import { getRuntimePersistentSettingsSnapshot, persistentSettingsSync } from "./persistentSettingsRuntime";
import { applyPersistentSettingsUpdate, startPersistentSettingsUpdates } from "./persistentSettingsUpdates";
import { useShortcutStore } from "./shortcutSlice";

const mocks = vi.hoisted(() => ({
  stop: vi.fn(),
  listener: undefined as ((event: { payload: unknown }) => void) | undefined,
  read: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (_event: string, listener: typeof mocks.listener) => {
  mocks.listener = listener;
  return mocks.stop;
}) }));
vi.mock("@/lib/api", () => ({ getPersistentSettings: (...args: unknown[]) => mocks.read(...args) }));

let initial: PersistentSettings;
beforeEach(() => {
  vi.clearAllMocks();
  initial = getRuntimePersistentSettingsSnapshot();
  persistentSettingsSync.initialize(initial);
});
afterEach(() => {
  applyPersistentSettingsToStore(initial);
  useShortcutStore.getState().setOverrides(initial.keyboardShortcuts);
});

it("applies global notification, language, font, and shell changes to an already open window", () => {
  applyPersistentSettingsUpdate({ revision: 1, settings: {
    notificationEnabled: false, language: "en", terminalFontSize: 18, defaultTerminalShell: "cmd",
  } });
  expect(useAppStore.getState()).toMatchObject({
    notificationEnabled: false, language: "en", terminalFontSize: 18, defaultTerminalShell: "cmd",
  });
  expect(persistentSettingsSync.changes(getRuntimePersistentSettingsSnapshot())).not.toHaveProperty("notificationEnabled");
  expect(persistentSettingsSync.changes(getRuntimePersistentSettingsSnapshot())).not.toHaveProperty("language");
});

it("preserves local unsaved settings while applying unrelated fields and rejects stale revisions", () => {
  useAppStore.getState().setTerminalFontSize(22);
  applyPersistentSettingsUpdate({ revision: 3, settings: { terminalFontSize: 18, language: "en" } });
  expect(useAppStore.getState().terminalFontSize).toBe(22);
  expect(useAppStore.getState().language).toBe("en");
  expect(persistentSettingsSync.changes(getRuntimePersistentSettingsSnapshot())).toMatchObject({ terminalFontSize: 22 });
  applyPersistentSettingsUpdate({ revision: 2, settings: { language: "ja" } });
  expect(useAppStore.getState().language).toBe("en");
});

it("ignores runtime-owned fields and invalid unversioned event payloads", () => {
  const before = useAppStore.getState().lastProject;
  applyPersistentSettingsUpdate({ revision: 1, settings: { lastProjectPath: "C:/unrelated", terminalQuickCommands: [] } });
  applyPersistentSettingsUpdate({ settings: { language: "en" } });
  expect(useAppStore.getState().lastProject).toEqual(before);
  expect(useAppStore.getState().language).toBe(initial.language);
});

it("subscribes before reloading settings and reads again when an event overtakes the reload", async () => {
  let finish!: (snapshot: PersistentSettings) => void;
  mocks.read.mockImplementationOnce(() => new Promise<PersistentSettings>((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce({ ...initial, language: "en", notificationEnabled: false });
  const stop = startPersistentSettingsUpdates();
  await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
  mocks.listener?.({ payload: { revision: 2, settings: { language: "en" } } });
  finish(initial);
  await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
  expect(useAppStore.getState().language).toBe("en");
  expect(useAppStore.getState().notificationEnabled).toBe(false);
  stop();
  expect(mocks.stop).toHaveBeenCalledOnce();
});

it("persists the selected shell through store recreation and SQLite settings hydration", () => {
  let value: string | null = null;
  const storage = {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
    removeItem: () => { value = null; },
  };
  createAppStore(storage).getState().setDefaultTerminalShell("cmd");
  expect(createAppStore(storage).getState().defaultTerminalShell).toBe("cmd");
  applyPersistentSettingsToStore({ ...initial, defaultTerminalShell: "cmd" });
  expect(getRuntimePersistentSettingsSnapshot().defaultTerminalShell).toBe("cmd");
  applyPersistentSettingsToStore({ ...initial, defaultTerminalShell: undefined });
  expect(useAppStore.getState().defaultTerminalShell).toBe("powershell");
});

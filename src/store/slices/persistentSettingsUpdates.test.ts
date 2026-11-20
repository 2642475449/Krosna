import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyPersistentSettingsToStore, createAppStore, useAppStore } from "@/store";
import type { PersistentSettings } from "@/types";
import { applyRuntimePersistentSettings, getRuntimePersistentSettingsSnapshot, persistentSettingsSync } from "./persistentSettingsRuntime";
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
  applyRuntimePersistentSettings(initial);
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

it("synchronizes the complete pet across project windows without echoing the update", () => {
  const state = useAppStore.getState();
  const revision = state.pixelPetFileRevision;
  const pet = { visible: !state.pixelPetVisible,
    config: { ...state.pixelPetConfig, pixelSize: 3 as const, name: "Shared pet" },
    filePath: "D:/pets/shared.json" };
  applyPersistentSettingsUpdate({ revision: 1, settings: { pixelPetSettings: pet } });
  expect(getRuntimePersistentSettingsSnapshot().pixelPetSettings).toEqual(pet);
  expect(useAppStore.getState()).toMatchObject({
    pixelPetFileRevision: revision + 1, pixelPetFileSnapshot: null, pixelPetFileError: null,
  });
  expect(persistentSettingsSync.changes(getRuntimePersistentSettingsSnapshot())).not.toHaveProperty("pixelPetSettings");
  applyPersistentSettingsUpdate({ revision: 0, settings: { pixelPetSettings: initial.pixelPetSettings } });
  expect(getRuntimePersistentSettingsSnapshot().pixelPetSettings).toEqual(pet);
});

it("keeps local pet edits atomic while receiving unrelated global settings", () => {
  const local = { ...useAppStore.getState().pixelPetConfig, name: "Unsaved pet", pixelSize: 1 as const };
  useAppStore.getState().setPixelPetConfig(local);
  applyPersistentSettingsUpdate({ revision: 1, settings: {
    pixelPetSettings: { ...initial.pixelPetSettings!, visible: false }, language: "en",
  } });
  expect(useAppStore.getState().pixelPetConfig).toBe(local);
  expect(useAppStore.getState().pixelPetVisible).toBe(initial.pixelPetSettings!.visible);
  expect(useAppStore.getState().language).toBe("en");
  expect(persistentSettingsSync.changes(getRuntimePersistentSettingsSnapshot())).toHaveProperty("pixelPetSettings.config", local);
});

it("migrates a legacy local pet and restores the shared pet when a new project window initializes", () => {
  const local = { ...useAppStore.getState().pixelPetConfig, name: "Legacy pet" };
  useAppStore.getState().setPixelPetConfig(local);
  applyRuntimePersistentSettings({ ...initial, pixelPetSettings: null });
  expect(useAppStore.getState().pixelPetConfig).toBe(local);
  persistentSettingsSync.initialize({ ...initial, pixelPetSettings: null });
  expect(persistentSettingsSync.changes(getRuntimePersistentSettingsSnapshot())).toHaveProperty("pixelPetSettings.config", local);
  applyRuntimePersistentSettings(initial);
  expect(getRuntimePersistentSettingsSnapshot().pixelPetSettings).toEqual(initial.pixelPetSettings);
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

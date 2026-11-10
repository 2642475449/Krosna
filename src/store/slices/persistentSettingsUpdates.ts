import { listen } from "@tauri-apps/api/event";
import { getPersistentSettings } from "@/lib/api";
import { persistentSettingsRevision } from "@/lib/persistentSettingsSync";
import { applyPersistentSettingsToStore } from "@/store";
import type { PersistentSettings } from "@/types";
import { useAuxiliaryDockStore } from "../auxiliaryDock";
import { getRuntimePersistentSettingsSnapshot, persistentSettingsSync } from "./persistentSettingsRuntime";
import { useShortcutStore } from "./shortcutSlice";

const RUNTIME_OWNED_FIELDS = new Set(["lastProjectPath", "explorerContextMenuEnabled", "terminalQuickCommands"]);

function applyPatch(settings: Partial<PersistentSettings>, revision?: number): void {
  const snapshot = getRuntimePersistentSettingsSnapshot();
  const patch = Object.fromEntries(Object.entries(settings).filter(([key]) =>
    key in snapshot && !RUNTIME_OWNED_FIELDS.has(key))) as Partial<PersistentSettings>;
  const applied = persistentSettingsSync.receive(patch, snapshot, revision);
  if (!Object.keys(applied).length) return;
  applyPersistentSettingsToStore({ ...snapshot, ...applied });
  if (applied.keyboardShortcuts !== undefined) useShortcutStore.getState().setPersistedOverrides(applied.keyboardShortcuts);
  if (applied.auxiliaryDockWidths !== undefined) useAuxiliaryDockStore.getState().restoreWidths(applied.auxiliaryDockWidths);
}

export function applyPersistentSettingsUpdate(payload: unknown): void {
  const revision = persistentSettingsRevision(payload);
  if (revision === undefined || !payload || typeof payload !== "object" || !("settings" in payload)
    || !payload.settings || typeof payload.settings !== "object" || Array.isArray(payload.settings)) return;
  applyPatch(payload.settings as Partial<PersistentSettings>, revision);
}

/** 每窗口订阅所有全局设置；保留本地未保存字段，不把收到的补丁重新写回。 */
export function startPersistentSettingsUpdates(): () => void {
  let disposed = false;
  let sequence = 0;
  let unlisten: (() => void) | undefined;
  void (async () => {
    unlisten = await listen<unknown>("persistent-settings-updated", ({ payload }) => {
      if (disposed) return;
      sequence++;
      applyPersistentSettingsUpdate(payload);
    });
    if (disposed) { unlisten(); return; }
    // 先订阅再补读，闭合初始化读取和 React effect 订阅之间的事件空隙。
    while (!disposed) {
      const before = sequence;
      const settings = await getPersistentSettings();
      if (disposed) return;
      if (sequence !== before) continue;
      applyPatch(settings);
      return;
    }
  })().catch((error) => { if (!disposed) console.error("Failed to synchronize persistent settings:", error); });
  return () => { disposed = true; unlisten?.(); };
}

import { useAppStore } from "@/store";

export const PENDING_SETTINGS_PAGE_KEY = "krosna.settings.pendingPage";
export const SETTINGS_NAVIGATE_EVENT = "settings:navigate";
export const SETTINGS_TAB_ID = "__settings__";

export const SETTINGS_PAGE_IDS = [
  "general",
  "network",
  "notifications",
  "agents",
  "git",
  "terminal",
  "voiceRecognition",
  "shortcuts",
  "pixelPet",
  "skills",
  "hooks",
  "mcpServers",
  "commands",
  "quickCommands",
  "claudeMd",
  "searchIndex",
  "dataPrivacy",
  "archived",
  "about",
] as const;

export type SettingsPage = (typeof SETTINGS_PAGE_IDS)[number];

const SETTINGS_PAGE_SET: ReadonlySet<string> = new Set(SETTINGS_PAGE_IDS);

export function isSettingsPage(value: unknown): value is SettingsPage {
  return typeof value === "string" && SETTINGS_PAGE_SET.has(value);
}

export function readPendingSettingsPage(storage: Pick<Storage, "getItem">): SettingsPage | null {
  const value = storage.getItem(PENDING_SETTINGS_PAGE_KEY);
  return isSettingsPage(value) ? value : null;
}

export function consumePendingSettingsPage(
  storage: Pick<Storage, "getItem" | "removeItem">,
): SettingsPage | null {
  const page = readPendingSettingsPage(storage);
  if (page) {
    storage.removeItem(PENDING_SETTINGS_PAGE_KEY);
  }
  return page;
}

/** 打开设置页标签并跳转到指定分区。 */
export function openSettingsPage(page: SettingsPage): void {
  window.sessionStorage.setItem(PENDING_SETTINGS_PAGE_KEY, page);
  useAppStore.getState().openTab(SETTINGS_TAB_ID);
  window.dispatchEvent(new CustomEvent(SETTINGS_NAVIGATE_EVENT, { detail: page }));
}

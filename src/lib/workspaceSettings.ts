interface SettingsTab {
  kind: string;
}

export function isSettingsTab(tabId: string | null, tabsById: Record<string, SettingsTab>): boolean {
  return tabId === "__settings__" || tabsById[tabId ?? ""]?.kind === "settings";
}

export function isWorkspaceSettingsVisible(snapshot: {
  activeSessionId: string | null;
  tabsById: Record<string, SettingsTab>;
}): boolean {
  return isSettingsTab(snapshot.activeSessionId, snapshot.tabsById);
}

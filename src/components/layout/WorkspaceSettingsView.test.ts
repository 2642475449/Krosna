// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { useAppStore } from "@/store";
import { createDefaultWorkspace, openTabInWorkspace, splitTabInWorkspace, syncWorkspaceSnapshot } from "@/store/utils/workspace";
import type { Session } from "@/types";
import { WorkspaceSettingsView } from "./WorkspaceSettingsView";

vi.mock("@/components/SettingsPanel", () => ({
  default: () => createElement("input", { "data-settings-input": true, defaultValue: "draft" }),
}));

const settingsId = "__settings__";
const projectPath = "D:/workspace/settings-layout";
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useAppStore.setState(useAppStore.getInitialState(), true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useAppStore.setState(useAppStore.getInitialState(), true);
  vi.unstubAllGlobals();
});

function prepareWorkspace(paneCount: number) {
  const sessions: Session[] = Array.from({ length: paneCount }, (_, i) => ({
    id: `session-${i}`, name: `Session ${i}`, path: projectPath, active: true, createdAt: i,
  }));
  let workspace = createDefaultWorkspace();
  for (const session of sessions) workspace = openTabInWorkspace(workspace, session.id, sessions);
  for (let i = 1; i < paneCount; i++) {
    workspace = splitTabInWorkspace(workspace, sessions[i].id, i % 2 ? "right" : "down", "main", "move", `pane-${i}`);
  }
  useAppStore.setState({
    currentProject: { name: "settings-layout", path: projectPath },
    windowMode: "project", sessions,
    projectSessions: { [projectPath]: sessions },
    projectWorkspaces: { [projectPath]: workspace },
    ...syncWorkspaceSnapshot(workspace),
  });
  return workspace;
}

it.each([1, 2, 4])("opens one settings page outside all %i split panes and restores the layout on close", async (paneCount) => {
  const workspace = prepareWorkspace(paneCount);
  const mounts = vi.fn();
  const unmounts = vi.fn();
  function SplitContent() {
    useEffect(() => { mounts(); return unmounts; }, []);
    return createElement("div", { "data-split-content": true }, "terminals and files");
  }
  await act(async () => root.render(createElement(WorkspaceSettingsView, null, createElement(SplitContent))));
  const splitContent = host.querySelector("[data-split-content]");
  await act(async () => useAppStore.getState().openTab(settingsId));

  const settings = host.querySelector<HTMLElement>("[data-workspace-settings]")!;
  const splits = host.querySelector<HTMLElement>("[data-workspace-splits]")!;
  expect(settings.parentElement).toBe(splits.parentElement);
  expect(settings.style.display).toBe("flex");
  expect(splits.style.display).toBe("none");
  expect(host.querySelectorAll("[data-settings-input]")).toHaveLength(1);
  expect(settings.contains(document.activeElement)).toBe(true);
  expect(useAppStore.getState().layout).toEqual(workspace.layout);

  const backButton = Array.from(settings.querySelectorAll("button")).find((button) => button.textContent === i18n.t("common.back"));
  expect(backButton).toBeTruthy();
  expect(document.activeElement).toBe(backButton);
  await act(async () => backButton!.click());
  expect(host.querySelector("[data-workspace-settings]")).toBeNull();
  expect(splits.style.display).toBe("");
  expect(host.querySelector("[data-split-content]")).toBe(splitContent);
  expect(mounts).toHaveBeenCalledTimes(1);
  expect(unmounts).not.toHaveBeenCalled();
  expect(useAppStore.getState().layout).toEqual(workspace.layout);
  for (const pane of Object.values(workspace.panesById)) {
    expect(useAppStore.getState().panesById[pane.id].activeTabId).toBe(pane.activeTabId);
  }
});

it("restores a covered pane when navigating to another pane and preserves settings while hidden", async () => {
  const workspace = prepareWorkspace(2);
  await act(async () => root.render(createElement(WorkspaceSettingsView, null, "workspace")));
  await act(async () => useAppStore.getState().openTab(settingsId));
  const input = host.querySelector<HTMLInputElement>("[data-settings-input]")!;
  input.value = "unsaved settings form";
  await act(async () => useAppStore.getState().setActiveSession("session-0", "main"));

  expect(host.querySelector<HTMLElement>("[data-workspace-settings]")!.style.display).toBe("none");
  expect(useAppStore.getState().panesById[workspace.activePaneId!].activeTabId).toBe("session-1");
  await act(async () => useAppStore.getState().openTab(settingsId));
  expect(host.querySelector("[data-settings-input]")).toBe(input);
  expect(input.value).toBe("unsaved settings form");
  expect(host.querySelectorAll("[data-settings-input]")).toHaveLength(1);
  await act(async () => useAppStore.getState().closeTab(settingsId));
  expect(Object.values(useAppStore.getState().panesById).every((pane) => !pane.tabIds.includes(settingsId))).toBe(true);
});

it("opens and closes settings without an active project", async () => {
  await act(async () => root.render(createElement(WorkspaceSettingsView, null, "home")));
  await act(async () => useAppStore.getState().openTab(settingsId));
  expect(host.querySelector<HTMLElement>("[data-workspace-settings]")!.style.display).toBe("flex");
  await act(async () => useAppStore.getState().closeTab(settingsId));
  expect(host.querySelector("[data-workspace-settings]")).toBeNull();
  expect(host.querySelector<HTMLElement>("[data-workspace-splits]")!.style.display).toBe("");
});

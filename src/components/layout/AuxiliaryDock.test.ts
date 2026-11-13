// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "@/store";
import { cleanupSessionProcess, openInAssociatedApplication } from "@/lib/api";
import { getFileDocument } from "@/lib/fileDocument";
import AuxiliaryDock from "./AuxiliaryDock";
import { useAuxiliaryDockStore } from "@/store/auxiliaryDock";

vi.mock("react-i18next", async (importOriginal) => ({
  ...await importOriginal<typeof import("react-i18next")>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/store", () => {
  const state = { currentProject: { path: "D:/repo" }, sessions: [] as { id: string; active: boolean }[], openFileTab: vi.fn(() => "main-file"), updateSession: vi.fn(), removeSession: vi.fn() };
  return { useAppStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), { getState: () => state }) };
});
vi.mock("antd", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => children;
  const Empty = Object.assign(() => null, { PRESENTED_IMAGE_SIMPLE: null });
  const Dropdown = ({ children, menu, trigger }: { children?: React.ReactNode; menu?: { items: { key?: string; label?: string }[]; onClick?: (event: { key: string }) => void }; trigger?: string[] }) => React.createElement("div", null, children,
    ...(trigger?.includes("contextMenu") ? menu!.items.filter((item) => item.key).map((item) => React.createElement("button", { key: item.key, "data-menu": item.key, onClick: () => menu!.onClick?.({ key: item.key! }) }, item.label)) : []));
  const Modal = ({ open, onOk, onCancel, children }: { open: boolean; onOk?: () => void; onCancel?: () => void; children?: React.ReactNode }) => open ? React.createElement("div", { "data-modal": true }, children, React.createElement("button", { "data-confirm": true, onClick: onOk }), React.createElement("button", { "data-cancel": true, onClick: onCancel })) : null;
  return { Dropdown, Tooltip: Pass, Empty, Input: () => null, Modal, Spin: () => null, message: { error: vi.fn() } };
});
vi.mock("@/components/AgentActivityIcon", () => ({ AgentActivityIcon: () => null }));
vi.mock("@/components/CheckpointReviewDrawer", () => ({ default: () => null }));
vi.mock("@/components/SessionCheckpointSummaryBar", () => ({ default: () => null }));
vi.mock("@/components/TaskMonitorPopover", () => ({ TaskMonitorPanel: () => null }));
vi.mock("@/components/AuxiliaryFileView", () => ({ default: () => null }));
vi.mock("@/lib/api", () => ({ cleanupSessionProcess: vi.fn(), searchProjectEntries: vi.fn(), openInAssociatedApplication: vi.fn(), openInFileManager: vi.fn() }));
vi.mock("@/lib/fileIcon", () => ({ getFileIconByName: () => null }));

vi.mock("@/lib/fileDocument", () => ({ getFileDocument: vi.fn(() => ({ save: vi.fn(async () => true) })) }));

let host: HTMLDivElement;
let root: Root;
let resizeHost: (width: number) => void;

beforeEach(async () => {
  vi.clearAllMocks();
  useAppStore.getState().currentProject!.path = "D:/repo";
  useAppStore.getState().sessions.length = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const resizeCallbacks = new Set<ResizeObserverCallback>();
  resizeHost = (width) => {
    for (const callback of resizeCallbacks) {
      callback([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
    }
  };
  vi.stubGlobal("ResizeObserver", class {
    private callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      resizeCallbacks.add(callback);
    }
    observe() {}
    disconnect() {
      resizeCallbacks.delete(this.callback);
    }
  });
  useAuxiliaryDockStore.setState({ open: false, widths: {}, initialWidths: {}, tabs: [], activeTabId: null });
  host = document.createElement("div");
  host.getBoundingClientRect = () => ({ width: 1600 }) as DOMRect;
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(AuxiliaryDock, { onRequestTask: vi.fn(), onRequestTerminal: vi.fn() })));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const dockWidth = () => Number.parseFloat(host.querySelector("aside")!.style.width);

it("renders narrow monitor and wide documents, remembers dragging, and restores after a window resize", async () => {
  const store = useAuxiliaryDockStore.getState();
  await act(async () => store.toggle());
  expect(dockWidth()).toBe(300);
  await act(async () => store.openFile({ projectPath: "D:/repo", path: "D:/repo/one.md" }));
  expect(dockWidth()).toBe(608);
  const fileId = useAuxiliaryDockStore.getState().activeTabId!;
  host.querySelector("aside")!.getBoundingClientRect = () => ({ width: 608 }) as DOMRect;
  await act(async () => host.querySelector('[role="separator"]')!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 1000 })));
  await act(async () => window.dispatchEvent(new PointerEvent("pointermove", { clientX: 908 })));
  await act(async () => window.dispatchEvent(new PointerEvent("pointerup")));
  expect(dockWidth()).toBe(700);
  await act(async () => store.activateTab("aux:task-monitor"));
  expect(dockWidth()).toBe(300);
  await act(async () => store.activateTab(fileId));
  expect(dockWidth()).toBe(700);
  await act(async () => resizeHost(800));
  expect(dockWidth()).toBeCloseTo(319.6);
  expect(useAuxiliaryDockStore.getState().widths.file).toBe(700);
  await act(async () => resizeHost(1600));
  expect(dockWidth()).toBe(700);
  await act(async () => store.closeTab(fileId));
  expect(dockWidth()).toBe(300);
});

it("keeps initial document width stable across file changes and resets only the active category", async () => {
  const store = useAuxiliaryDockStore.getState();
  await act(async () => store.openFile({ projectPath: "D:/repo", path: "D:/repo/one.md" }));
  await act(async () => resizeHost(1400));
  await act(async () => store.openFile({ projectPath: "D:/repo", path: "D:/repo/two.md" }));
  expect(dockWidth()).toBe(608);
  await act(async () => store.setWidth(700));
  await act(async () => host.querySelector('[role="separator"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  expect(dockWidth()).toBe(532);
  expect(useAuxiliaryDockStore.getState().widths.file).toBeUndefined();
});


it("moves a file to the main workspace and creates or activates task monitor", async () => {
  const store = useAuxiliaryDockStore.getState();
  await act(async () => store.openFile({ projectPath: "D:/repo", path: "D:/repo/one.md" }));
  await act(async () => host.querySelector<HTMLButtonElement>('[data-menu="associated"]')!.click());
  expect(openInAssociatedApplication).toHaveBeenCalledWith("D:/repo/one.md");
  await act(async () => host.querySelector<HTMLButtonElement>('[data-menu="move"]')!.click());
  expect(useAppStore.getState().openFileTab).toHaveBeenCalledWith("D:/repo/one.md", { preview: false });
  expect(useAuxiliaryDockStore.getState().tabs.map((tab) => tab.kind)).toEqual(["task-monitor"]);
  expect(useAuxiliaryDockStore.getState().activeTabId).toBe("aux:task-monitor");
  expect(useAuxiliaryDockStore.getState().open).toBe(true);
  expect(host.querySelector('[data-menu="associated"]')).toBeNull();
});

it("does not remove the file or switch workspace when saving fails", async () => {
  vi.mocked(getFileDocument).mockReturnValueOnce({ save: async () => false } as unknown as ReturnType<typeof getFileDocument>);
  await act(async () => useAuxiliaryDockStore.getState().openFile({ projectPath: "D:/repo", path: "D:/repo/failed.md" }));
  await act(async () => host.querySelector<HTMLButtonElement>('[data-menu="move"]')!.click());
  expect(useAppStore.getState().openFileTab).not.toHaveBeenCalled();
  expect(useAuxiliaryDockStore.getState().tabs[0].kind).toBe("file");
});

it("requires confirmation before closing live auxiliary processes and supports cancel", async () => {
  useAppStore.getState().sessions.push({ id: "live", active: true } as never);
  await act(async () => useAuxiliaryDockStore.getState().openSession({ sessionId: "live", projectPath: "D:/repo", title: "Live", kind: "task" }));
  await act(async () => host.querySelector<HTMLButtonElement>('[data-menu="close-all"]')!.click());
  expect(cleanupSessionProcess).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-cancel]')!.click());
  expect(useAuxiliaryDockStore.getState().tabs).toHaveLength(1);
  await act(async () => host.querySelector<HTMLButtonElement>('[data-menu="close-all"]')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[data-confirm]')!.click());
  expect(cleanupSessionProcess).toHaveBeenCalledWith("live");
  expect(useAuxiliaryDockStore.getState().tabs).toHaveLength(0);
});


it("returns to the existing monitor and leaves unrelated right-side files intact", async () => {
  const store = useAuxiliaryDockStore.getState();
  await act(async () => {
    store.openTaskMonitor({ title: "Monitor", projectPath: "D:/repo" });
    store.openFile({ projectPath: "D:/repo", path: "D:/repo/one.md", preview: false });
    store.openFile({ projectPath: "D:/repo", path: "D:/repo/two.md", preview: false });
  });
  await act(async () => host.querySelector<HTMLButtonElement>('[data-menu="move"]')!.click());
  expect(useAuxiliaryDockStore.getState().tabs.map((tab) => tab.resourceId)).toEqual(["task-monitor", "D:/repo/two.md"]);
  expect(useAuxiliaryDockStore.getState().activeTabId).toBe("aux:task-monitor");
});

it("ignores a move whose save finishes after switching projects", async () => {
  let finishSave!: (value: boolean) => void;
  vi.mocked(getFileDocument).mockReturnValueOnce({ save: () => new Promise<boolean>((resolve) => { finishSave = resolve; }) } as unknown as ReturnType<typeof getFileDocument>);
  await act(async () => useAuxiliaryDockStore.getState().openFile({ projectPath: "D:/repo", path: "D:/repo/one.md" }));
  await act(async () => host.querySelector<HTMLButtonElement>('[data-menu="move"]')!.click());
  useAppStore.getState().currentProject!.path = "D:/other";
  await act(async () => finishSave(true));
  expect(useAppStore.getState().openFileTab).not.toHaveBeenCalled();
  expect(useAuxiliaryDockStore.getState().tabs.some((tab) => tab.kind === "task-monitor")).toBe(false);
});

it("pins previews and closes only other auxiliary tabs", async () => {
  const store = useAuxiliaryDockStore.getState();
  await act(async () => {
    store.openFile({ projectPath: "D:/repo", path: "D:/repo/one.md", preview: true });
  });
  await act(async () => host.querySelector<HTMLButtonElement>('[data-menu="pin"]')!.click());
  expect(useAuxiliaryDockStore.getState().tabs[0].preview).toBe(false);
  expect(host.querySelector('[data-menu="pin"]')).toBeNull();
  await act(async () => store.openFile({ projectPath: "D:/repo", path: "D:/repo/two.md" }));
  await act(async () => host.querySelector<HTMLButtonElement>('[data-menu="close-others"]')!.click());
  expect(useAuxiliaryDockStore.getState().tabs.map((tab) => tab.resourceId)).toEqual(["D:/repo/one.md"]);
  expect(useAppStore.getState().openFileTab).not.toHaveBeenCalled();
});

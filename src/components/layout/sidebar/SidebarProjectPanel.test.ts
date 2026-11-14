// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FileTreeEntry } from "@/types";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), open: vi.fn(), drag: vi.fn(), rename: vi.fn(),
  createFile: vi.fn(), createDirectory: vi.fn(), deleteEntry: vi.fn(),
  readClipboard: vi.fn(), copy: vi.fn(),
  workspace: { activePaneId: "main", panesById: undefined as unknown, tabsById: undefined as unknown },
}));
vi.mock("@/store", () => ({
  useAppStore: (select: (state: unknown) => unknown) =>
    select({
      setResourceDragState: mocks.drag,
      activePaneId: mocks.workspace.activePaneId,
      panesById: mocks.workspace.panesById,
      tabsById: mocks.workspace.tabsById,
    }),
}));
vi.mock("@/lib/api", () => ({
  listProjectDirectory: mocks.list,
  renameProjectEntry: mocks.rename, copyExternalEntry: vi.fn(), copyProjectEntries: mocks.copy,
  createProjectDirectory: mocks.createDirectory, createProjectFile: mocks.createFile, deleteProjectEntry: mocks.deleteEntry,
  moveProjectEntries: vi.fn(), readClipboardFilePaths: mocks.readClipboard,
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onDragDropEvent: async () => () => {} }) }));
vi.mock("@/lib/explorer", () => ({ EXPLORER_REVEAL_PATH_EVENT: "reveal", EXPLORER_SELECT_ALL_EVENT: "select-all", takePendingExplorerRevealPath: () => null }));
vi.mock("@/lib/globalSearch", () => ({ openGlobalTextSearch: vi.fn() }));
vi.mock("@/lib/gitGraphEvents", () => ({ dispatchGitFileHistoryOpen: vi.fn() }));
vi.mock("react-i18next", () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
import SidebarProjectPanel from "./SidebarProjectPanel";
import {
  computeMarqueeRect,
  getRenameSelectionRange,
  mergeMarqueeSelection,
  rectsIntersect,
} from "./treeNavigation";

let root: Root;
let host: HTMLDivElement;
const project = { name: "project", path: "D:/project" };
const entry = (name: string, kind = "file", parent = project.path) => ({ name, kind, path: `${parent}/${name}` }) as FileTreeEntry;
const folder = entry("src", "directory");
const file = entry("package.json");
const child = entry("index.ts", "file", folder.path);
const listing = (path: string, entries: FileTreeEntry[]) => ({ rootPath: project.path, directoryPath: path, entries });
const tree = () => host.querySelector<HTMLElement>('[role="tree"]')!;
const activePath = () => document.getElementById(tree().getAttribute("aria-activedescendant") ?? "")?.querySelector<HTMLElement>("[data-path]")?.dataset.path;
async function press(key: string, options: KeyboardEventInit = {}) {
  await act(async () => { tree().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options })); });
}
async function openContextMenu(target: HTMLElement) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("mousedown", { button: 2, bubbles: true, cancelable: true }));
    target.dispatchEvent(new MouseEvent("contextmenu", { button: 2, bubbles: true, cancelable: true }));
  });
}
async function clickMenuItem(text: string) {
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    .find((element) => element.textContent === text);
  expect(item).toBeDefined();
  await act(async () => item!.click());
}
async function mount() {
  await act(async () => {
    root.render(React.createElement(SidebarProjectPanel, {
      currentProject: project, noProjectText: "no project", panelTitle: "Project",
      refreshText: "Refresh",
      loadingText: "Loading", emptyFolderText: "Empty", openInManagerText: "Open",
      openInAssociatedAppText: "Open app", copyRelativePathText: "Relative", copyAbsolutePathText: "Absolute",
      copyPathSuccessText: "Copied", onOpenInFileManager: vi.fn(), onOpenInAssociatedApp: vi.fn(), onOpenFile: mocks.open,
    }));
  });
  await act(async () => tree().focus());
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  window.localStorage.clear();
  mocks.workspace = { activePaneId: "main", panesById: undefined, tabsById: undefined };
  mocks.list.mockImplementation(async (_root, path) => listing(path ?? project.path, path ? [child] : [folder, file]));
  mocks.createFile.mockImplementation(async (_root, parent, name) => `${parent}/${name}`);
  mocks.createDirectory.mockImplementation(async (_root, parent, name) => `${parent}/${name}`);
  mocks.deleteEntry.mockResolvedValue(undefined);
  mocks.readClipboard.mockResolvedValue([]);
  mocks.copy.mockResolvedValue([]);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("navigates visible parent/child rows without opening files and opens only on Enter", async () => {
  await mount();
  expect(activePath()).toBe(folder.path);
  await press("ArrowRight");
  await press("ArrowRight");
  expect(activePath()).toBe(child.path);
  await press("ArrowLeft");
  expect(activePath()).toBe(folder.path);
  await press("ArrowLeft");
  expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(2);
  await press("ArrowDown");
  expect(activePath()).toBe(file.path);
  expect(mocks.open).not.toHaveBeenCalled();
  await press("Enter");
  expect(mocks.open).toHaveBeenCalledExactlyOnceWith(file.path, { preview: false });
  await press("Enter", { repeat: true });
  expect(mocks.open).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(tree());
});

it("extends and shrinks range selection, clamps at the ends, and leaves input keys alone", async () => {
  await mount();
  await press("End", { shiftKey: true });
  expect(host.querySelectorAll('[role="treeitem"][aria-selected="true"]')).toHaveLength(2);
  await press("ArrowUp", { shiftKey: true });
  expect(host.querySelectorAll('[role="treeitem"][aria-selected="true"]')).toHaveLength(1);
  await press("Home");
  await press("ArrowUp");
  expect(activePath()).toBe(folder.path);
  const input = document.createElement("input");
  tree().append(input);
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(activePath()).toBe(folder.path);
  input.remove();
});

it("keeps selection and collapsed state when a slow directory request completes", async () => {
  let resolve!: (value: unknown) => void;
  mocks.list.mockImplementation((_root, path) => path
    ? new Promise((done) => { resolve = done; }) : Promise.resolve(listing(project.path, [folder, file])));
  await mount();
  await press("ArrowRight");
  expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(host.textContent).not.toContain("Loading");
  await press("ArrowLeft");
  await press("ArrowDown");
  await act(async () => resolve(listing(folder.path, [child])));
  expect(activePath()).toBe(file.path);
  expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(2);
  await press("ArrowUp");
  await press("ArrowRight");
  expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(3);
  expect(mocks.list).toHaveBeenCalledTimes(2);
});

it("never navigates hidden rows while the root listing is loading or failed", async () => {
  let reject!: (error: Error) => void;
  mocks.list.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  await mount();
  await press("ArrowDown");
  await press("Enter");
  expect(tree().hasAttribute("aria-activedescendant")).toBe(false);
  expect(mocks.open).not.toHaveBeenCalled();
  await act(async () => reject(new Error("read failed")));
  await press("Enter");
  expect(tree().hasAttribute("aria-activedescendant")).toBe(false);
  expect(mocks.open).not.toHaveBeenCalled();
});

it("suspends tree keys while its context menu is open and restores focus after an action", async () => {
  await mount();
  const row = host.querySelector<HTMLElement>(".app-file-tree-row")!;
  await act(async () => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  await press("ArrowDown");
  await press("Enter");
  expect(activePath()).toBe(folder.path);
  expect(mocks.open).not.toHaveBeenCalled();
  const copy = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    .find((item) => item.textContent === "common.copy")!;
  expect(copy).toBeDefined();
  await act(async () => copy.click());
  expect(document.activeElement).toBe(tree());
  await press("ArrowDown");
  expect(activePath()).toBe(file.path);
});

it("resumes keyboard navigation after refreshing away an open context menu", async () => {
  await mount();
  const row = host.querySelector<HTMLElement>(".app-file-tree-row")!;
  await act(async () => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  const refresh = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.querySelector(".anticon-reload"))!;
  await act(async () => refresh.click());
  await act(async () => tree().focus());
  await press("End");
  expect(activePath()).toBe(file.path);
});

async function typeAndSubmitInlineInput(value: string) {
  const input = host.querySelector<HTMLInputElement>('[data-inline-create="true"] input')!;
  expect(input).not.toBeNull();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
  });
}

it.each([
  ["sidebar.createFile", "createFile", "notes.md"],
  ["sidebar.createFolder", "createDirectory", "docs"],
] as const)("creates at the project root from blank space via virtual row %s despite an auto-selected first folder", async (label, method, name) => {
  const agents = entry(".agents", "directory");
  mocks.list.mockImplementation(async (_root, path) => listing(path ?? project.path, path ? [] : [agents, file]));
  await mount();
  expect(activePath()).toBe(agents.path);

  await openContextMenu(tree());
  await clickMenuItem(label);

  expect(mocks[method]).not.toHaveBeenCalled();
  expect(host.querySelector('[data-inline-create="true"]')).not.toBeNull();

  await typeAndSubmitInlineInput(name);
  expect(mocks[method]).toHaveBeenCalledExactlyOnceWith(project.path, project.path, name);
});

it("creates at the project root from blank space after selecting a nested file via virtual row", async () => {
  await mount();
  await press("ArrowRight");
  await press("ArrowRight");
  expect(activePath()).toBe(child.path);
  await openContextMenu(tree());
  await clickMenuItem("sidebar.createFile");
  expect(mocks.createFile).not.toHaveBeenCalled();
  await typeAndSubmitInlineInput("root-file.ts");
  expect(mocks.createFile).toHaveBeenCalledExactlyOnceWith(project.path, project.path, "root-file.ts");
});

it("keeps folder row creation scoped to that folder via virtual row", async () => {
  await mount();
  await openContextMenu(host.querySelector<HTMLElement>(".app-file-tree-row")!);
  await clickMenuItem("sidebar.createFile");
  expect(mocks.createFile).not.toHaveBeenCalled();
  await typeAndSubmitInlineInput("inside.ts");
  expect(mocks.createFile).toHaveBeenCalledExactlyOnceWith(project.path, folder.path, "inside.ts");
});

it("cancels virtual create row on Escape or blank blur without creating files", async () => {
  await mount();
  await openContextMenu(tree());
  await clickMenuItem("sidebar.createFile");
  const input = host.querySelector<HTMLInputElement>('[data-inline-create="true"] input')!;
  expect(input).not.toBeNull();
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
  });
  expect(host.querySelector('[data-inline-create="true"]')).toBeNull();
  expect(mocks.createFile).not.toHaveBeenCalled();

  await openContextMenu(tree());
  await clickMenuItem("sidebar.createFolder");
  const folderInput = host.querySelector<HTMLInputElement>('[data-inline-create="true"] input')!;
  expect(folderInput).not.toBeNull();
  await act(async () => {
    folderInput.focus();
    folderInput.blur();
  });
  expect(host.querySelector('[data-inline-create="true"]')).toBeNull();
  expect(mocks.createDirectory).not.toHaveBeenCalled();
});

it("clears row selection when clicking blank space and resumes navigation from the first row", async () => {
  await mount();
  await press("End");
  expect(activePath()).toBe(file.path);
  await act(async () => {
    tree().dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true }));
  });
  expect(host.querySelectorAll('[role="treeitem"][aria-selected="true"]')).toHaveLength(0);
  expect(tree().hasAttribute("aria-activedescendant")).toBe(false);
  await press("ArrowDown");
  expect(activePath()).toBe(folder.path);
});

it("does not reselect the first folder when dismissing the blank-space menu", async () => {
  await mount();
  await openContextMenu(tree());
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  const menuLabels = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')).map((el) => el.textContent);
  expect(menuLabels).toEqual([
    "sidebar.createFile",
    "sidebar.createFolder",
    "common.paste",
    "sidebar.openCurrentDirectoryInManager",
  ]);
  await act(async () => menu.focus());
  await act(async () => menu.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Escape", keyCode: 27, bubbles: true, cancelable: true,
  })));
  expect(document.activeElement).toBe(tree());
  expect(host.querySelectorAll('[role="treeitem"][aria-selected="true"]')).toHaveLength(0);
});

it.each(["keyboard", "blank menu"])("pastes into the intended directory via %s", async (source) => {
  await mount();
  await press("End");
  await press("c", { ctrlKey: true });
  await press("Home");
  expect(activePath()).toBe(folder.path);

  if (source === "keyboard") {
    await press("v", { ctrlKey: true });
  } else {
    await openContextMenu(tree());
    await clickMenuItem("common.paste");
  }

  expect(mocks.copy).toHaveBeenCalledExactlyOnceWith(
    project.path, [file.path], source === "keyboard" ? folder.path : project.path,
  );
});

it("renders project name in header, toolbar actions, and bottom padding hotzone", async () => {
  await mount();
  expect(host.textContent).toContain(project.name);
  expect(host.querySelector('button[aria-label="sidebar.createFile"]')).toBeNull();
  expect(host.querySelector('button[aria-label="sidebar.createFolder"]')).toBeNull();
  expect(host.querySelector('button[aria-label="sidebar.locateActiveFile"]')).not.toBeNull();
  expect(host.querySelector('button[aria-label="sidebar.collapseAll"]')).not.toBeNull();
  expect(host.querySelector('button[aria-label="Refresh"]')).not.toBeNull();
  expect(host.querySelector('button[aria-label="titleBar.collapseSidebar"]')).not.toBeNull();
  expect(tree().style.paddingBottom).toBe("40px");
});

it("discards stale directory response after switching projects", async () => {
  let resolveOldProject!: (value: unknown) => void;
  const projectB = { name: "project-b", path: "D:/project-b" };
  const fileB = entry("main.rs", "file", projectB.path);
  mocks.list.mockImplementation((rootPath) => {
    if (rootPath === project.path) {
      return new Promise((done) => { resolveOldProject = done; });
    }
    return Promise.resolve({ rootPath: projectB.path, directoryPath: projectB.path, entries: [fileB] });
  });

  await mount();
  await act(async () => {
    root.render(React.createElement(SidebarProjectPanel, {
      currentProject: projectB, noProjectText: "no project", panelTitle: "Project",
      refreshText: "Refresh",
      loadingText: "Loading", emptyFolderText: "Empty", openInManagerText: "Open",
      openInAssociatedAppText: "Open app", copyRelativePathText: "Relative", copyAbsolutePathText: "Absolute",
      copyPathSuccessText: "Copied", onOpenInFileManager: vi.fn(), onOpenInAssociatedApp: vi.fn(), onOpenFile: mocks.open,
    }));
  });

  await act(async () => resolveOldProject(listing(project.path, [folder, file])));
  expect(host.textContent).toContain("main.rs");
  expect(host.textContent).not.toContain("package.json");
});

it("deletes all actionable selected entries when using context menu delete on multi-selection", async () => {
  await mount();
  await press("End", { shiftKey: true });
  expect(host.querySelectorAll('[role="treeitem"][aria-selected="true"]')).toHaveLength(2);

  const firstRow = host.querySelector<HTMLElement>(".app-file-tree-row")!;
  await openContextMenu(firstRow);
  await clickMenuItem("common.delete");

  const confirmBtn = Array.from(document.querySelectorAll<HTMLButtonElement>(".ant-modal-confirm-btns button, .ant-modal-footer button"))
    .find((btn) => btn.textContent?.includes("common.delete"));
  expect(confirmBtn).toBeDefined();
  await act(async () => confirmBtn!.click());

  expect(mocks.deleteEntry).toHaveBeenCalledTimes(2);
  expect(mocks.deleteEntry).toHaveBeenNthCalledWith(1, project.path, folder.path);
  expect(mocks.deleteEntry).toHaveBeenNthCalledWith(2, project.path, file.path);
});

it("computes rename selection range without extension and triggers rename on F2", async () => {
  expect(getRenameSelectionRange("index.ts", "file")).toEqual({ start: 0, end: 5 });
  expect(getRenameSelectionRange("archive.tar.gz", "file")).toEqual({ start: 0, end: 11 });
  expect(getRenameSelectionRange(".gitignore", "file")).toEqual({ start: 0, end: 10 });
  expect(getRenameSelectionRange("Makefile", "file")).toEqual({ start: 0, end: 8 });
  expect(getRenameSelectionRange("src.backup", "directory")).toEqual({ start: 0, end: 10 });

  vi.useFakeTimers();
  await mount();
  await press("End");
  expect(activePath()).toBe(file.path);
  await press("F2");
  await act(async () => {
    vi.runOnlyPendingTimers();
  });

  const renameInput = host.querySelector<HTMLInputElement>('.app-file-tree-row input');
  expect(renameInput).not.toBeNull();
  expect(renameInput!.value).toBe("package.json");
  expect(renameInput!.selectionStart).toBe(0);
  expect(renameInput!.selectionEnd).toBe(7);
});

it("previews file and toggles folder on Space, and retries failed directory load", async () => {
  mocks.list.mockRejectedValueOnce(new Error("network error"));
  await mount();
  expect(host.textContent).toContain("network error");

  const retryBtn = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
    .find((btn) => btn.textContent?.includes("common.retry"));
  expect(retryBtn).toBeDefined();
  await act(async () => retryBtn!.click());
  expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(2);

  await act(async () => {
    tree().blur();
    tree().focus();
  });
  expect(activePath()).toBe(folder.path);
  await press(" ");
  expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(3);

  await press("End");
  expect(activePath()).toBe(file.path);
  await press(" ");
  expect(mocks.open).toHaveBeenCalledExactlyOnceWith(file.path, { preview: true });
});

it("auto-reveals active file tab and follows file tab switches", async () => {
  mocks.workspace = {
    activePaneId: "main",
    panesById: { main: { id: "main", tabIds: ["file:1"], activeTabId: "file:1", history: [] } },
    tabsById: { "file:1": { id: "file:1", kind: "file", resourceId: child.path } },
  };
  await mount();
  expect(activePath()).toBe(child.path);
  expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(3);

  mocks.workspace = {
    activePaneId: "main",
    panesById: { main: { id: "main", tabIds: ["file:2"], activeTabId: "file:2", history: [] } },
    tabsById: { "file:2": { id: "file:2", kind: "file", resourceId: file.path } },
  };
  await act(async () => {
    root.render(React.createElement(SidebarProjectPanel, {
      currentProject: project, noProjectText: "no project", panelTitle: "Project",
      refreshText: "Refresh",
      loadingText: "Loading", emptyFolderText: "Empty", openInManagerText: "Open",
      openInAssociatedAppText: "Open app", copyRelativePathText: "Relative", copyAbsolutePathText: "Absolute",
      copyPathSuccessText: "Copied", onOpenInFileManager: vi.fn(), onOpenInAssociatedApp: vi.fn(), onOpenFile: mocks.open,
    }));
  });
  expect(activePath()).toBe(file.path);
});

it("computes marquee rectangles, intersections, and additive selection merges", () => {
  expect(computeMarqueeRect(120, 80, 20, 30)).toEqual({ left: 20, top: 30, width: 100, height: 50 });
  expect(rectsIntersect({ left: 0, top: 0, right: 50, bottom: 50 }, { left: 40, top: 40, right: 80, bottom: 80 })).toBe(true);
  expect(rectsIntersect({ left: 0, top: 0, right: 40, bottom: 40 }, { left: 40, top: 40, right: 80, bottom: 80 })).toBe(false);
  expect(mergeMarqueeSelection(["a", "b"], ["b", "c"], true)).toEqual(["a", "b", "c"]);
  expect(mergeMarqueeSelection(["a", "b"], ["c"], false)).toEqual(["c"]);
});

it("supports marquee box selection from blank space, Alt+drag over rows, and Escape cancel", async () => {
  const readme = entry("README.md");
  mocks.list.mockResolvedValue(listing(project.path, [folder, file, readme]));
  await mount();

  const tree = host.querySelector<HTMLElement>('[role="tree"]')!;
  const rows = Array.from(host.querySelectorAll<HTMLElement>(".app-file-tree-row[data-path]"));
  expect(rows).toHaveLength(3);

  tree.getBoundingClientRect = () => ({ left: 0, top: 0, right: 240, bottom: 200, width: 240, height: 200, x: 0, y: 0, toJSON: () => {} });
  Object.defineProperty(tree, "scrollWidth", { configurable: true, value: 240 });
  Object.defineProperty(tree, "scrollHeight", { configurable: true, value: 200 });
  rows.forEach((row, index) => {
    const top = index * 24;
    row.getBoundingClientRect = () => ({ left: 0, top, right: 240, bottom: top + 24, width: 240, height: 24, x: 0, y: top, toJSON: () => {} });
  });

  // Blank-area pointer drag across the last two rows (file and readme)
  await act(async () => {
    tree.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 20, clientY: 110 }));
    window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 60, clientY: 30 }));
  });
  expect(host.querySelector('[data-testid="explorer-marquee-box"]')).not.toBeNull();
  expect(rows[0].getAttribute("data-selected")).toBe("false");
  expect(rows[1].getAttribute("data-selected")).toBe("true");
  expect(rows[2].getAttribute("data-selected")).toBe("true");

  await act(async () => {
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 60, clientY: 30 }));
  });
  expect(host.querySelector('[data-testid="explorer-marquee-box"]')).toBeNull();
  expect(rows[1].getAttribute("data-selected")).toBe("true");
  expect(rows[2].getAttribute("data-selected")).toBe("true");

  // Alt+drag starting on a row starts marquee selection without triggering agent-resource drag
  await act(async () => {
    rows[0].dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, altKey: true, clientX: 10, clientY: 8 }));
    window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 40, clientY: 32 }));
  });
  expect(mocks.drag).not.toHaveBeenCalled();
  expect(rows[0].getAttribute("data-selected")).toBe("true");
  expect(rows[1].getAttribute("data-selected")).toBe("true");
  expect(rows[2].getAttribute("data-selected")).toBe("false");

  // Escape cancels marquee and restores previous selection
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(host.querySelector('[data-testid="explorer-marquee-box"]')).toBeNull();
  expect(rows[0].getAttribute("data-selected")).toBe("false");
  expect(rows[1].getAttribute("data-selected")).toBe("true");
  expect(rows[2].getAttribute("data-selected")).toBe("true");
});

it("persists expandedPaths per project across project switches and prunes missing directories", async () => {
  await mount();
  await press("ArrowRight");
  expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(3);

  const otherProject = { name: "other", path: "D:/other" };
  await act(async () => {
    root.render(React.createElement(SidebarProjectPanel, {
      currentProject: otherProject, noProjectText: "no project", panelTitle: "Project",
      refreshText: "Refresh",
      loadingText: "Loading", emptyFolderText: "Empty", openInManagerText: "Open",
      openInAssociatedAppText: "Open app", copyRelativePathText: "Relative", copyAbsolutePathText: "Absolute",
      copyPathSuccessText: "Copied", onOpenInFileManager: vi.fn(), onOpenInAssociatedApp: vi.fn(), onOpenFile: mocks.open,
    }));
  });

  // Switch back to original project: persisted expanded folder should auto-restore
  await act(async () => {
    root.render(React.createElement(SidebarProjectPanel, {
      currentProject: project, noProjectText: "no project", panelTitle: "Project",
      refreshText: "Refresh",
      loadingText: "Loading", emptyFolderText: "Empty", openInManagerText: "Open",
      openInAssociatedAppText: "Open app", copyRelativePathText: "Relative", copyAbsolutePathText: "Absolute",
      copyPathSuccessText: "Copied", onOpenInFileManager: vi.fn(), onOpenInAssociatedApp: vi.fn(), onOpenFile: mocks.open,
    }));
  });
  expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(3);
});

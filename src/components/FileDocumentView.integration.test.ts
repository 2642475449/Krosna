// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import FileTabView from "./FileTabView";
import AuxiliaryFileView from "./AuxiliaryFileView";
import { inspectProjectFile, readProjectFile, readProjectImage, writeProjectFile, openInAssociatedApplication } from "@/lib/api";

const app = vi.hoisted(() => ({
  activeTheme: () => "light-glass" as const, registerFileDocument: vi.fn(), setTabDirty: vi.fn(), setSidebarCollapsed: vi.fn(),
  setActiveSidebarSection: vi.fn(), openFileTab: vi.fn(), promoteTab: vi.fn(),
  tabsById: { main: { preview: true } },
}));
vi.mock("@/store", () => ({ useAppStore: (select: (state: typeof app) => unknown) => select(app) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/i18n", () => ({ default: { t: (key: string, options: { limit: number }) => `${key}:${options.limit}` } }));
vi.mock("@/lib/api", () => ({
  inspectProjectFile: vi.fn(), readProjectFile: vi.fn(), writeProjectFile: vi.fn(),
  readProjectImage: vi.fn(), readProjectPdf: vi.fn(async () => new Uint8Array([1, 2, 3])),
  openInAssociatedApplication: vi.fn(async () => undefined),
}));
vi.mock("@/lib/explorer", () => ({ revealExplorerPath: vi.fn() }));
vi.mock("@/lib/officePreview", () => ({ supportsOfficePreview: (path: string) => path.endsWith(".docx") }));
vi.mock("@/components/markdown/MarkdownPreview", () => ({
  default: ({ content }: { content: string }) => createElement("article", { "data-preview": true }, content),
}));
vi.mock("@/components/editors/MonacoTextEditor", () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => createElement("div", null,
    createElement("pre", { "data-editor": true }, value),
    createElement("button", { onClick: () => onChange("# Edited in shared document") }, "Edit document")),
}));
vi.mock("@/components/pdf/PdfPreview", () => ({ default: () => createElement("div", { "data-pdf": true }, "PDF") }));
vi.mock("@/components/documents/OfficeFilePreview", () => ({ default: () => createElement("div", { "data-office": true }, "Office") }));
vi.mock("antd", () => {
  const Pass = ({ children }: { children?: ReactNode }) => children;
  return {
    Alert: () => null, Dropdown: Pass, Tag: Pass, Spin: () => null,
    Empty: ({ description, children }: { description?: ReactNode; children?: ReactNode }) =>
      createElement("section", { "data-empty": true }, description, children),
    message: { success: vi.fn(), error: vi.fn() },
    Button: ({ children, onClick, title, "aria-label": label }: {
      children?: ReactNode; onClick?: () => void; title?: string; "aria-label"?: string;
    }) => createElement("button", { onClick, title, "aria-label": label }, children),
    Segmented: ({ options, onChange }: {
      options: { value: string; label: string }[]; onChange: (value: string) => void;
    }) => createElement("div", { "data-mode-control": true }, options.map((option) =>
      createElement("button", { key: option.value, onClick: () => onChange(option.value) }, option.label))),
  };
});

let host: HTMLDivElement;
let root: Root;
let sequence = 0;
let projectPath: string;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  projectPath = `D:/integration-${++sequence}`;
  vi.mocked(inspectProjectFile).mockImplementation(async (_project, path) => ({
    path, name: path.split("/").pop()!, kind: path.endsWith(".pdf") ? "pdf" : path.endsWith(".md") ? "text" : "binary",
    readOnly: false, modifiedAtMs: 100, sizeBytes: 42, largeFile: false,
  }));
  vi.mocked(readProjectFile).mockImplementation(async (_project, path) => ({
    path, name: path.split("/").pop()!, kind: "text", sizeBytes: 42, largeFile: false,
    content: "# Initial shared document", encoding: "utf-8", readOnly: false, modifiedAtMs: 100,
  }));
  vi.mocked(writeProjectFile).mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function auxiliary(path: string, onPromoteToWorkspace = vi.fn()) {
  return createElement(AuxiliaryFileView, {
    projectPath, path, active: true, onPromoteToWorkspace,
  });
}

it("shares one disk read and live edits between the workspace and auxiliary hosts", async () => {
  const path = `${projectPath}/report.md`;
  await act(async () => root.render(createElement("div", null,
    createElement("section", { "data-main": true }, createElement(FileTabView, { tabId: "main", projectPath, path, isActive: true })),
    createElement("section", { "data-auxiliary": true }, auxiliary(path)),
  )));
  expect(readProjectFile).toHaveBeenCalledTimes(1);
  expect(host.querySelectorAll("[data-preview]")).toHaveLength(2);
  const main = host.querySelector("[data-main]")!;
  const editMode = Array.from(main.querySelectorAll("button")).find((button) => button.textContent === "fileTabs.markdownModeEdit")!;
  await act(async () => editMode.click());
  const edit = Array.from(main.querySelectorAll("button")).find((button) => button.textContent === "Edit document")!;
  await act(async () => edit.click());
  expect(main.querySelector("[data-editor]")?.textContent).toBe("# Edited in shared document");
  expect(host.querySelector("[data-auxiliary] [data-preview]")?.textContent).toBe("# Edited in shared document");
  expect(app.setTabDirty).toHaveBeenCalledWith("main", true);
  expect(readProjectFile).toHaveBeenCalledTimes(1);
});

it("places the auxiliary breadcrumb, mode control and actions in one horizontal toolbar", async () => {
  const path = `${projectPath}/report.md`;
  await act(async () => root.render(auxiliary(path)));
  const promote = host.querySelector('[aria-label="auxiliaryDock.openInWorkspace"]')!;
  const toolbar = promote.parentElement!;
  expect(toolbar.querySelector('[aria-label="auxiliaryDock.pin"]')).toBeNull();
  expect(toolbar.querySelector("[data-mode-control]")?.parentElement).toBe(toolbar);
  expect(toolbar.querySelector(`[title="${path}"]`)).not.toBeNull();
  expect(toolbar.querySelector('[aria-label="auxiliaryDock.openInWorkspace"]')?.parentElement).toBe(toolbar);
  expect(toolbar.classList.contains("flex")).toBe(true);
  expect(toolbar.classList.contains("flex-col")).toBe(false);
  expect(toolbar.classList.contains("flex-wrap")).toBe(false);
  expect(host.querySelectorAll("[data-mode-control]")).toHaveLength(1);
});

it.each(["pdf", "docx", "bin"])("retains workspace promotion without the auxiliary pin button for %s files", async (extension) => {
  const path = `${projectPath}/document.${extension}`;
  const onPromote = vi.fn();
  await act(async () => root.render(auxiliary(path, onPromote)));
  const pin = host.querySelector<HTMLButtonElement>('[aria-label="auxiliaryDock.pin"]');
  const promote = host.querySelector<HTMLButtonElement>('[aria-label="auxiliaryDock.openInWorkspace"]');
  expect(pin).toBeNull();
  expect(promote).not.toBeNull();
  expect(host.querySelector('[aria-label="common.openInAssociatedApp"]')).not.toBeNull();
  await act(async () => promote!.click());
  expect(app.openFileTab).not.toHaveBeenCalled();
  expect(onPromote).toHaveBeenCalledOnce();
  if (extension === "pdf") expect(host.querySelector("[data-pdf]")).not.toBeNull();
  if (extension === "docx") expect(host.querySelector("[data-office]")).not.toBeNull();
});


it("uses the terminal theme background for the markdown reading surface", async () => {
  await act(async () => root.render(auxiliary(`${projectPath}/background.md`)));
  expect(host.querySelector<HTMLElement>(".app-markdown-preview-shell")!.style.background).toBe("#ffffff");
});

it.each(["text", "image"] as const)("shows a localized %s preview limit and offers external opening", async (kind) => {
  const path = `${projectPath}/oversized.${kind === "text" ? "md" : "png"}`;
  vi.mocked(inspectProjectFile).mockResolvedValueOnce({
    path, name: "oversized", kind, readOnly: true, modifiedAtMs: 100,
    sizeBytes: 20 * 1024 * 1024, largeFile: true,
  });
  const code = `FILE_PREVIEW_TOO_LARGE:${kind}:16`;
  if (kind === "text") vi.mocked(readProjectFile).mockRejectedValueOnce(code);
  else vi.mocked(readProjectImage).mockRejectedValueOnce(code);

  await act(async () => root.render(auxiliary(path)));

  const empty = host.querySelector("[data-empty]")!;
  expect(empty.textContent).toContain(`filePreview.tooLarge${kind === "text" ? "Text" : "Image"}:16`);
  expect(host.textContent).not.toContain("FILE_PREVIEW_TOO_LARGE");
  expect(host.querySelector("[data-editor]")).toBeNull();
  expect(host.querySelector("[data-preview]")).toBeNull();
  const external = empty.querySelector<HTMLButtonElement>("button")!;
  expect(external.textContent).toBe("common.openInAssociatedApp");
  await act(async () => external.click());
  expect(openInAssociatedApplication).toHaveBeenCalledWith(path);
});

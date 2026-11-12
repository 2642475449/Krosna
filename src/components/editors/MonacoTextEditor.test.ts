// @vitest-environment happy-dom
import { act, createElement, useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Monaco 的测试替身只实现本组件使用的接口；viewState 保留为开放结构以覆盖不同 Monaco 状态版本。
const fixture = vi.hoisted(() => ({ editors: [] as any[], props: new Map<string, any>(),
  app: { themeCategory: "dark", editorFontSize: 14, tabsById: {} as Record<string, { kind: string }> } }));
vi.mock("@/lib/monacoRuntime", () => ({
  Uri: { file: (path: string) => ({ with: ({ query }: { query: string }) => ({ toString: () => `${path}?${query}` }) }) },
  Range: class { constructor(..._args: number[]) {} },
  KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 2 }, editor: { ScrollType: { Smooth: 0 } },
}));
vi.mock("@/lib/monaco", () => ({
  registerRichCodeTokens: vi.fn(), disableMonacoCommandPalette: vi.fn(),
  getMonacoLanguage: () => "typescript", getMonacoThemeName: () => "vs-dark",
  getMonacoTypography: () => ({}), observeMonacoTheme: () => ({ dispose: vi.fn() }),
}));
vi.mock("@/store", () => ({ useAppStore: Object.assign((select: (state: unknown) => unknown) => select(fixture.app), {
  getState: () => fixture.app,
}) }));
vi.mock("@/store/slices/fileEditorStatus", () => ({ useFileEditorStatusStore: {
  getState: () => ({ removeEditorStatus: vi.fn(), setEditorStatus: vi.fn() }),
} }));
vi.mock("./MonacoContextMenu", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("@monaco-editor/react", () => ({
  loader: { config: vi.fn() },
  default: (props: any) => {
    const initial = useRef(props);
    fixture.props.set(props.path, props);
    useEffect(() => {
      const subscriptions: any[] = [];
      const cursorListeners = new Set<() => void>();
      const scrollListeners = new Set<() => void>();
      const subscribe = (listeners: Set<() => void>, callback: () => void) => {
        listeners.add(callback);
        const subscription = { dispose: vi.fn(() => listeners.delete(callback)) };
        subscriptions.push(subscription);
        return subscription;
      };
      const instance = {
        path: initial.current.path,
        view: { cursorState: [], viewState: { scrollTop: 200 }, contributionsState: {} },
        saveViewState: vi.fn(() => instance.view),
        restoreViewState: vi.fn((view) => { instance.view = view; }),
        addCommand: vi.fn(), layout: vi.fn(), focus: vi.fn(),
        setSelection: vi.fn(), revealRangeInCenter: vi.fn(),
        position: { lineNumber: 1, column: 1 }, scrollTop: 200, scrollLeft: 0,
        getPosition: vi.fn(() => instance.position),
        setPosition: vi.fn((position: { lineNumber: number; column: number }) => { instance.position = position; }),
        getScrollTop: vi.fn(() => instance.scrollTop), getScrollLeft: vi.fn(() => instance.scrollLeft),
        setScrollPosition: vi.fn((scroll: { scrollTop: number; scrollLeft: number }) => {
          instance.scrollTop = scroll.scrollTop; instance.scrollLeft = scroll.scrollLeft;
        }),
        getModel: vi.fn(() => ({ getOptions: () => ({ tabSize: 2, insertSpaces: true }),
          getLanguageId: () => "typescript", getEOL: () => "\n" })),
        onDidChangeCursorPosition: vi.fn((callback: () => void) => subscribe(cursorListeners, callback)),
        onDidChangeModel: vi.fn(() => ({ dispose: vi.fn() })),
        onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() })),
        onDidChangeModelOptions: vi.fn(() => ({ dispose: vi.fn() })),
        onDidChangeModelLanguage: vi.fn(() => ({ dispose: vi.fn() })),
        onDidScrollChange: vi.fn((callback: () => void) => subscribe(scrollListeners, callback)),
        fireCursorChange: () => [...cursorListeners].forEach((listener) => listener()),
        fireScrollChange: () => [...scrollListeners].forEach((listener) => listener()),
        dispose: vi.fn(() => subscriptions.forEach((subscription) => subscription.dispose())),
      };
      fixture.editors.push(instance);
      initial.current.onMount(instance, { KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 2 },
        languages: { getLanguages: () => [{ id: "typescript", aliases: ["TypeScript"] }] } });
      return () => { fixture.props.delete(instance.path); instance.dispose(); };
    }, []);
    return createElement("div", { "data-editor": props.path });
  },
}));
import MonacoTextEditor from "./MonacoTextEditor";
import { useWorkspaceRecoveryStore } from "@/store/slices/workspaceRecovery";

let root: Root;
let container: HTMLDivElement;
let frames: FrameRequestCallback[];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { frames.push(callback); return frames.length; });
  fixture.editors = [];
  fixture.props.clear();
  fixture.app.tabsById = {};
  useWorkspaceRecoveryStore.setState({ editorViews: {} });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render(overrides: Partial<ComponentProps<typeof MonacoTextEditor>> = {}) {
  act(() => root.render(createElement(MonacoTextEditor, {
    filePath: "D:/synthetic/review.ts", value: "const value = 1;", readOnly: false,
    onChange: vi.fn(), ...overrides,
  })));
}

it("does not allocate a hidden pristine editor and restores view state after releasing it", () => {
  render({ isActive: false });
  expect(fixture.editors).toHaveLength(0);
  render({ isActive: true });
  const first = fixture.editors[0];
  first.view = { cursorState: [{ position: { lineNumber: 42 } }], viewState: { scrollTop: 800 } };
  render({ isActive: false });
  expect(first.saveViewState).toHaveBeenCalledTimes(1);
  expect(first.dispose).toHaveBeenCalledTimes(1);
  expect(container.querySelector("[data-editor]")).toBeNull();
  render({ isActive: true });
  expect(fixture.editors[1].restoreViewState).toHaveBeenCalledWith(first.view);
  expect(fixture.props.get(first.path).saveViewState).toBe(false);
});

it("retains an edited model across hiding and saving so its undo history survives", () => {
  const onChange = vi.fn();
  render({ onChange });
  const first = fixture.editors[0];
  act(() => fixture.props.get(first.path).onChange("const value = 2;"));
  expect(onChange).toHaveBeenCalledWith("const value = 2;");
  render({ isActive: false, value: "const value = 2;", saveEnabled: true });
  render({ isActive: false, value: "const value = 2;", saveEnabled: false });
  render({ isActive: true, value: "const value = 2;" });
  expect(fixture.editors).toHaveLength(1);
  expect(first.dispose).not.toHaveBeenCalled();
  act(() => root.render(null));
  expect(first.dispose).toHaveBeenCalledTimes(1);
});

it("does not carry another file's retained model or view into a replacement preview", () => {
  render();
  const first = fixture.editors[0];
  act(() => fixture.props.get(first.path).onChange("edited"));
  render({ isActive: false, filePath: "D:/synthetic/other.ts" });
  expect(first.dispose).toHaveBeenCalledTimes(1);
  expect(fixture.editors).toHaveLength(1);
  render({ isActive: true, filePath: "D:/synthetic/other.ts" });
  expect(fixture.editors[1].restoreViewState).not.toHaveBeenCalled();
});

it("preserves restored position instead of repeating an old navigation, but applies new hidden navigation", () => {
  const target = { requestId: "first", lineNumber: 10, startColumn: 1, endColumn: 3 };
  render({ revealTarget: target });
  act(() => { frames.splice(0).forEach((callback) => callback(0)); });
  const first = fixture.editors[0];
  expect(first.revealRangeInCenter).toHaveBeenCalled();
  render({ isActive: false, revealTarget: target });
  render({ isActive: true, revealTarget: target });
  act(() => { frames.splice(0).forEach((callback) => callback(0)); });
  expect(fixture.editors[1].restoreViewState).toHaveBeenCalled();
  expect(fixture.editors[1].revealRangeInCenter).not.toHaveBeenCalled();
  const nextTarget = { ...target, requestId: "next", lineNumber: 60 };
  render({ isActive: false, revealTarget: nextTarget });
  render({ isActive: true, revealTarget: nextTarget });
  act(() => { frames.splice(0).forEach((callback) => callback(0)); });
  expect(fixture.editors[2].revealRangeInCenter).toHaveBeenCalledTimes(1);
});

it("restores persisted file cursor and scroll positions and keeps them after first layout", () => {
  const filePath = "D:/synthetic/review.ts";
  fixture.app.tabsById.file = { kind: "file" };
  const view = { lineNumber: 42, column: 7, scrollTop: 864, scrollLeft: 32 };
  useWorkspaceRecoveryStore.getState().setEditorView(filePath, view);
  render({ statusTabId: "file" });
  const editor = fixture.editors[0];
  expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 42, column: 7 });
  expect(editor.setScrollPosition).toHaveBeenCalledWith({ scrollTop: 864, scrollLeft: 32 });
  // 模拟 Monaco 首轮布局重置滚动位置；下一帧应重新应用恢复值。
  editor.scrollTop = 0; editor.scrollLeft = 0;
  act(() => frames.splice(0).forEach((callback) => callback(0)));
  expect(editor.scrollTop).toBe(864);
  expect(editor.scrollLeft).toBe(32);
  expect(editor.revealRangeInCenter).not.toHaveBeenCalled();
});

it("saves current workspace file position on cursor, scroll and unmount into the real recovery store", () => {
  const filePath = "D:/synthetic/review.ts";
  fixture.app.tabsById.file = { kind: "file" };
  render({ statusTabId: "file" });
  const editor = fixture.editors[0];
  editor.position = { lineNumber: 50, column: 6 };
  editor.scrollTop = 920; editor.scrollLeft = 16;
  act(() => editor.fireCursorChange());
  expect(useWorkspaceRecoveryStore.getState().editorViews[filePath])
    .toEqual({ lineNumber: 50, column: 6, scrollTop: 920, scrollLeft: 16 });
  editor.scrollTop = 1100;
  act(() => editor.fireScrollChange());
  expect(useWorkspaceRecoveryStore.getState().editorViews[filePath]?.scrollTop).toBe(1100);
  editor.position = { lineNumber: 70, column: 2 };
  act(() => root.render(null));
  expect(useWorkspaceRecoveryStore.getState().editorViews[filePath])
    .toEqual({ lineNumber: 70, column: 2, scrollTop: 1100, scrollLeft: 16 });
});

it("uses a new explicit navigation instead of restoring the old persisted file location", () => {
  const filePath = "D:/synthetic/review.ts";
  useWorkspaceRecoveryStore.getState().setEditorView(filePath,
    { lineNumber: 42, column: 7, scrollTop: 864, scrollLeft: 32 });
  render({ revealTarget: { requestId: "new-navigation", lineNumber: 90, startColumn: 1, endColumn: 3 } });
  act(() => frames.splice(0).forEach((callback) => callback(0)));
  expect(fixture.editors[0].setPosition).not.toHaveBeenCalled();
  expect(fixture.editors[0].setScrollPosition).not.toHaveBeenCalled();
  expect(fixture.editors[0].revealRangeInCenter).toHaveBeenCalled();
});

it("does not overwrite persisted workspace positions from an auxiliary editor", () => {
  const filePath = "D:/synthetic/review.ts";
  const view = { lineNumber: 42, column: 7, scrollTop: 864, scrollLeft: 32 };
  useWorkspaceRecoveryStore.getState().setEditorView(filePath, view);
  render();
  fixture.editors[0].position = { lineNumber: 1, column: 1 };
  act(() => root.render(null));
  expect(useWorkspaceRecoveryStore.getState().editorViews[filePath]).toEqual(view);
});

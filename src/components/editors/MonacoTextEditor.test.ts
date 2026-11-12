// @vitest-environment happy-dom
import { act, createElement, useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ editors: [] as any[], props: new Map<string, any>() }));
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
vi.mock("@/store", () => ({ useAppStore: (select: (state: unknown) => unknown) => select({
  themeCategory: "dark", editorFontSize: 14,
}) }));
vi.mock("@/store/slices/fileEditorStatus", () => ({ useFileEditorStatusStore: { getState: () => ({ removeEditorStatus: vi.fn() }) } }));
vi.mock("./MonacoContextMenu", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("@monaco-editor/react", () => ({
  loader: { config: vi.fn() },
  default: (props: any) => {
    const initial = useRef(props);
    fixture.props.set(props.path, props);
    useEffect(() => {
      const subscriptions: any[] = [];
      const instance = {
        path: initial.current.path,
        view: { cursorState: [], viewState: { scrollTop: 200 }, contributionsState: {} },
        saveViewState: vi.fn(() => instance.view),
        restoreViewState: vi.fn((view) => { instance.view = view; }),
        addCommand: vi.fn(), layout: vi.fn(), focus: vi.fn(),
        setSelection: vi.fn(), revealRangeInCenter: vi.fn(),
        onDidScrollChange: vi.fn(() => { const subscription = { dispose: vi.fn() }; subscriptions.push(subscription); return subscription; }),
        dispose: vi.fn(() => subscriptions.forEach((subscription) => subscription.dispose())),
      };
      fixture.editors.push(instance);
      initial.current.onMount(instance, { KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 2 } });
      return () => { fixture.props.delete(instance.path); instance.dispose(); };
    }, []);
    return createElement("div", { "data-editor": props.path });
  },
}));
import MonacoTextEditor from "./MonacoTextEditor";

let root: Root;
let container: HTMLDivElement;
let frames: FrameRequestCallback[];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { frames.push(callback); return frames.length; });
  fixture.editors = [];
  fixture.props.clear();
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

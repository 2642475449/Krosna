import { Children, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ThemeMode } from "@/store";

interface HookCell {
  value?: unknown;
  deps?: unknown[];
  cleanup?: () => void;
}

// 在 node 环境保留 Hook 状态、引用与 effect 清理顺序，不依赖 DOM。
const mocks = vi.hoisted(() => ({
  theme: "light-glass" as ThemeMode,
  language: "zh-CN",
  cells: [] as HookCell[],
  cursor: 0,
  effects: [] as { cell: HookCell; effect: () => void | (() => void); deps: unknown[] }[],
}));
vi.mock("react", async (importOriginal) => {
  const nextCell = () => mocks.cells[mocks.cursor++] ??= {};
  const same = (left: unknown[] | undefined, right: unknown[]) =>
    left?.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const memo = <T>(factory: () => T, deps: unknown[]) => {
    const cell = nextCell();
    if (!same(cell.deps, deps)) { cell.value = factory(); cell.deps = deps; }
    return cell.value as T;
  };
  return {
    ...await importOriginal<typeof import("react")>(),
    useState: <T>(initial: T) => {
      const cell = nextCell();
      if (!("value" in cell)) cell.value = initial;
      return [cell.value as T, (next: T | ((value: T) => T)) => {
        cell.value = typeof next === "function" ? (next as (value: T) => T)(cell.value as T) : next;
      }];
    },
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      const cell = nextCell();
      if (!same(cell.deps, deps)) mocks.effects.push({ cell, effect, deps });
    },
    useMemo: memo,
    useCallback: <T>(callback: T, deps: unknown[]) => memo(() => callback, deps),
    useRef: <T>(current: T) => memo(() => ({ current }), []),
  };
});
vi.mock("@/store", () => ({
  useAppStore: (select: (state: { activeTheme: () => ThemeMode }) => unknown) =>
    select({ activeTheme: () => mocks.theme }),
}));
vi.mock("react-i18next", () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ i18n: { resolvedLanguage: mocks.language }, t }) };
});
vi.mock("@/lib/api", () => ({ openInAssociatedApplication: vi.fn(), readProjectOfficePreview: vi.fn() }));
vi.mock("@file-viewer/react", () => ({ FileViewer: () => null }));
vi.mock("@file-viewer/renderer-word", () => ({ wordRenderer: {} }));
vi.mock("@file-viewer/renderer-spreadsheet", () => ({ spreadsheetRenderer: {} }));
vi.mock("@file-viewer/renderer-presentation", () => ({ presentationRenderer: {} }));
import { Button, Empty, Spin } from "antd";
import { FileViewer, type ViewerState } from "@file-viewer/react";
import { openInAssociatedApplication, readProjectOfficePreview } from "@/lib/api";
import OfficeFilePreview from "./OfficeFilePreview";

type PreviewProps = ComponentProps<typeof OfficeFilePreview>;
type ViewerProps = ComponentProps<typeof FileViewer>;
let props: PreviewProps;

function findElement<P>(node: ReactNode, type: unknown): ReactElement<P> | undefined {
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  if (node.type === type) return node as ReactElement<P>;
  return Children.toArray(node.props.children).map((child) => findElement<P>(child, type)).find(Boolean);
}

function render(nextProps: Partial<PreviewProps> = {}) {
  props = { ...props, ...nextProps };
  mocks.cursor = 0;
  mocks.effects = [];
  const output = OfficeFilePreview(props);
  for (const { cell } of mocks.effects) cell.cleanup?.();
  for (const { cell, effect, deps } of mocks.effects) {
    cell.cleanup = effect() || undefined;
    cell.deps = deps;
  }
  return output;
}

async function settleRead() {
  // 排空 readProjectOfficePreview 的 then/catch/finally 链。
  for (let index = 0; index < 4; index++) await Promise.resolve();
  return render();
}

async function loadViewer() {
  render();
  const viewer = findElement<ViewerProps>(await settleRead(), FileViewer);
  expect(viewer).toBeDefined();
  return viewer!.props;
}

function viewerState(error: unknown = null): ViewerState {
  return {
    loading: false, ready: error === null, error, lastEvent: null, lifecycle: null,
    availability: null, search: null, zoom: null, location: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.theme = "light-glass";
  mocks.language = "zh-CN";
  mocks.cells = [];
  props = { projectPath: "C:/project", path: "C:/project/report.docx", modifiedAtMs: 100, sizeBytes: 8 };
  vi.mocked(readProjectOfficePreview).mockResolvedValue(new Uint8Array([1, 2, 3]));
});
afterEach(() => { for (const cell of mocks.cells) cell.cleanup?.(); });

it.each([
  ["light-glass", "light"], ["light-warm", "light"],
  ["dark-starry", "dark"], ["dark-mocha", "dark"],
] as const)("passes the resolved app theme %s to the Office viewer", async (theme, expected) => {
  mocks.theme = theme;
  expect((await loadViewer()).options?.theme).toBe(expected);
});

it("keeps the viewer inputs stable across polling and unrelated rerenders", async () => {
  const first = await loadViewer();
  const next = findElement<ViewerProps>(render(), FileViewer)!.props;
  expect(next.buffer).toBe(first.buffer);
  expect(next.options).toBe(first.options);
  expect(next.onStateChange).toBe(first.onStateChange);
  expect(readProjectOfficePreview).toHaveBeenCalledOnce();
});

it("updates options only when the resolved theme or language changes", async () => {
  const first = await loadViewer();
  mocks.theme = "dark-mocha";
  const dark = findElement<ViewerProps>(render(), FileViewer)!.props;
  expect(dark.options?.theme).toBe("dark");
  expect(dark.options).not.toBe(first.options);
  mocks.theme = "dark-starry";
  expect(findElement<ViewerProps>(render(), FileViewer)!.props.options).toBe(dark.options);
  mocks.language = "en-US";
  expect(findElement<ViewerProps>(render(), FileViewer)!.props.options?.locale).toBe("en-US");
  expect(readProjectOfficePreview).toHaveBeenCalledOnce();
});

it.each([new Error("word.error.invalidDocx"), "Invalid ZIP", ""])("shows a fallback for renderer errors: %s", async (error) => {
  const viewer = await loadViewer();
  expect(viewer.onStateChange).toBeTypeOf("function");
  viewer.onStateChange?.(viewerState(error));
  const output = render();
  expect(findElement<ViewerProps>(output, FileViewer)).toBeUndefined();
  expect(findElement<ComponentProps<typeof Empty>>(output, Empty)?.props.description)
    .toBe(error instanceof Error ? error.message : error || "fileTabs.officePreviewUnavailable");
});

it("allows external opening and retry after a renderer failure", async () => {
  const viewer = await loadViewer();
  viewer.onStateChange?.(viewerState(new Error("Invalid ZIP")));
  const empty = findElement<ComponentProps<typeof Empty>>(render(), Empty)!;
  const buttons = Children.toArray((empty.props.children as ReactElement<{ children: ReactNode }>).props.children);
  const retry = findElement<ComponentProps<typeof Button>>(buttons[0], Button)!;
  const external = findElement<ComponentProps<typeof Button>>(buttons[1], Button)!;
  external.props.onClick?.({} as Parameters<NonNullable<typeof external.props.onClick>>[0]);
  expect(openInAssociatedApplication).toHaveBeenCalledWith(props.path);
  retry.props.onClick?.({} as Parameters<NonNullable<typeof retry.props.onClick>>[0]);
  render();
  expect(findElement(render(), Spin)).toBeDefined();
  const restored = findElement<ViewerProps>(await settleRead(), FileViewer)!;
  expect(restored.props.buffer).not.toBe(viewer.buffer);
  expect(readProjectOfficePreview).toHaveBeenCalledTimes(2);
});

it.each([{ modifiedAtMs: 101 }, { sizeBytes: 42 }])("reloads bytes when file metadata changes: %o", async (metadata) => {
  const first = await loadViewer();
  render(metadata);
  expect(findElement(render(), Spin)).toBeDefined();
  const next = findElement<ViewerProps>(await settleRead(), FileViewer)!.props;
  expect(next.buffer).not.toBe(first.buffer);
  expect(readProjectOfficePreview).toHaveBeenCalledTimes(2);
  render({ ...metadata });
  expect(readProjectOfficePreview).toHaveBeenCalledTimes(2);
});

it("recovers automatically after the file is rewritten following a renderer error", async () => {
  const viewer = await loadViewer();
  viewer.onStateChange?.(viewerState(new Error("Invalid ZIP")));
  expect(findElement(render(), Empty)).toBeDefined();
  render({ modifiedAtMs: 200 });
  expect(findElement(await settleRead(), FileViewer)).toBeDefined();
  expect(readProjectOfficePreview).toHaveBeenCalledTimes(2);
});

it("shows IPC failures and recovers on the next file version", async () => {
  vi.mocked(readProjectOfficePreview).mockRejectedValueOnce(new Error("File is locked"));
  render();
  expect(findElement<ComponentProps<typeof Empty>>(await settleRead(), Empty)?.props.description).toBe("File is locked");
  render({ sizeBytes: 42 });
  expect(findElement(await settleRead(), FileViewer)).toBeDefined();
});

it.each(["success", "failure"])("ignores a stale byte read ending in %s", async (result) => {
  const old = deferred<Uint8Array>();
  vi.mocked(readProjectOfficePreview).mockReturnValueOnce(old.promise);
  render();
  render({ modifiedAtMs: 200 });
  const latest = findElement<ViewerProps>(await settleRead(), FileViewer)!.props.buffer;
  if (result === "success") old.resolve(new Uint8Array([9, 9]));
  else old.reject(new Error("Old read failed"));
  expect(findElement<ViewerProps>(await settleRead(), FileViewer)!.props.buffer).toBe(latest);
});

it("ignores delayed renderer errors from a replaced preview", async () => {
  const old = await loadViewer();
  render({ modifiedAtMs: 200 });
  const latest = findElement<ViewerProps>(await settleRead(), FileViewer)!.props.buffer;
  old.onStateChange?.(viewerState(new Error("Old render failed")));
  expect(findElement<ViewerProps>(render(), FileViewer)?.props.buffer).toBe(latest);
});

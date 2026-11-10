import { Children, isValidElement, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ThemeMode } from "@/store";

const mocks = vi.hoisted(() => ({ theme: "light-glass" as ThemeMode, stateIndex: 0 }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  // node 环境下只替换 Hook 调度，直接检查加载完成后的实际组件输出。
  useState: () => [[new ArrayBuffer(8), false, null, 0][mocks.stateIndex++], vi.fn()],
  useEffect: () => undefined,
  useMemo: <T>(factory: () => T) => factory(),
  useCallback: <T>(callback: T) => callback,
  useRef: <T>(current: T) => ({ current }),
}));
vi.mock("@/store", () => ({
  useAppStore: (select: (state: { activeTheme: () => ThemeMode }) => unknown) =>
    select({ activeTheme: () => mocks.theme }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { resolvedLanguage: "zh-CN" }, t: (key: string) => key }) }));
vi.mock("@/lib/api", () => ({ openInAssociatedApplication: vi.fn(), readProjectOfficePreview: vi.fn() }));
vi.mock("@file-viewer/react", () => ({ FileViewer: () => null }));
vi.mock("@file-viewer/renderer-word", () => ({ wordRenderer: {} }));
vi.mock("@file-viewer/renderer-spreadsheet", () => ({ spreadsheetRenderer: {} }));
vi.mock("@file-viewer/renderer-presentation", () => ({ presentationRenderer: {} }));
import { FileViewer } from "@file-viewer/react";
import OfficeFilePreview from "./OfficeFilePreview";

function viewerTheme(node: ReactNode): unknown {
  if (!isValidElement<{ options?: { theme?: string }; children?: ReactNode }>(node)) return undefined;
  if (node.type === FileViewer) return node.props.options?.theme;
  return Children.toArray(node.props.children).map(viewerTheme).find((theme) => theme !== undefined);
}

function renderTheme() {
  mocks.stateIndex = 0;
  return viewerTheme(OfficeFilePreview({ projectPath: "C:/project", path: "C:/project/report.docx" }));
}

beforeEach(() => { mocks.theme = "light-glass"; });

it.each([
  ["light-glass", "light"], ["light-warm", "light"],
  ["dark-starry", "dark"], ["dark-mocha", "dark"],
] as const)("passes the resolved app theme %s to the Office viewer", (theme, expected) => {
  mocks.theme = theme;
  expect(renderTheme()).toBe(expected);
});

it("updates the viewer theme when the resolved app theme changes", () => {
  expect(renderTheme()).toBe("light");
  mocks.theme = "dark-mocha";
  expect(renderTheme()).toBe("dark");
  mocks.theme = "light-warm";
  expect(renderTheme()).toBe("light");
});

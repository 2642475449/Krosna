// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import "@/i18n";
import { TerminalLinkDialog } from "./TerminalLinkDialog";

interface MockPopoverProps {
  open?: boolean;
  classNames?: { root?: string };
  content?: ReactNode;
  children?: ReactNode;
  afterOpenChange?: (visible: boolean) => void;
}

let capturedPopoverProps: MockPopoverProps | null = null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("antd", async (importOriginal) => ({
  ...await importOriginal<typeof import("antd")>(),
  Popover: (props: MockPopoverProps) => {
    capturedPopoverProps = props;
    return createElement(
      "div",
      { "data-popover-root": props.classNames?.root, "data-open": String(Boolean(props.open)) },
      props.children,
      props.open ? props.content : null,
    );
  },
}));

const mountedRoots: Array<{ unmount: () => void; container: HTMLElement }> = [];

afterEach(() => {
  while (mountedRoots.length > 0) {
    const entry = mountedRoots.pop()!;
    act(() => {
      entry.unmount();
    });
    entry.container.remove();
  }
});

function mountDialog(props: Parameters<typeof TerminalLinkDialog>[0]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(TerminalLinkDialog, props));
  });
  mountedRoots.push({ unmount: () => root.unmount(), container });
  return container;
}

it("renders file confirmation as an anchored command-palette popover with all open modes", () => {
  const html = renderToStaticMarkup(createElement(TerminalLinkDialog, {
    open: true,
    kind: "file",
    value: "src/store/persistentSettingsRuntime.ts",
    line: 42,
    anchor: { x: 240, y: 180 },
    opening: false,
    onSelectPath: vi.fn(),
    onConfirm: vi.fn(),
    onCopy: vi.fn(),
    onCancel: vi.fn(),
  }));

  expect(capturedPopoverProps?.classNames?.root).toBe("app-terminal-link-popover");
  expect(html).toContain("left:240px;top:180px");
  expect(html).toContain('role="dialog"');
  expect(html).toContain("aria-labelledby=");
  expect(html).toContain("aria-describedby=");
  expect(html).toContain("persistentSettingsRuntime.ts");
  expect(html).toContain("app-terminal-link-dialog__header-path");
  expect(html).toContain("src/store/persistentSettingsRuntime.ts");
  expect(html).toContain(":42");
  expect(html).not.toContain("app-terminal-link-dialog__ext-badge");
  expect(html).not.toContain("<p id=");
  expect(html).toContain("默认方式打开");
  expect(html).toContain("用本机默认应用打开");
  expect(html).toContain("在资源管理器中显示");
  expect(html).toContain("在侧边辅助区预览");
  expect(html).not.toContain("app-terminal-link-dialog__footer-hint");
});

it("clamps anchor coordinates inside viewport bounds and marks choosing mode", () => {
  const originalWidth = window.innerWidth;
  const originalHeight = window.innerHeight;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  try {
    const html = renderToStaticMarkup(createElement(TerminalLinkDialog, {
      open: true,
      kind: "file",
      value: "index.ts",
      anchor: { x: -40, y: 2000 },
      resolution: {
        targets: [
          { path: "E:/repo/src/index.ts", kind: "file", inProject: true, projectRelativePath: "src/index.ts" },
          { path: "E:/repo/tests/index.ts", kind: "file", inProject: true, projectRelativePath: "tests/index.ts" },
        ],
        truncated: false,
      },
      selectedPath: "E:/repo/src/index.ts",
      opening: false,
      onSelectPath: vi.fn(),
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    }));

    expect(capturedPopoverProps?.classNames?.root).toBe("app-terminal-link-popover app-terminal-link-popover--choosing");
    expect(html).toContain("left:12px;top:788px");
    expect(html).toContain("E:/repo/src/index.ts");
    expect(html).toContain("E:/repo/tests/index.ts");
  } finally {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight });
  }
});

it("does not hijack Enter on copy or cancel buttons and preserves Arrow keys inside Radio.Group", () => {
  const onConfirm = vi.fn();
  const onCopy = vi.fn();
  const onCancel = vi.fn();

  const container = mountDialog({
    open: true,
    kind: "file",
    value: "index.ts",
    resolution: {
      targets: [
        { path: "E:/repo/src/index.ts", kind: "file", inProject: true, projectRelativePath: "src/index.ts" },
        { path: "E:/repo/tests/index.ts", kind: "file", inProject: true, projectRelativePath: "tests/index.ts" },
      ],
      truncated: false,
    },
    selectedPath: "E:/repo/src/index.ts",
    opening: false,
    onSelectPath: vi.fn(),
    onConfirm,
    onCopy,
    onCancel,
  });

  const copyBtn = container.querySelector<HTMLButtonElement>(".app-terminal-link-dialog__copy-btn")!;
  act(() => {
    copyBtn.focus();
  });
  const copyEnter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  act(() => {
    window.dispatchEvent(copyEnter);
  });
  expect(copyEnter.defaultPrevented).toBe(false);
  expect(onConfirm).not.toHaveBeenCalled();

  const radio = container.querySelector<HTMLInputElement>("input[type='radio']")!;
  act(() => {
    radio.focus();
  });
  const radioArrow = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
  act(() => {
    window.dispatchEvent(radioArrow);
  });
  expect(radioArrow.defaultPrevented).toBe(false);
});

it("updates aria-activedescendant with ArrowDown and wraps Tab focus within dialog", () => {
  const onConfirm = vi.fn();
  const container = mountDialog({
    open: true,
    kind: "file",
    value: "src/index.ts",
    opening: false,
    onSelectPath: vi.fn(),
    onConfirm,
    onCopy: vi.fn(),
    onCancel: vi.fn(),
  });

  const dialog = container.querySelector<HTMLDivElement>("[role='dialog']")!;
  act(() => {
    dialog.focus();
  });

  const initialDescendant = dialog.getAttribute("aria-activedescendant");
  expect(initialDescendant).toBeTruthy();

  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  });

  const nextDescendant = dialog.getAttribute("aria-activedescendant");
  expect(nextDescendant).toBeTruthy();
  expect(nextDescendant).not.toBe(initialDescendant);

  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  expect(onConfirm).toHaveBeenCalledWith("system");

  const menuItems = container.querySelectorAll<HTMLButtonElement>("[role='menuitem']");
  const lastMenuItem = menuItems[menuItems.length - 1]!;
  const copyBtn = container.querySelector<HTMLButtonElement>(".app-terminal-link-dialog__copy-btn")!;
  act(() => {
    lastMenuItem.focus();
  });
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
  });
  expect(document.activeElement).toBe(copyBtn);
});

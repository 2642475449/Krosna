import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import "@/i18n";
import { TerminalLinkDialog } from "./TerminalLinkDialog";

interface MockPopoverProps {
  open?: boolean;
  classNames?: { root?: string };
  content?: ReactNode;
  children?: ReactNode;
}

let capturedPopoverProps: MockPopoverProps | null = null;

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

it("renders file confirmation as an anchored popover with non-duplicated action copy", () => {
  const html = renderToStaticMarkup(createElement(TerminalLinkDialog, {
    open: true,
    kind: "file",
    value: "src/store/persistentSettingsRuntime.ts",
    anchor: { x: 240, y: 180 },
    opening: false,
    onSelectPath: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }));

  expect(capturedPopoverProps?.classNames?.root).toBe("app-terminal-link-popover");
  expect(html).toContain("left:240px;top:180px");
  expect(html).toContain('role="dialog"');
  expect(html).toContain("aria-labelledby=");
  expect(html).toContain("aria-describedby=");
  expect(html).toContain(">打开文件</h2>");
  expect(html).toContain("<span>打 开</span>");
  expect(html).toContain("<span>取 消</span>");
});

it("clamps anchor coordinates inside viewport bounds and marks choosing mode", () => {
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
});

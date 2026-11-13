import { expect, it } from "vitest";
import {
  computeLedgerPopoverPosition,
  hasBlockingAntdOverlay,
  shouldIgnoreLedgerPopoverPointerDown,
  type ClosestTarget,
} from "./ledgerPopover";

function createTarget(matchedSelectors: string[]): ClosestTarget {
  const matched = new Set(matchedSelectors);
  return {
    closest: (selector: string) => (matched.has(selector) ? {} : null),
  };
}

it("places popover below anchor when space below is sufficient", () => {
  const pos = computeLedgerPopoverPosition({
    anchorRect: { top: 120, bottom: 172, left: 40, right: 800 },
    popoverHeight: 320,
    viewportWidth: 1000,
    viewportHeight: 800,
    maxWidth: 468,
  });

  expect(pos.flipUp).toBe(false);
  expect(pos.top).toBe(178);
  expect(pos.width).toBe(468);
  expect(pos.left).toBe(332);
});

it("flips popover upward only when bottom space overflows and top space is larger", () => {
  const nearBottom = computeLedgerPopoverPosition({
    anchorRect: { top: 560, bottom: 612, left: 40, right: 800 },
    popoverHeight: 340,
    viewportWidth: 1000,
    viewportHeight: 720,
    maxWidth: 500,
    rightInset: 16,
  });

  expect(nearBottom.flipUp).toBe(true);
  expect(nearBottom.top).toBe(214);
  expect(nearBottom.left).toBe(284);
});

it("clamps popover within narrow viewports without overflowing", () => {
  const narrow = computeLedgerPopoverPosition({
    anchorRect: { top: 100, bottom: 150, left: 0, right: 320 },
    popoverHeight: 900,
    viewportWidth: 340,
    viewportHeight: 400,
    maxWidth: 500,
  });

  expect(narrow.left).toBe(12);
  expect(narrow.width).toBe(316);
  expect(narrow.maxHeight).toBe(376);
  expect(narrow.top).toBe(12);
});

it("ignores outside pointer downs inside popover, triggers, modals, selects, tooltips, and popovers", () => {
  for (const selector of [
    ".app-git-popover",
    "[data-git-trigger]",
    ".ant-select-dropdown",
    ".ant-message",
    ".ant-notification",
    ".ant-modal-root",
    ".ant-tooltip",
    ".ant-popover",
  ]) {
    expect(
      shouldIgnoreLedgerPopoverPointerDown(createTarget([selector]), ".app-git-popover", "[data-git-trigger]"),
    ).toBe(true);
  }

  expect(
    shouldIgnoreLedgerPopoverPointerDown(createTarget([".app-settings-content"]), ".app-git-popover", "[data-git-trigger]"),
  ).toBe(false);
});

it("detects open AntD selects, modals, tooltips, and popovers before closing on Escape", () => {
  const emptyDoc = {
    querySelector: () => null,
    querySelectorAll: () => [] as unknown as NodeListOf<Element>,
  };
  expect(hasBlockingAntdOverlay(emptyDoc, null)).toBe(false);

  expect(
    hasBlockingAntdOverlay(emptyDoc, { querySelector: (selector: string) => (selector === ".ant-select-open" ? ({} as Element) : null) }),
  ).toBe(true);

  expect(
    hasBlockingAntdOverlay(
      {
        querySelector: () => null,
        querySelectorAll: () => [{ style: { display: "none" } }, { style: { display: "block" } }] as unknown as NodeListOf<Element>,
      },
      null,
    ),
  ).toBe(true);

  expect(
    hasBlockingAntdOverlay(
      {
        querySelector: () => null,
        querySelectorAll: () => [{ style: { display: "none" } }] as unknown as NodeListOf<Element>,
      },
      null,
    ),
  ).toBe(false);

  expect(
    hasBlockingAntdOverlay(
      {
        querySelector: (selector: string) => (selector.includes("ant-select-dropdown") ? ({} as Element) : null),
        querySelectorAll: () => [] as unknown as NodeListOf<Element>,
      },
      null,
    ),
  ).toBe(true);
});

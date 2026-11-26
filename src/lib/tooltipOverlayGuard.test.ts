// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissActiveTooltips, installGlobalTooltipOverlayGuard } from "./tooltipOverlayGuard";

describe("tooltipOverlayGuard", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => {
    host.remove();
    vi.restoreAllMocks();
  });

  it("dispatches mouseout and mouseleave to every active tooltip trigger", () => {
    const first = document.createElement("button");
    first.className = "ant-tooltip-open";
    const second = document.createElement("span");
    second.className = "ant-tooltip-open";
    host.append(first, second);

    const events: string[] = [];
    first.addEventListener("mouseout", () => events.push("first:mouseout"));
    first.addEventListener("mouseleave", () => events.push("first:mouseleave"));
    second.addEventListener("mouseout", () => events.push("second:mouseout"));
    second.addEventListener("mouseleave", () => events.push("second:mouseleave"));

    expect(dismissActiveTooltips(document)).toBe(2);
    expect(events).toEqual([
      "first:mouseout",
      "first:mouseleave",
      "second:mouseout",
      "second:mouseleave",
    ]);
  });

  it("dismisses active tooltips on global contextmenu and external pointerdown, but ignores clicks inside a tooltip", () => {
    const trigger = document.createElement("button");
    trigger.className = "ant-tooltip-open";
    const tooltip = document.createElement("div");
    tooltip.className = "ant-tooltip";
    const tooltipText = document.createElement("span");
    tooltip.append(tooltipText);
    host.append(trigger, tooltip);

    const onMouseOut = vi.fn();
    trigger.addEventListener("mouseout", onMouseOut);

    const cleanup = installGlobalTooltipOverlayGuard(document);

    // Clicking inside the tooltip itself should not dismiss it.
    tooltipText.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(onMouseOut).not.toHaveBeenCalled();

    // Right-clicking anywhere dismisses active tooltips.
    trigger.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(onMouseOut).toHaveBeenCalledTimes(1);

    // Left-clicking a trigger (e.g. opening a Popover or Dropdown) dismisses active tooltips.
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(onMouseOut).toHaveBeenCalledTimes(2);

    cleanup();

    // After cleanup, listeners are removed.
    trigger.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(onMouseOut).toHaveBeenCalledTimes(2);
  });
});

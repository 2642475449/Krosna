/** 账本行浮动编辑框的视口定位计算、外部点击判定与遮罩层冲突检测工具。 */

export interface PopoverRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface PopoverPositionInput {
  anchorRect: PopoverRect;
  popoverHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  maxWidth: number;
  minWidth?: number;
  rightInset?: number;
  offset?: number;
  margin?: number;
}

export interface PopoverPositionResult {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  flipUp: boolean;
}

const OUTSIDE_CLICK_ALLOWED_ANT_SELECTORS = [
  ".ant-select-dropdown",
  ".ant-message",
  ".ant-notification",
  ".ant-modal-root",
  ".ant-tooltip",
  ".ant-popover",
] as const;

/** 基于实际视口空间与锚点位置计算浮层坐标，防止溢出或被滚动容器裁切。 */
export function computeLedgerPopoverPosition({
  anchorRect,
  popoverHeight,
  viewportWidth,
  viewportHeight,
  maxWidth,
  minWidth = 280,
  rightInset = 0,
  offset = 6,
  margin = 12,
}: PopoverPositionInput): PopoverPositionResult {
  const safeViewportWidth = Math.max(240, viewportWidth);
  const safeViewportHeight = Math.max(220, viewportHeight);
  const availableWidth = Math.max(220, safeViewportWidth - margin * 2);
  const width = Math.min(maxWidth, Math.max(Math.min(minWidth, availableWidth), availableWidth));

  const preferredLeft = anchorRect.right - rightInset - width;
  const maxLeft = Math.max(margin, safeViewportWidth - width - margin);
  const left = Math.max(margin, Math.min(preferredLeft, maxLeft));

  const maxHeight = Math.max(160, safeViewportHeight - margin * 2);
  const effectiveHeight = Math.min(Math.max(popoverHeight, 160), maxHeight);

  const spaceBelow = safeViewportHeight - anchorRect.bottom - offset - margin;
  const spaceAbove = anchorRect.top - offset - margin;
  const flipUp = spaceBelow < effectiveHeight && spaceAbove > spaceBelow;

  const rawTop = flipUp
    ? anchorRect.top - offset - effectiveHeight
    : anchorRect.bottom + offset;
  const maxTop = Math.max(margin, safeViewportHeight - effectiveHeight - margin);
  const top = Math.max(margin, Math.min(rawTop, maxTop));

  return {
    top: Math.round(top),
    left: Math.round(left),
    width: Math.round(width),
    maxHeight: Math.round(maxHeight),
    flipUp,
  };
}

export interface ClosestTarget {
  closest: (selector: string) => unknown;
}

/** 判断指针点击是否发生在浮层、触发器或 AntD 弹出层（Select/Modal/Tooltip/Popover）内部。 */
export function shouldIgnoreLedgerPopoverPointerDown(
  target: ClosestTarget,
  popoverSelector: string,
  triggerSelector: string,
): boolean {
  if (target.closest(popoverSelector) || target.closest(triggerSelector)) {
    return true;
  }
  return OUTSIDE_CLICK_ALLOWED_ANT_SELECTORS.some((selector) => Boolean(target.closest(selector)));
}

/** 检测当前是否存在打开的 AntD 下拉、模态框或二级浮层，避免按 Escape 时连带关闭底层编辑浮层。 */
export function hasBlockingAntdOverlay(
  doc: Pick<Document, "querySelector" | "querySelectorAll">,
  popoverEl: Pick<Element, "querySelector"> | null,
): boolean {
  if (popoverEl?.querySelector(".ant-select-open")) {
    return true;
  }
  const activeSelect = doc.querySelector(".ant-select-dropdown:not(.ant-select-dropdown-hidden)");
  if (activeSelect) {
    return true;
  }
  const modalWraps = doc.querySelectorAll(".ant-modal-wrap");
  for (const wrap of modalWraps) {
    const inlineDisplay = (wrap as HTMLElement).style?.display;
    if (inlineDisplay !== "none") {
      return true;
    }
  }
  const activePopover = doc.querySelector(
    ".ant-popover:not(.ant-popover-hidden), .ant-tooltip:not(.ant-tooltip-hidden)",
  );
  return Boolean(activePopover);
}

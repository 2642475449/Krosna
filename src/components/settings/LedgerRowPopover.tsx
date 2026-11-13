import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  computeLedgerPopoverPosition,
  hasBlockingAntdOverlay,
  shouldIgnoreLedgerPopoverPointerDown,
} from "@/lib/ledgerPopover";

interface LedgerRowPopoverProps {
  open: boolean;
  id: string;
  ariaLabel: string;
  className: string;
  popoverSelector: string;
  triggerSelector: string;
  getAnchorEl: () => HTMLElement | null;
  getRestoreFocusEl: () => HTMLElement | null;
  maxWidth: number;
  rightInset?: number;
  offset?: number;
  blocked?: boolean;
  scrollKey?: string | null;
  onClose: () => void;
  children: ReactNode;
}

/** 渲染至 document.body 的账本行浮层，统一处理视口避让、遮罩冲突、Escape 与焦点迁移/恢复。 */
export function LedgerRowPopover({
  open,
  id,
  ariaLabel,
  className,
  popoverSelector,
  triggerSelector,
  getAnchorEl,
  getRestoreFocusEl,
  maxWidth,
  rightInset = 0,
  offset = 6,
  blocked = false,
  scrollKey = null,
  onClose,
  children,
}: LedgerRowPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);
  const shouldRestoreFocusRef = useRef(true);
  const restoreTargetRef = useRef<HTMLElement | null>(null);
  const getRestoreFocusElRef = useRef(getRestoreFocusEl);
  const onCloseRef = useRef(onClose);
  getRestoreFocusElRef.current = getRestoreFocusEl;
  onCloseRef.current = onClose;

  const getAnchorElRef = useRef(getAnchorEl);
  getAnchorElRef.current = getAnchorEl;

  useLayoutEffect(() => {
    if (!open || !popoverRef.current) return;
    const anchorEl = getAnchorElRef.current();
    if (!anchorEl) return;

    if (scrollKey) {
      const rect = anchorEl.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight) {
        anchorEl.scrollIntoView({ block: "nearest" });
      }
    }

    const updatePosition = () => {
      const el = popoverRef.current;
      const currentAnchor = getAnchorElRef.current();
      if (!el || !currentAnchor || !currentAnchor.isConnected) return;
      const anchorRect = currentAnchor.getBoundingClientRect();
      const pos = computeLedgerPopoverPosition({
        anchorRect,
        popoverHeight: el.offsetHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        maxWidth,
        rightInset,
        offset,
      });
      el.style.top = `${pos.top}px`;
      el.style.left = `${pos.left}px`;
      el.style.width = `${pos.width}px`;
      el.style.maxHeight = `${pos.maxHeight}px`;
      el.classList.toggle("is-flip-up", pos.flipUp);
    };

    updatePosition();

    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => updatePosition())
      : null;
    resizeObserver?.observe(popoverRef.current);

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, { capture: true, passive: true });
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, { capture: true });
    };
  }, [id, maxWidth, offset, open, rightInset, scrollKey]);

  useEffect(() => {
    if (open) {
      shouldRestoreFocusRef.current = true;
      wasOpenRef.current = true;
      restoreTargetRef.current = getRestoreFocusElRef.current();
      const frame = requestAnimationFrame(() => {
        const el = popoverRef.current;
        if (!el) return;
        const active = document.activeElement;
        if (!active || !el.contains(active)) {
          el.focus({ preventScroll: true });
        }
      });
      return () => cancelAnimationFrame(frame);
    }

    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      const target = restoreTargetRef.current;
      restoreTargetRef.current = null;
      if (shouldRestoreFocusRef.current && target?.isConnected) {
        requestAnimationFrame(() => {
          if (target.isConnected) target.focus({ preventScroll: true });
        });
      }
    }
  }, [id, open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (blocked || hasBlockingAntdOverlay(document, popoverRef.current)) return;
      event.stopPropagation();
      shouldRestoreFocusRef.current = true;
      onCloseRef.current();
    };

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (shouldIgnoreLedgerPopoverPointerDown(target, popoverSelector, triggerSelector)) return;
      shouldRestoreFocusRef.current = false;
      onCloseRef.current();
    };

    // 使用 capture 阶段先检测仍在展示中的 AntD 下拉/Modal，避免先被子组件吞掉后再误关浮层。
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [blocked, open, popoverSelector, triggerSelector]);

  if (!open) return null;

  return createPortal(
    <div
      ref={popoverRef}
      id={id}
      className={className}
      role="dialog"
      aria-modal="false"
      aria-label={ariaLabel}
      tabIndex={-1}
    >
      {children}
    </div>,
    document.body,
  );
}

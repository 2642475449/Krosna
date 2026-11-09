export interface TerminalGridSize {
  rows: number;
  cols: number;
}

export const TERMINAL_DRAG_RESIZE_DELAY_MS = 120;

/** Coalesce grid/PTY updates while a divider moves; fit the final size on release. */
export function createTerminalLayoutScheduler(refresh: () => void, doc: Document = document) {
  const view = doc.defaultView!;
  let dragPointerId: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let frame: number | null = null;

  const cancelPending = () => {
    if (timer !== null) clearTimeout(timer);
    if (frame !== null) view.cancelAnimationFrame(frame);
    timer = null;
    frame = null;
  };
  const scheduleFrame = () => {
    if (frame !== null) return;
    frame = view.requestAnimationFrame(() => {
      frame = null;
      refresh();
    });
  };
  const schedule = () => {
    if (dragPointerId === null) {
      scheduleFrame();
      return;
    }
    cancelPending();
    timer = setTimeout(() => {
      timer = null;
      scheduleFrame();
    }, TERMINAL_DRAG_RESIZE_DELAY_MS);
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof view.Element) || !target.closest('[role="separator"][aria-orientation]')) return;
    dragPointerId = event.pointerId;
    // A refresh queued before the drag must obey the same settling delay.
    if (frame !== null || timer !== null) schedule();
  };
  const endDrag = () => {
    if (dragPointerId === null) return;
    dragPointerId = null;
    cancelPending();
    // Wait one frame so the divider's final React update has reached the DOM.
    scheduleFrame();
  };
  const onPointerEnd = (event: PointerEvent) => {
    if (event.pointerId === dragPointerId) endDrag();
  };
  // Capture sees the divider even when its own handler stops propagation.
  doc.addEventListener("pointerdown", onPointerDown, true);
  doc.addEventListener("pointerup", onPointerEnd, true);
  doc.addEventListener("pointercancel", onPointerEnd, true);
  view.addEventListener("blur", endDrag);

  return {
    schedule,
    dispose() {
      cancelPending();
      doc.removeEventListener("pointerdown", onPointerDown, true);
      doc.removeEventListener("pointerup", onPointerEnd, true);
      doc.removeEventListener("pointercancel", onPointerEnd, true);
      view.removeEventListener("blur", endDrag);
    },
  };
}

/**
 * Prevents repeated SIGWINCH notifications when a layout refresh does not
 * actually change the terminal grid. Full-screen TUIs may redraw their entire
 * normal-screen buffer after every resize, polluting xterm scrollback.
 */
export function createPtyResizeGate(
  resize: (rows: number, cols: number) => void,
): (rows: number, cols: number) => boolean {
  let lastSize: TerminalGridSize | null = null;

  return (rows, cols) => {
    if (lastSize?.rows === rows && lastSize.cols === cols) {
      return false;
    }

    lastSize = { rows, cols };
    resize(rows, cols);
    return true;
  };
}

import type { Terminal } from "@xterm/xterm";

const TERMINAL_SCROLLBAR_HIDE_DELAY_MS = 700;

/**
 * Syncs xterm scrollback availability and wheel-reveal state onto the host
 * element so the 6px overlay scrollbar stays hidden and pointer-transparent
 * when there is no scrollable history (empty terminal or alternate buffer).
 */
export function attachTerminalScrollbar(container: HTMLElement, term: Terminal): () => void {
  let scrollbarNeeded: boolean | null = null;
  let hideTimer: number | null = null;

  const syncScrollbarNeeded = () => {
    const needed = term.buffer.active.baseY > 0;
    if (scrollbarNeeded === needed) return;
    scrollbarNeeded = needed;
    if (needed) {
      container.dataset.scrollbarNeeded = "true";
    } else {
      delete container.dataset.scrollbarNeeded;
      delete container.dataset.scrollbarActive;
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }
    }
  };

  const revealScrollbar = () => {
    if (container.dataset.scrollbarNeeded !== "true") return;
    container.dataset.scrollbarActive = "true";
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
    }
    hideTimer = window.setTimeout(() => {
      delete container.dataset.scrollbarActive;
      hideTimer = null;
    }, TERMINAL_SCROLLBAR_HIDE_DELAY_MS);
  };

  syncScrollbarNeeded();
  const writeDisposable = term.onWriteParsed(syncScrollbarNeeded);
  const resizeDisposable = term.onResize(syncScrollbarNeeded);
  const bufferDisposable = term.buffer.onBufferChange(syncScrollbarNeeded);
  const scrollDisposable = term.onScroll(syncScrollbarNeeded);
  container.addEventListener("wheel", revealScrollbar, { passive: true, capture: true });

  return () => {
    container.removeEventListener("wheel", revealScrollbar, true);
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
    writeDisposable.dispose();
    resizeDisposable.dispose();
    bufferDisposable.dispose();
    scrollDisposable.dispose();
    delete container.dataset.scrollbarNeeded;
    delete container.dataset.scrollbarActive;
  };
}

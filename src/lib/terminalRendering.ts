interface TerminalRenderingResource {
  attachWebgl: () => boolean;
  disposeWebgl: () => void;
  setCursorBlink: (enabled: boolean) => void;
  cursorBlink: boolean;
  blur: () => void;
  refresh: () => void;
  repaint?: () => void;
}

/** Reveal after layout settles; refocus alone must preserve the shared glyph atlas. */
export function createTerminalRevealRepaint(options: {
  isVisible: () => boolean;
  repaint: () => void;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (frame: number) => void;
}) {
  let frame: number | null = null;
  const cancel = () => {
    if (frame !== null) options.cancelFrame(frame);
    frame = null;
  };
  return {
    schedule() {
      cancel();
      frame = options.requestFrame(() => {
        frame = options.requestFrame(() => {
          frame = null;
          if (options.isVisible()) options.repaint();
        });
      });
    },
    dispose: cancel,
  };
}

// 只保存渲染资源句柄；会话与标签业务状态仍由 store 管理。
export function createTerminalRenderingPool(maxHiddenContexts = 1) {
  const hidden = new Set<() => void>();

  function retain(release: () => void) {
    hidden.delete(release);
    hidden.add(release);
    while (hidden.size > maxHiddenContexts) {
      const oldest = hidden.values().next().value;
      if (!oldest) break;
      hidden.delete(oldest);
      oldest();
    }
  }

  return {
    register(resource: TerminalRenderingResource) {
      let visible: boolean | null = null;
      let attached = false;
      let disposed = false;
      const release = () => {
        hidden.delete(release);
        if (!attached) return;
        attached = false;
        resource.disposeWebgl();
      };

      return {
        setVisible(next: boolean) {
          if (disposed || visible === next) return;
          const revealed = visible === false;
          const retained = attached;
          visible = next;
          hidden.delete(release);
          resource.setCursorBlink(next && resource.cursorBlink);
          if (next) {
            if (!attached) attached = resource.attachWebgl();
            resource.refresh();
            if (revealed && retained) resource.repaint?.();
          } else {
            resource.blur();
            if (attached) retain(release);
          }
        },
        contextLost() {
          release();
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          release();
        },
      };
    },
  };
}

export const terminalRenderingPool = createTerminalRenderingPool();

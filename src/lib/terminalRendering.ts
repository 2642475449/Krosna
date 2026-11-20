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

const HIDDEN_WEBGL_RETENTION_MS = 30_000;

// 短时间切换标签时复用 WebGL。长时间隐藏的终端释放图形资源，保留终端实例与回滚缓冲。
export function createTerminalRenderingPool(maxHiddenContexts = 1) {
  const hidden = new Map<() => void, ReturnType<typeof setTimeout>>();

  function forget(release: () => void) {
    clearTimeout(hidden.get(release));
    hidden.delete(release);
  }

  function retain(release: () => void) {
    hidden.set(release, setTimeout(release, HIDDEN_WEBGL_RETENTION_MS));
    while (hidden.size > maxHiddenContexts) {
      const oldest = hidden.keys().next().value;
      if (!oldest) break;
      oldest();
    }
  }

  return {
    register(resource: TerminalRenderingResource) {
      let visible: boolean | null = null;
      let attached = false;
      let disposed = false;
      const release = () => {
        forget(release);
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
          forget(release);
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

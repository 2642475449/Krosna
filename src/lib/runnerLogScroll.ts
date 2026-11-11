import type { IMarker, Terminal } from "@xterm/xterm";

/** 用 xterm marker 跟踪历史裁剪，输出解析期间的程序滚动不改变用户的跟随意图。 */
export function createRunnerLogScroll(
  terminal: Pick<Terminal, "registerMarker" | "scrollToLine" | "scrollToBottom"> & {
    buffer: { active: Pick<Terminal["buffer"]["active"], "viewportY" | "baseY" | "cursorY"> };
  },
  options: { following: boolean; onFollowingChange: (following: boolean) => void; isVisible: () => boolean },
) {
  let following = options.following;
  let writes = 0;
  let programmatic = false;
  let disposed = false;
  let anchor: IMarker | undefined;
  const capture = () => {
    anchor?.dispose();
    const buffer = terminal.buffer.active;
    anchor = terminal.registerMarker(buffer.viewportY - buffer.baseY - buffer.cursorY);
  };
  const setFollowing = (next: boolean) => {
    if (disposed) return;
    const changed = following !== next;
    following = next;
    if (following) { anchor?.dispose(); anchor = undefined; }
    else capture();
    if (changed) options.onFollowingChange(next);
  };
  const restore = () => {
    programmatic = true;
    try {
      if (following) terminal.scrollToBottom();
      else terminal.scrollToLine(anchor && !anchor.isDisposed ? anchor.line : 0);
    } finally { programmatic = false; }
  };
  const userScrolled = () => {
    if (disposed || programmatic || !options.isVisible()) return;
    const buffer = terminal.buffer.active;
    setFollowing(buffer.viewportY >= buffer.baseY);
  };
  return {
    setFollowing(next: boolean) {
      setFollowing(next);
      if (next && !disposed) restore();
    },
    pause() { setFollowing(false); },
    onScroll() { if (!writes) userScrolled(); },
    userScrolled,
    beforeWrite() {
      if (!following && !anchor) capture();
      writes++;
      let completed = false;
      return () => {
        if (completed || disposed) return;
        completed = true;
        writes--;
        restore();
      };
    },
    dispose() { disposed = true; anchor?.dispose(); },
  };
}

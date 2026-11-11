import { expect, it, vi } from "vitest";
import { createRunnerLogScroll } from "./runnerLogScroll";

function setup(following = true) {
  const buffer = { viewportY: 100, baseY: 100, cursorY: 9 };
  const markers: Array<{ line: number; isDisposed: boolean; id: number; dispose: () => void; onDispose: ReturnType<typeof vi.fn> }> = [];
  const terminal = {
    buffer: { active: buffer },
    registerMarker: (offset: number) => {
      const marker = { line: buffer.baseY + buffer.cursorY + offset, isDisposed: false, id: markers.length,
        dispose: () => { marker.isDisposed = true; }, onDispose: vi.fn() };
      markers.push(marker);
      return marker;
    },
    scrollToLine: vi.fn((row: number) => { buffer.viewportY = row; }),
    scrollToBottom: vi.fn(() => { buffer.viewportY = buffer.baseY; }),
  };
  const options = { following, onFollowingChange: vi.fn(), isVisible: () => true };
  const scroll = createRunnerLogScroll(terminal, options);
  return { buffer, markers, terminal, options, scroll };
}

it("pauses on upward scrolling and resumes when the user reaches the bottom", () => {
  const test = setup();
  test.buffer.viewportY = 40;
  test.scroll.onScroll();
  expect(test.options.onFollowingChange).toHaveBeenLastCalledWith(false);
  test.buffer.viewportY = 100;
  test.scroll.onScroll();
  expect(test.options.onFollowingChange).toHaveBeenLastCalledWith(true);
  test.scroll.dispose();
});

it("does not treat newly parsed output as a manual scroll", () => {
  const test = setup();
  const parsed = test.scroll.beforeWrite();
  test.buffer.baseY = 110;
  test.scroll.onScroll();
  expect(test.options.onFollowingChange).not.toHaveBeenCalled();
  parsed();
  expect(test.buffer.viewportY).toBe(110);
  test.scroll.dispose();
});

it("preserves the latest user position during queued output and scrollback trimming", () => {
  const test = setup();
  const first = test.scroll.beforeWrite();
  const second = test.scroll.beforeWrite();
  test.buffer.viewportY = 50;
  test.scroll.userScrolled();
  test.markers.at(-1)!.line = 45;
  first(); second();
  expect(test.terminal.scrollToLine).toHaveBeenLastCalledWith(45);
  expect(test.terminal.scrollToBottom).not.toHaveBeenCalled();
  test.scroll.dispose();
});

it("pauses at the bottom without losing the anchor on the next output", () => {
  const test = setup();
  test.scroll.pause();
  const parsed = test.scroll.beforeWrite();
  test.buffer.baseY = 110;
  test.buffer.viewportY = 110;
  test.scroll.onScroll();
  parsed();
  expect(test.buffer.viewportY).toBe(100);
  expect(test.options.onFollowingChange).toHaveBeenCalledExactlyOnceWith(false);
  test.scroll.setFollowing(true);
  expect(test.buffer.viewportY).toBe(110);
  test.scroll.dispose();
});

it("ignores hidden terminal scrolling and safely retires pending callbacks", () => {
  const test = setup();
  test.options.isVisible = () => false;
  test.buffer.viewportY = 0;
  test.scroll.userScrolled();
  expect(test.options.onFollowingChange).not.toHaveBeenCalled();
  const parsed = test.scroll.beforeWrite();
  test.scroll.dispose(); parsed(); parsed();
  expect(test.terminal.scrollToBottom).not.toHaveBeenCalled();
});

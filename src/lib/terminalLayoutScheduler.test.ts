// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTerminalLayoutScheduler } from "./terminalResize";

describe("terminal layout during divider dragging", () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let scheduler: ReturnType<typeof createTerminalLayoutScheduler>;
  let refresh: ReturnType<typeof vi.fn<() => number | void>>;
  let divider: HTMLDivElement;

  const paint = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(0));
  };
  const pointer = (type: string, target: EventTarget = divider, pointerId = 1) => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId }));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    frames = new Map();
    nextFrame = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
    divider = document.createElement("div");
    divider.setAttribute("role", "separator");
    divider.setAttribute("aria-orientation", "vertical");
    document.body.append(divider);
    refresh = vi.fn();
    scheduler = createTerminalLayoutScheduler(refresh);
  });

  afterEach(() => {
    scheduler.dispose();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("fits once per frame without delaying ordinary layout changes", () => {
    scheduler.schedule();
    scheduler.schedule();
    paint();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the grid stable through continuous movement and fits after 120ms of rest", () => {
    pointer("pointerdown");
    for (let i = 0; i < 10; i++) {
      scheduler.schedule();
      vi.advanceTimersByTime(30);
      paint();
    }
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(89);
    paint();
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    paint();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("measures the final layout on release and cancels the delayed fit", () => {
    let width = 800;
    refresh.mockImplementation(() => width);
    pointer("pointerdown");
    scheduler.schedule();
    pointer("pointerup", document.body);
    // The divider can commit its final size after the capture listener runs.
    width = 600;
    scheduler.schedule();
    expect(refresh).not.toHaveBeenCalled();
    paint();
    expect(refresh).toHaveReturnedWith(600);
    vi.advanceTimersByTime(200);
    paint();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each(["pointercancel", "blur"])("restores immediate fitting after %s", (type) => {
    pointer("pointerdown");
    scheduler.schedule();
    if (type === "blur") window.dispatchEvent(new Event("blur"));
    else pointer(type, document.body);
    paint();
    scheduler.schedule();
    paint();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not treat terminal text selection as divider dragging", () => {
    pointer("pointerdown", document.body);
    scheduler.schedule();
    paint();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("ignores release from another pointer", () => {
    pointer("pointerdown");
    scheduler.schedule();
    pointer("pointerup", document.body, 2);
    paint();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("delays a refresh already queued when dragging begins", () => {
    scheduler.schedule();
    pointer("pointerdown");
    paint();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("cleans up pending work and document listeners when unmounted", () => {
    pointer("pointerdown");
    scheduler.schedule();
    scheduler.dispose();
    pointer("pointerup", document.body);
    vi.advanceTimersByTime(200);
    paint();
    expect(refresh).not.toHaveBeenCalled();
  });
});

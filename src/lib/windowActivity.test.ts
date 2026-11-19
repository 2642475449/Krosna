import { afterEach, expect, it, vi } from "vitest";
import { observeWindowActivity } from "./windowActivity";

afterEach(() => vi.unstubAllGlobals());

it("coalesces focus and visibility changes and stops notifying after cleanup", () => {
  let focused = false;
  const page = Object.assign(new EventTarget(), { visibilityState: "visible", hasFocus: () => focused });
  const view = new EventTarget();
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", view);
  const activity = vi.fn();
  const stop = observeWindowActivity(activity);
  focused = true;
  view.dispatchEvent(new Event("focus"));
  page.dispatchEvent(new Event("visibilitychange"));
  page.visibilityState = "hidden";
  page.dispatchEvent(new Event("visibilitychange"));
  view.dispatchEvent(new Event("focus"));
  focused = false;
  view.dispatchEvent(new Event("blur"));
  page.visibilityState = "visible";
  page.dispatchEvent(new Event("visibilitychange"));
  focused = true;
  page.dispatchEvent(new Event("visibilitychange"));
  view.dispatchEvent(new Event("focus"));
  stop();
  view.dispatchEvent(new Event("blur"));
  page.visibilityState = "hidden";
  page.dispatchEvent(new Event("visibilitychange"));

  expect(activity.mock.calls).toEqual([[false], [true], [false], [true]]);
});

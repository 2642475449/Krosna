// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useAppStore } from "@/store";
import * as pet from "@/lib/pixelPet";
import * as activity from "@/lib/windowActivity";
import { collectPetPlatforms, PixelPetTrack } from "./PixelPetTrack";

function surface(name: string, rect: { left?: number; top: number; width: number; height: number }) {
  const element = document.createElement("div");
  element.dataset.petSurface = name;
  element.getBoundingClientRect = () => new DOMRect(rect.left ?? 0, rect.top, rect.width, rect.height);
  document.body.append(element);
  return element;
}

afterEach(() => document.body.replaceChildren());

it("grounds the titlebar pet on the visible workspace edge after layout padding", () => {
  surface("titlebar-blank", { left: 500, top: 6, width: 400, height: 34 });
  surface("statusbar", { top: 772, width: 1200, height: 28 });
  const workspace = surface("workspace", { top: 40, width: 1000, height: 732 });
  workspace.style.paddingTop = "6px";

  expect(collectPetPlatforms(1200, 800, 40)).toEqual([
    { id: "statusbar", minX: 10, maxX: 1190, groundY: 772 },
    { id: "titlebar-blank", minX: 508, maxX: 892, groundY: 46 },
  ]);

  // A theme/layout change must move the ground without a fixed pixel offset.
  workspace.style.paddingTop = "10px";
  expect(collectPetPlatforms(1200, 800, 48)[1]?.groundY).toBe(50);
});

it("shows a single pet when two open project windows exchange focus and one closes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // 两个挂载点模拟独立 WebView，各自收到所属窗口的激活通知。
  const windows = new Set<(active: boolean) => void>();
  vi.spyOn(activity, "observeWindowActivity").mockImplementation((onActivity) => {
    windows.add(onActivity);
    onActivity(windows.size === 1);
    return () => { windows.delete(onActivity); };
  });
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    setTransform() {},
  } as unknown as CanvasRenderingContext2D);
  const hosts = [document.createElement("div"), document.createElement("div")];
  document.body.append(...hosts);
  const roots = hosts.map((host) => createRoot(host));
  const wasVisible = useAppStore.getState().pixelPetVisible;
  const expectPetIn = (...expectedHosts: HTMLDivElement[]) => {
    for (const selector of ["canvas", "button"]) {
      expect(hosts.filter((host) => {
        const element = host.querySelector(selector);
        return element && !element.closest("[hidden]");
      })).toEqual(expectedHosts);
    }
  };
  try {
    useAppStore.setState({ pixelPetVisible: true });
    for (const root of roots) await act(async () => root.render(createElement(PixelPetTrack)));
    expectPetIn(hosts[0]);
    const [firstWindow, secondWindow] = windows;
    firstWindow(false);
    expectPetIn();
    secondWindow(true);
    expectPetIn(hosts[1]);
    // 不等待下一帧，快速切回 A，然后再次切往 B 并关闭正在活动的 B。
    secondWindow(false);
    firstWindow(true);
    expectPetIn(hosts[0]);
    firstWindow(false);
    secondWindow(true);
    expectPetIn(hosts[1]);
    await act(async () => roots[1].render(null));
    expect(windows.size).toBe(1);
    expectPetIn();
    firstWindow(true);
    expectPetIn(hosts[0]);
  } finally {
    for (const root of roots) await act(async () => root.unmount());
    expect(windows.size).toBe(0);
    useAppStore.setState({ pixelPetVisible: wasVisible });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("falls back to the titlebar edge when the workspace surface is unavailable", () => {
  surface("titlebar-blank", { left: 500, top: 6, width: 400, height: 34 });
  expect(collectPetPlatforms(1200, 800, 40)[0]).toEqual({
    id: "titlebar-blank", minX: 508, maxX: 892, groundY: 40,
  });
  expect(collectPetPlatforms(1200, 800, 48).map((platform) => platform.id)).toEqual(["statusbar"]);
});

it("stops background frames and measurements, then resumes the existing pet without advancing its clock", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const frames = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((draw) => {
    frames.set(++nextId, draw);
    return nextId;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
  const drawFrame = (now: number) => {
    expect(frames.size).toBe(1);
    const [id, draw] = [...frames][0];
    frames.delete(id);
    draw(now);
  };
  const focused = vi.spyOn(document, "hasFocus").mockReturnValue(false);
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const measure = vi.spyOn(surface("statusbar", { top: 700, width: 900, height: 28 }), "getBoundingClientRect");
  const clearRect = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect, setTransform() {}, save() {}, restore() {}, fillRect() {}, translate() {}, scale() {},
    measureText: () => ({ width: 18 }), fillText() {}, strokeRect() {},
  } as unknown as CanvasRenderingContext2D);
  const step = vi.spyOn(pet, "stepPetSimulation");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const wasVisible = useAppStore.getState().pixelPetVisible;
  try {
    useAppStore.setState({ pixelPetVisible: true });
    await act(async () => root.render(createElement(PixelPetTrack)));
    const canvas = host.querySelector("canvas")!;
    const button = host.querySelector("button")!;
    const hiddenLayer = canvas.closest("[hidden]");
    expect(hiddenLayer).not.toBeNull();
    expect(hiddenLayer!.contains(button)).toBe(true);
    expect(frames.size).toBe(0);
    expect(measure).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("focus"));
    expect(measure).toHaveBeenCalledTimes(1);
    const now = performance.now();
    drawFrame(now);
    expect(canvas.closest("[hidden]")).toBeNull();
    expect(button.closest("[hidden]")).toBeNull();
    drawFrame(now + 16);
    expect(clearRect).not.toHaveBeenCalled();

    // 暂停动作产生气泡，下一次动作应擦除精灵与气泡各自占用的区域。
    button.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    drawFrame(now + 32);
    clearRect.mockClear();
    button.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    drawFrame(now + 48);
    expect(clearRect).toHaveBeenCalledTimes(2);
    for (const [, , width, height] of clearRect.mock.calls) {
      expect(width).toBeLessThan(200);
      expect(height).toBeLessThan(200);
    }

    const beforeBlur = step.mock.results.at(-1)?.value;
    window.dispatchEvent(new Event("blur"));
    expect(canvas.closest("[hidden]")).toBe(hiddenLayer);
    expect(button.closest("[hidden]")).toBe(hiddenLayer);
    window.dispatchEvent(new Event("resize"));
    expect(frames.size).toBe(0);
    expect(measure).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("focus"));
    expect(measure).toHaveBeenCalledTimes(2);
    drawFrame(now + 10000);
    expect(canvas.closest("[hidden]")).toBeNull();
    expect(button.closest("[hidden]")).toBeNull();
    expect(step.mock.calls.at(-1)?.[0]).toBe(beforeBlur);
    expect(step.mock.calls.at(-1)?.[1]).toBe(0);
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(canvas.closest("[hidden]")).toBe(hiddenLayer);
    expect(button.closest("[hidden]")).toBe(hiddenLayer);
    window.dispatchEvent(new Event("focus"));
    expect(frames.size).toBe(0);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(button.closest("[hidden]")).toBe(hiddenLayer);
    expect(frames.size).toBe(0);
    focused.mockReturnValue(true);
    window.dispatchEvent(new Event("focus"));
    expect(button.closest("[hidden]")).toBeNull();
    expect(frames.size).toBe(1);
    window.dispatchEvent(new Event("blur"));
    focused.mockReturnValue(false);
    await act(async () => useAppStore.setState({ pixelPetVisible: false }));
    expect(host.childElementCount).toBe(0);
    await act(async () => useAppStore.setState({ pixelPetVisible: true }));
    const newLayer = host.querySelector("canvas")!.closest("[hidden]");
    expect(newLayer).not.toBeNull();
    expect(newLayer!.contains(host.querySelector("button"))).toBe(true);
    expect(frames.size).toBe(0);
    focused.mockReturnValue(true);
    window.dispatchEvent(new Event("focus"));
    expect(host.querySelector("button")!.closest("[hidden]")).toBeNull();
    expect(frames.size).toBe(1);
  } finally {
    await act(async () => root.unmount());
    window.dispatchEvent(new Event("focus"));
    expect(frames.size).toBe(0);
    useAppStore.setState({ pixelPetVisible: wasVisible });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

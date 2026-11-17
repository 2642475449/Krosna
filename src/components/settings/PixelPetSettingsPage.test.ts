// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "@/store";
import i18n from "@/i18n";
import { usePixelPetFileSync } from "@/hooks/usePixelPetFileSync";
import { PixelPetSettingsPage } from "./PixelPetSettingsPage";
import { PIXEL_PET_PRESETS, type PixelPetConfig } from "@/lib/pixelPetConfig";
import * as sprites from "@/lib/pixelPetSprites";

const mocks = vi.hoisted(() => ({
  read: vi.fn(), write: vi.fn(), choose: vi.fn(), save: vi.fn(), export: vi.fn(), guide: vi.fn(),
  success: vi.fn(), error: vi.fn(), clipboard: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  readProjectFile: mocks.read, writeProjectFile: mocks.write,
  selectPixelPetJsonFile: mocks.choose, selectPixelPetExportPath: mocks.save,
}));
vi.mock("@/lib/pixelPetFileIO", () => ({ exportPixelPetFile: mocks.export, ensurePixelPetFileGuide: mocks.guide }));
vi.mock("antd", () => ({
  Button: ({ children, onClick, disabled, loading }: { children?: ReactNode; onClick?: () => void; disabled?: boolean; loading?: boolean }) => createElement("button", { onClick, disabled: disabled || loading }, children),
  Alert: ({ message, description, action }: { message: ReactNode; description?: ReactNode; action?: ReactNode }) => createElement("div", { role: "alert" }, message, description, action),
  Input: { TextArea: ({ value, onChange, disabled }: { value: string; onChange: (event: unknown) => void; disabled?: boolean }) => createElement("textarea", { value, disabled, onInput: onChange }) },
  Radio: { Group: ({ children }: { children: ReactNode }) => createElement("div", null, children), Button: ({ children }: { children: ReactNode }) => createElement("span", null, children) },
  Switch: () => null,
  message: { success: mocks.success, error: mocks.error },
}));

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
const snapshot = (name: string) => ({ content: JSON.stringify({ id: "custom", name, palette: { K: "#112233" }, frames: { idle: [["KK", "KK"]] } }), encoding: "utf-8" });
function Content({ showSettings = true }: { showSettings?: boolean }) { usePixelPetFileSync(true); return showSettings ? createElement(PixelPetSettingsPage) : null; }
const click = async (label: string) => act(async () => {
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  expect(button, label).toBeTruthy();
  button!.click();
});

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.clipboard } });
  useAppStore.setState(useAppStore.getInitialState(), true);
  await i18n.changeLanguage("zh-CN");
  mocks.choose.mockResolvedValue(null);
  mocks.save.mockResolvedValue(null);
  mocks.read.mockResolvedValue(snapshot("loaded"));
  mocks.export.mockImplementation(async (_path: string, content: string) => ({ content, encoding: "utf-8" }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(Content)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useAppStore.setState(useAppStore.getInitialState(), true);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("exports and links before copying a short file-based AI prompt", async () => {
  mocks.save.mockResolvedValue("D:/角色/hero.json");
  await click("复制 AI 创作提示词");
  expect(mocks.export).toHaveBeenCalledWith("D:/角色/hero.json", expect.any(String));
  expect(useAppStore.getState().pixelPetFilePath).toBe("D:/角色/hero.json");
  expect(mocks.clipboard).toHaveBeenCalledWith(expect.stringContaining("hero.json.guide.md"));
  expect(mocks.clipboard.mock.calls[0][0].length).toBeLessThan(1000);
});

it("canceling first export leaves the character and clipboard unchanged", async () => {
  const config = useAppStore.getState().pixelPetConfig;
  await click("复制 AI 创作提示词");
  expect(useAppStore.getState().pixelPetFilePath).toBeNull();
  expect(useAppStore.getState().pixelPetConfig).toBe(config);
  expect(mocks.export).not.toHaveBeenCalled();
  expect(mocks.clipboard).not.toHaveBeenCalled();
});

it("loads a file, refreshes the preview while preserving a draft, and checks the draft's original file snapshot on save", async () => {
  vi.useFakeTimers();
  mocks.choose.mockResolvedValue("D:/角色/pet.json");
  await click("加载角色文件");
  expect(useAppStore.getState().pixelPetConfig.name).toBe("loaded");
  const original = snapshot("loaded");
  const textarea = host.querySelector("textarea")!;
  const draft = snapshot("my draft").content;
  await act(async () => {
    textarea.value = draft;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  mocks.read.mockResolvedValue(snapshot("AI changed"));
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(useAppStore.getState().pixelPetConfig.name).toBe("AI changed");
  expect(textarea.value).toBe(draft);
  expect(host.textContent).toContain("你的 JSON 草稿已保留");
  mocks.write.mockRejectedValueOnce(new Error("file-write-conflict"));
  await click("保存文件并应用");
  expect(mocks.write).toHaveBeenLastCalledWith("D:/角色/", "D:/角色/pet.json", draft, "utf-8", original);
  expect(useAppStore.getState().pixelPetConfig.name).toBe("AI changed");
  expect(textarea.value).toBe(draft);
  expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("file-write-conflict"));
});

it("keeps a valid preview on malformed external saves, then recovers and stops after unlinking", async () => {
  vi.useFakeTimers();
  mocks.choose.mockResolvedValue("D:/角色/pet.json");
  await click("加载角色文件");
  mocks.read.mockResolvedValue({ content: "{", encoding: "utf-8" });
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(useAppStore.getState().pixelPetConfig.name).toBe("loaded");
  expect(host.textContent).toContain("已保留上一次正常角色");
  mocks.read.mockResolvedValue(snapshot("fixed"));
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(useAppStore.getState().pixelPetConfig.name).toBe("fixed");
  expect(useAppStore.getState().pixelPetFileError).toBeNull();
  await click("解除文件关联");
  const count = mocks.read.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(mocks.read).toHaveBeenCalledTimes(count);
  expect(useAppStore.getState().pixelPetConfig.name).toBe("fixed");
});

it("rejects an invalid imported file without switching the current character", async () => {
  const config = useAppStore.getState().pixelPetConfig;
  mocks.choose.mockResolvedValue("D:/bad.json");
  mocks.read.mockResolvedValue({ content: "{}", encoding: "utf-8" });
  await click("加载角色文件");
  expect(useAppStore.getState().pixelPetFilePath).toBeNull();
  expect(useAppStore.getState().pixelPetConfig).toBe(config);
  expect(mocks.error).toHaveBeenCalled();
});

it("keeps refreshing after the settings page is closed", async () => {
  vi.useFakeTimers();
  mocks.choose.mockResolvedValue("D:/pet.json");
  await click("加载角色文件");
  await act(async () => root.render(createElement(Content, { showSettings: false })));
  expect(host.querySelector("textarea")).toBeNull();
  mocks.read.mockResolvedValue(snapshot("updated in background"));
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(useAppStore.getState().pixelPetConfig.name).toBe("updated in background");
});

it("rejects a previous file's pending read after a new file is linked", async () => {
  let resolve!: (value: ReturnType<typeof snapshot>) => void;
  mocks.choose.mockResolvedValue("D:/first.json");
  mocks.read.mockResolvedValueOnce(snapshot("first"))
    .mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
    .mockResolvedValue(snapshot("second"));
  await click("加载角色文件");
  await act(async () => useAppStore.getState().setPixelPetFilePath("D:/second.json"));
  expect(useAppStore.getState().pixelPetConfig.name).toBe("second");
  await act(async () => resolve(snapshot("late first")));
  expect(useAppStore.getState().pixelPetConfig.name).toBe("second");
});

it("fits thumbnails and resizes the live stage on character/scale changes while keeping boosted jumps inside", async () => {
  await act(async () => root.render(null));
  let nextFrame!: FrameRequestCallback;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { nextFrame = callback; return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const ctx = { clearRect: vi.fn(), fillRect: vi.fn(), setTransform: vi.fn() } as unknown as CanvasRenderingContext2D;
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(ctx);
  const draw = vi.spyOn(sprites, "drawPixelPetFrame").mockImplementation(() => {});
  vi.spyOn(sprites, "drawPixelBubble").mockImplementation(() => {});
  vi.spyOn(sprites, "drawPetEncounter").mockImplementation(() => {});
  const daimao = PIXEL_PET_PRESETS.find((preset) => preset.id === "daimao")!;
  useAppStore.setState({ pixelPetConfig: daimao });
  await act(async () => root.render(createElement(Content)));

  const canvases = [...host.querySelectorAll("canvas")];
  expect(canvases).toHaveLength(PIXEL_PET_PRESETS.length + 1);
  for (const [ctxArg, frame, x, y, , scale] of draw.mock.calls) {
    expect(ctxArg).toBe(ctx);
    expect(x).toBeGreaterThanOrEqual(2);
    expect(y).toBeGreaterThanOrEqual(2);
    expect(x + frame[0].length * scale!).toBeLessThanOrEqual(42);
    expect(y + frame.length * scale!).toBeLessThanOrEqual(42);
  }

  const stage = canvases[0];
  const initialHeight = stage.height;
  const large: PixelPetConfig = {
    ...daimao, id: "large", pixelSize: 4, submergeRows: 12,
    clips: { jump: [Array(32).fill("B".repeat(32))] },
  };
  await act(async () => useAppStore.setState({ pixelPetConfig: large }));
  let now = performance.now();
  await act(async () => nextFrame(now += 50));
  expect(stage.height).toBeGreaterThan(initialHeight);
  draw.mockClear();
  for (let i = 0; i < 40; i++) {
    await act(async () => { stage.parentElement!.click(); nextFrame(now += 50); });
  }
  for (const [, frame, x, y, , scale, , waterline] of draw.mock.calls) {
    expect(frame).toHaveLength(32);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + frame[0].length * scale!).toBeLessThanOrEqual(stage.width);
    expect(y).toBeGreaterThanOrEqual(24);
    expect(y + frame.length * scale!).toBeLessThanOrEqual(stage.height - 14);
    expect(waterline).toBeUndefined();
  }
  expect(draw.mock.calls.some((call) => call[3] === 24)).toBe(true);

  await act(async () => useAppStore.setState({ pixelPetConfig: { ...large, pixelSize: 1 } }));
  await act(async () => nextFrame(now += 50));
  expect(stage.height).toBeLessThan(initialHeight + 88);
  expect(draw.mock.lastCall![5]).toBe(1);
});

import { expect, it } from "vitest";
import { DEFAULT_PIXEL_PET_CONFIG, parsePixelPetConfigJson } from "./pixelPetConfig";
import { drawPixelBubble, drawPixelPetFrame, getPetSpriteFrame, type PetDrawBounds } from "./pixelPetSprites";
import { createInitialPetSimulation, stepPetSimulation, togglePetPaused, triggerPetJump } from "./pixelPet";

it("plays transition clips once and holds their final pose", () => {
  const config = DEFAULT_PIXEL_PET_CONFIG;
  expect(getPetSpriteFrame("land", 0, config)).toEqual(config.clips!.land![0]);
  expect(getPetSpriteFrame("land", 70, config)).toEqual(config.clips!.land![1]);
  expect(getPetSpriteFrame("land", 5000, config)).toEqual(config.clips!.land!.at(-1));
});

it("falls back to the custom pet's own frames when transition clips are absent", () => {
  const parsed = parsePixelPetConfigJson(JSON.stringify({
    palette: { X: "#fff" }, frames: { idle: [["X."]], jump: [[".X"]] },
  }));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(getPetSpriteFrame("land", 0, parsed.config)).toEqual(["X."]);
  expect(getPetSpriteFrame("fall", 500, parsed.config)).toEqual([".X"]);
});

it("resets the clip clock on mood changes and allows pause to cancel anticipation", () => {
  let sim = { ...createInitialPetSimulation(400), clipElapsedMs: 6000 };
  sim = stepPetSimulation(sim, 16, 400, "error");
  expect(sim.clip).toBe("alert");
  expect(sim.clipElapsedMs).toBe(0);
  sim = togglePetPaused(triggerPetJump(sim));
  sim = stepPetSimulation(sim, 50, 400, "idle");
  expect(sim.transitionMs).toBe(270);
  expect(sim.clip).toBe("doze");
  for (let i = 0; i < 6; i++) {
    sim = stepPetSimulation(sim, 50, 400, "idle");
  }
  expect(sim.clip).toBe("sleep");
});

it("validates per-frame timing and preserves valid timing through JSON", () => {
  const parsed = parsePixelPetConfigJson(JSON.stringify({
    ...DEFAULT_PIXEL_PET_CONFIG,
    frameTimingsMs: { idle: [1200, 80], land: [-10, "bad"] },
  }));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.config.frameTimingsMs).toEqual({ idle: [1200, 80] });
  expect(getPetSpriteFrame("idle", 1199, parsed.config)).toEqual(parsed.config.frames.idle[0]);
  expect(getPetSpriteFrame("idle", 1200, parsed.config)).toEqual(parsed.config.frames.idle[1]);
});

it("accelerates gradually without leaving bounds, including during a resize", () => {
  let sim = createInitialPetSimulation(400);
  sim.action = "walk";
  sim.clip = "walk";
  const start = sim.x;
  sim = stepPetSimulation(sim, 50, 400, "idle");
  const firstStep = sim.x - start;
  for (let i = 0; i < 6; i++) sim = stepPetSimulation(sim, 50, 400, "idle");
  const before = sim.x;
  sim = stepPetSimulation(sim, 50, 400, "idle");
  expect(sim.x - before).toBeGreaterThan(firstStep);
  sim = triggerPetJump({ ...sim, x: 350 });
  sim = stepPetSimulation(sim, 50, 200, "idle");
  expect(sim.x).toBeLessThanOrEqual(148);
});

it("uses dedicated run frames when provided and supports fallback clips in imported JSON", () => {
  const parsed = parsePixelPetConfigJson(JSON.stringify({
    palette: { X: "#fff", R: "#f00" },
    frames: { idle: [["X."]], walk: [[".X"]], run: [["RR"]] },
    behavior: { cheerBubbles: ["GO!"], workBubbles: ["RUN"] },
  }));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(getPetSpriteFrame("run", 0, parsed.config)).toEqual(["RR"]);
  expect(getPetSpriteFrame("easterEgg", 0, parsed.config)).toEqual(["X."]);
  expect(getPetSpriteFrame("doze", 0, parsed.config)).toEqual(["X."]);
});

it("tracks the full painted area of uneven frames and speech bubbles", () => {
  let marks: PetDrawBounds[] = [];
  const mark = (x: number, y: number, width: number, height: number) => marks.push({ x, y, width, height });
  const ctx = {
    save() {}, restore() {}, scale() {}, translate() {}, fillRect: mark, strokeRect: mark,
    measureText: () => ({
      width: 11, actualBoundingBoxLeft: 16, actualBoundingBoxRight: 20,
      actualBoundingBoxAscent: 11, actualBoundingBoxDescent: 14,
    }),
    fillText: (_: string, x: number, y: number) => mark(x - 16, y - 11, 36, 25),
  } as unknown as CanvasRenderingContext2D;
  // 自定义帧允许每行宽度不同；朝左时最后一行会绘制到起点左侧。
  expect(drawPixelPetFrame(ctx, ["X", "XXXX"], 20, 16, -1, 2, { X: "#fff" }))
    .toEqual({ x: 14, y: 16, width: 8, height: 4 });
  const expectCoverage = (bounds: PetDrawBounds) => {
    expect(marks.length).toBeGreaterThan(0);
    for (const rect of marks) {
      expect(rect.x).toBeGreaterThanOrEqual(bounds.x);
      expect(rect.y).toBeGreaterThanOrEqual(bounds.y);
      expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
  };
  for (const top of [5, 60]) {
    marks = [];
    expectCoverage(drawPixelBubble(ctx, "★", { x: 20, y: top, width: 20, height: 24 }, 2, { width: 200, height: 140 }));
  }
});

it("scales dialogue in CSS pixels and keeps long lines readable at the edge", () => {
  const drawn: { text: string; x: number; y: number; font: string }[] = [];
  const canvas = {
    font: "",
    save() {}, restore() {}, fillRect() {}, strokeRect() {},
    measureText(text: string) { return { width: text.length * parseFloat(this.font.split(" ")[1]) }; },
    fillText(text: string, x: number, y: number) { drawn.push({ text, x, y, font: this.font }); },
  };
  const ctx = canvas as unknown as CanvasRenderingContext2D;
  const viewport = { width: 200, height: 140 };
  for (const scale of [1, 2, 3, 4]) {
    const bounds = drawPixelBubble(ctx, "有脚印喵！", { x: 180, y: 3, width: 18, height: 18 }, scale, viewport);
    expect(drawn.at(-1)?.font).toContain(`${12 + 2 * scale}px`);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(180);
  }
  drawn.length = 0;
  const text = "お団子一本ちょうだいニャ";
  const bounds = drawPixelBubble(ctx, text, { x: 2, y: 80, width: 36, height: 40 }, 4, viewport);
  expect(drawn.map((line) => line.text).join("")).toBe(text);
  expect(drawn.length).toBe(2);
  expect(drawn[0].y).toBeLessThan(drawn[1].y);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(80);
});

import { expect, it } from "vitest";
import { DEFAULT_PIXEL_PET_CONFIG, parsePixelPetConfigJson } from "./pixelPetConfig";
import { getPetSpriteFrame } from "./pixelPetSprites";
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
  expect(sim.transitionMs).toBe(0);
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

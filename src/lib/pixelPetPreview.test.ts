import { describe, expect, it } from "vitest";
import { DEFAULT_PIXEL_PET_CONFIG, PIXEL_PET_PRESETS, type PixelPetConfig } from "./pixelPetConfig";
import { drawPixelPetFrame, getPetRenderedDimensions } from "./pixelPetSprites";
import {
  getPixelPetPreviewStageLayout,
  getPixelPetThumbnailLayout,
  preparePixelPetPreview,
} from "./pixelPetPreview";

function custom(frame: string[], clips?: PixelPetConfig["clips"]): PixelPetConfig {
  return {
    ...DEFAULT_PIXEL_PET_CONFIG,
    id: "custom",
    palette: { X: "#123456" },
    frames: Object.fromEntries(Object.keys(DEFAULT_PIXEL_PET_CONFIG.frames).map((key) =>
      [key, [frame]])) as PixelPetConfig["frames"],
    clips,
  };
}

function visiblePixels(frames: string[][], palette: Record<string, string>) {
  return frames.map((frame) => frame.reduce((sum, row) =>
    sum + [...row].filter((ch) => ch !== "." && palette[ch]).length, 0));
}

/** Record the actual transformed draw rectangles, including facing=-1. */
function drawRects(frame: string[], x: number, y: number, pixelSize: number, facing: 1 | -1,
  palette: Record<string, string>) {
  let originX = 0;
  let originY = 0;
  let direction = 1;
  const rects: { x: number; y: number; width: number; height: number }[] = [];
  const ctx = {
    save() {}, restore() {},
    translate(dx: number, dy: number) { originX += dx; originY += dy; },
    scale(sx: number) { direction *= sx; },
    fillRect(dx: number, dy: number, width: number, height: number) {
      rects.push({ x: originX + direction * dx - (direction < 0 ? width : 0),
        y: originY + dy, width, height });
    },
  } as unknown as CanvasRenderingContext2D;
  drawPixelPetFrame(ctx, frame, x, y, facing, pixelSize, palette);
  return rects;
}

describe("pixel pet preview fitting", () => {
  it("keeps every built-in pixel inside the thumbnail, including Daimao's feet", () => {
    for (const preset of PIXEL_PET_PRESETS) {
      const preview = preparePixelPetPreview(preset);
      const layout = getPixelPetThumbnailLayout(preview);
      for (const [key, frames] of Object.entries(preset.frames)) {
        expect(visiblePixels(preview.frames[key as keyof typeof preview.frames], preview.palette))
          .toEqual(visiblePixels(frames, preset.palette));
      }
      for (const frames of [...Object.values(preview.frames), ...Object.values(preview.clips ?? {})]) {
        for (const frame of frames) {
          for (const facing of [1, -1] as const) {
            const rects = drawRects(frame, layout.x, layout.y, layout.pixelSize, facing, preview.palette);
            for (const rect of rects) {
              expect(rect.x).toBeGreaterThanOrEqual(2);
              expect(rect.y).toBeGreaterThanOrEqual(2);
              expect(rect.x + rect.width).toBeLessThanOrEqual(layout.width - 2);
              expect(rect.y + rect.height).toBeLessThanOrEqual(layout.height - 2);
            }
          }
        }
      }
      if (preset.id === "daimao") expect(layout.pixelSize).toBe(2);
    }
  });

  it("fits tall, wide, maximum-size and future larger grids at a whole-pixel scale", () => {
    for (const [width, height] of [[1, 32], [32, 1], [32, 32], [80, 60]]) {
      const preview = preparePixelPetPreview(custom(Array(height).fill("X".repeat(width))));
      const layout = getPixelPetThumbnailLayout(preview);
      const rects = drawRects(preview.frames.idle[0], layout.x, layout.y, layout.pixelSize, 1, preview.palette);
      expect(rects).toHaveLength(width * height);
      expect(Number.isInteger(layout.pixelSize)).toBe(true);
      expect(layout.x + width * layout.pixelSize).toBeLessThanOrEqual(layout.width - 2);
      expect(layout.y + height * layout.pixelSize).toBeLessThanOrEqual(layout.height - 2);
    }
  });

  it("measures all actions, extra clips and ragged rows without changing frame alignment or source data", () => {
    const config = custom([".", "..X", "..."], { celebrate: [[".X....", ".....X", "......", "X....."]] });
    const original = JSON.stringify(config);
    const preview = preparePixelPetPreview(config);
    expect(getPetRenderedDimensions({ ...preview, pixelSize: 1 })).toEqual({ width: 6, height: 4 });
    expect(preview.frames.idle[0]).toEqual(["......", "..X...", "......", "......"]);
    expect(preview.clips!.celebrate![0]).toEqual([".X....", ".....X", "......", "X....."]);
    expect(JSON.stringify(config)).toBe(original);
  });

  it("removes only common empty margins and keeps preview pixels opaque above the ground", () => {
    const config = { ...custom(["......", "..XX..", "..X...", "......"]), submergeRows: 12 };
    const preview = preparePixelPetPreview(config);
    expect(preview.frames.idle[0]).toEqual(["XX", "X."]);
    expect(preview.submergeRows).toBe(0);
    expect(config.submergeRows).toBe(12);
  });

  it("handles entirely empty or unpainted frames with a finite blank surface", () => {
    const preview = preparePixelPetPreview(custom(["...", ".?."]));
    expect(preview.frames.idle[0]).toEqual(["."]);
    expect(getPixelPetThumbnailLayout(preview)).toEqual({ width: 44, height: 44, pixelSize: 2, x: 21, y: 21 });
  });

  it("reserves space for the entire animation envelope, requested scale and jump arc", () => {
    const preview = preparePixelPetPreview({
      ...custom(["X"], { jump: [Array(32).fill("X".repeat(32))] }),
      pixelSize: 4,
      behavior: { ...DEFAULT_PIXEL_PET_CONFIG.behavior, jumpVelocityPxPerSec: 360, gravityPxPerSec2: 200 },
    });
    const layout = getPixelPetPreviewStageLayout(preview, 200);
    expect(layout.pixelSize).toBe(4);
    expect(layout.spriteWidth).toBe(128);
    expect(layout.spriteHeight).toBe(128);
    expect(layout.groundY - layout.spriteHeight - 360 ** 2 / (2 * 200)).toBeGreaterThanOrEqual(layout.topPadding);
    expect(getPixelPetPreviewStageLayout(preview, 100).pixelSize).toBe(2);
  });
});

import type { PixelPetConfig } from "./pixelPetConfig";
import { getPetRenderedDimensions, getPixelBubbleFontSize } from "./pixelPetSprites";

/**
 * Use one visible-pixel envelope for every preview frame. Cropping each frame
 * separately would make limbs, breathing and facing changes shift the sprite.
 * The saved config and desktop pet keep their original grids and waterline.
 */
export function preparePixelPetPreview(config: PixelPetConfig): PixelPetConfig {
  let left = Infinity;
  let top = Infinity;
  let right = -1;
  let bottom = -1;
  const allFrames = [...Object.values(config.frames), ...Object.values(config.clips ?? {})];
  for (const frames of allFrames) {
    for (const frame of frames) {
      frame.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          if (row[x] === "." || !config.palette[row[x]]) continue;
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      });
    }
  }
  const width = right < 0 ? 1 : right - left + 1;
  const height = bottom < 0 ? 1 : bottom - top + 1;
  if (right < 0) left = top = 0;
  const normalize = (frames: string[][]): string[][] => frames.map((frame) =>
    Array.from({ length: height }, (_, y) =>
      (frame[y + top] ?? "").slice(left, left + width).padEnd(width, ".")),
  );
  return {
    ...config,
    submergeRows: 0,
    frames: Object.fromEntries(Object.entries(config.frames).map(([key, frames]) =>
      [key, normalize(frames)])) as PixelPetConfig["frames"],
    clips: config.clips ? Object.fromEntries(Object.entries(config.clips).map(([key, frames]) =>
      [key, normalize(frames)])) as PixelPetConfig["clips"] : undefined,
  };
}

/** Fit at an integer scale; grow the surface if even 1x needs more room. */
export function getPixelPetThumbnailLayout(config: PixelPetConfig) {
  const { width: cols, height: rows } = getPetRenderedDimensions({ ...config, pixelSize: 1 });
  const padding = 2;
  const width = Math.max(44, cols + padding * 2);
  const height = Math.max(44, rows + padding * 2);
  const pixelSize = Math.max(1, Math.min(2,
    Math.floor((width - padding * 2) / cols),
    Math.floor((height - padding * 2) / rows),
  ));
  return {
    width, height, pixelSize,
    x: Math.floor((width - cols * pixelSize) / 2),
    y: Math.floor((height - rows * pixelSize) / 2),
  };
}

export function getPixelPetPreviewStageLayout(config: PixelPetConfig, viewportWidth: number) {
  const { width: cols, height: rows } = getPetRenderedDimensions({ ...config, pixelSize: 1 });
  const pixelSize = Math.max(1, Math.min(Math.round(config.pixelSize || 2),
    Math.floor((viewportWidth - 24) / cols)));
  const spriteWidth = cols * pixelSize;
  const spriteHeight = rows * pixelSize;
  // Include the nominal jump arc, with extra room for the discrete physics step.
  const jumpHeight = Math.ceil(config.behavior.jumpVelocityPxPerSec ** 2
    / (2 * config.behavior.gravityPxPerSec2) + config.behavior.jumpVelocityPxPerSec * 0.05);
  // 为单行台词留出行高、内边距和气泡尖角。
  const topPadding = getPixelBubbleFontSize(pixelSize) + 16;
  const height = Math.max(76, spriteHeight + jumpHeight + topPadding + 14);
  return { pixelSize, spriteWidth, spriteHeight, height, groundY: height - 14, topPadding };
}

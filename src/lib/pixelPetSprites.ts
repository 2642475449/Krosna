import type { PetActionState } from "./pixelPet";
import {
  DEFAULT_PIXEL_PET_CONFIG,
  type PixelPetConfig,
  type PixelSpriteFrame,
} from "./pixelPetConfig";

const DEFAULT_FRAME_DURATION_MS: Record<PetActionState, number> = {
  idle: 520,
  walk: 145,
  run: 95,
  jump: 200,
  sleep: 650,
  celebrate: 200,
  alert: 220,
};

/**
 * Compute rendered logical width/height of a pet config in CSS pixels.
 */
export function getPetRenderedDimensions(config: PixelPetConfig): { width: number; height: number } {
  const sample = config.frames.idle[0] ?? config.frames.walk[0];
  const rows = sample?.length ?? 16;
  const cols = sample?.[0]?.length ?? 16;
  const pixelSize = Math.max(1, Math.round(config.pixelSize || 2));
  return {
    width: cols * pixelSize,
    height: rows * pixelSize,
  };
}

/**
 * Select the current pixel frame for a pet action and elapsed time from config.
 */
export function getPetSpriteFrame(
  action: PetActionState,
  animElapsedMs: number,
  config: PixelPetConfig = DEFAULT_PIXEL_PET_CONFIG,
): PixelSpriteFrame {
  const frames = config.frames[action] ?? config.frames.idle ?? config.frames.walk;
  if (!frames || frames.length === 0) {
    return DEFAULT_PIXEL_PET_CONFIG.frames.idle[0];
  }
  if (frames.length <= 1) {
    return frames[0];
  }
  const duration = config.frameDurationsMs?.[action] ?? DEFAULT_FRAME_DURATION_MS[action];
  const safeDuration = Math.max(40, duration);
  const index = Math.floor(Math.max(0, animElapsedMs) / safeDuration) % frames.length;
  return frames[index] ?? frames[0];
}

/**
 * Draw a pixel sprite frame onto a 2D canvas context with crisp integer pixel edges.
 */
export function drawPixelPetFrame(
  ctx: CanvasRenderingContext2D,
  frame: PixelSpriteFrame,
  x: number,
  y: number,
  facing: 1 | -1,
  pixelSize = DEFAULT_PIXEL_PET_CONFIG.pixelSize,
  palette: Record<string, string> = DEFAULT_PIXEL_PET_CONFIG.palette,
  waterlineY?: number,
): void {
  const safePixelSize = Math.max(1, Math.round(pixelSize));
  const spriteWidth = (frame[0]?.length ?? 16) * safePixelSize;
  const drawX = Math.round(x);
  const drawY = Math.round(y);

  ctx.save();
  if (facing === -1) {
    ctx.translate(drawX + spriteWidth, drawY);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(drawX, drawY);
  }

  for (let row = 0; row < frame.length; row++) {
    const isSubmerged =
      typeof waterlineY === "number" && drawY + row * safePixelSize >= waterlineY;
    ctx.globalAlpha = isSubmerged ? 0.22 : 1;
    const line = frame[row];
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      if (ch === ".") continue;
      const color = palette[ch];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(col * safePixelSize, row * safePixelSize, safePixelSize, safePixelSize);
    }
  }
  ctx.restore();
}

/**
 * Draw a crisp pixel speech bubble above or beside the pet.
 */
export function drawPixelBubble(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  topY: number,
): void {
  ctx.save();
  ctx.font = "bold 10px monospace";
  const textWidth = Math.ceil(ctx.measureText(text).width);
  const boxWidth = Math.max(22, textWidth + 10);
  const boxHeight = 15;
  const placeBeside = topY < boxHeight + 6;
  const boxX = placeBeside
    ? Math.round(centerX + 20)
    : Math.round(centerX - boxWidth / 2);
  const boxY = placeBeside
    ? Math.max(4, Math.round(topY + 6))
    : Math.max(2, Math.round(topY - boxHeight - 3));

  ctx.fillStyle = "#fffdf5";
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

  ctx.strokeStyle = "#2b2520";
  ctx.lineWidth = 1;
  ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxWidth - 1, boxHeight - 1);

  if (!placeBeside) {
    const tipX = Math.round(centerX);
    ctx.fillStyle = "#fffdf5";
    ctx.fillRect(tipX - 2, boxY + boxHeight - 1, 4, 2);
    ctx.fillStyle = "#2b2520";
    ctx.fillRect(tipX - 1, boxY + boxHeight + 1, 2, 2);
  }

  ctx.fillStyle = "#1e1b18";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, Math.round(boxX + boxWidth / 2), boxY + Math.floor(boxHeight / 2) + 0.5);
  ctx.restore();
}

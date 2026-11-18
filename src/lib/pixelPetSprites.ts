import type { PetActionState, PetClipId } from "./pixelPet";
import {
  DEFAULT_PIXEL_PET_CONFIG,
  type PixelPetConfig,
  type PixelSpriteFrame,
} from "./pixelPetConfig";

const DEFAULT_FRAME_DURATION_MS: Partial<Record<PetClipId, number>> = {
  idle: 440,
  walk: 145,
  run: 95,
  jump: 200,
  sleep: 650,
  celebrate: 200,
  alert: 220,
  doze: 180,
  wake: 160,
  easterEgg: 230,
  wallGrab: 110,
  climb: 140,
  wallHang: 420,
  wallJump: 120,
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
  action: PetClipId,
  animElapsedMs: number,
  config: PixelPetConfig = DEFAULT_PIXEL_PET_CONFIG,
): PixelSpriteFrame {
  const fallback: PetActionState =
    action === "fall" || action === "wallJump"
      ? "jump"
      : action === "climb" || action === "run"
        ? "walk"
        : action === "doze"
          ? "sleep"
          : action === "easterEgg"
            ? "celebrate"
            : "idle";
  const frames = config.clips?.[action]?.length
    ? config.clips[action]!
    : config.frames[action as PetActionState]?.length
      ? config.frames[action as PetActionState]
      : config.clips?.[fallback]?.length
        ? config.clips[fallback]!
        : config.frames[fallback] ?? config.frames.idle;
  if (!frames || frames.length === 0) {
    return DEFAULT_PIXEL_PET_CONFIG.frames.idle[0];
  }
  if (frames.length <= 1) {
    return frames[0];
  }
  const duration = config.frameDurationsMs?.[action]
    ?? DEFAULT_FRAME_DURATION_MS[action]
    ?? 120;
  const safeDuration = Number.isFinite(duration) ? Math.max(40, duration) : 120;
  const elapsed = Number.isFinite(animElapsedMs) ? Math.max(0, animElapsedMs) : 0;
  const weights = action === "idle" ? [1.15, 0.85, 1.15, 0.85]
    : action === "land" ? [0.65, 1.35] : action === "celebrate" ? [1.4, 0.6, 0.7, 1.3] : [1];
  const durations = frames.map((_, i) => {
    const timing = config.frameTimingsMs?.[action]?.[i];
    return typeof timing === "number" && Number.isFinite(timing) && timing >= 40
      ? timing : safeDuration * weights[i % weights.length];
  });
  const total = durations.reduce((sum, value) => sum + value, 0);
  const once = [
    "crouch",
    "land",
    "turn",
    "stop",
    "edgeLook",
    "jump",
    "fall",
    "doze",
    "wake",
    "wallGrab",
    "wallJump",
  ].includes(action);
  let cursor = once ? Math.min(elapsed, total - 0.001) : elapsed % total;
  let index = 0;
  while (index < frames.length - 1 && cursor >= durations[index]) {
    cursor -= durations[index++];
  }
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

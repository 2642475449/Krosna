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
): PetDrawBounds {
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

  let widestRow = 0;
  for (let row = 0; row < frame.length; row++) {
    const isSubmerged =
      typeof waterlineY === "number" && drawY + row * safePixelSize >= waterlineY;
    ctx.globalAlpha = isSubmerged ? 0.22 : 1;
    const line = frame[row];
    widestRow = Math.max(widestRow, line.length);
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
  const width = widestRow * safePixelSize;
  return { x: facing === -1 ? drawX + spriteWidth - width : drawX, y: drawY, width, height: frame.length * safePixelSize };
}

export interface PetDrawBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getPixelBubbleFontSize(pixelSize: number): number {
  return 12 + 2 * Math.max(1, Math.min(4, Math.round(pixelSize)));
}

/**
 * Draw a crisp pixel speech bubble above or beside the pet.
 */
export function drawPixelBubble(
  ctx: CanvasRenderingContext2D,
  text: string,
  sprite: PetDrawBounds,
  pixelSize: number,
  viewport: { width: number; height: number },
): PetDrawBounds {
  const fontSize = getPixelBubbleFontSize(pixelSize);
  const lineHeight = fontSize + 4;
  const paddingX = 6;
  const margin = 2;
  const gap = 4;
  ctx.save();
  ctx.font = `600 ${fontSize}px system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Noto Sans CJK SC", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const metrics = ctx.measureText(text);
  const maxTextWidth = viewport.width - 2 * (paddingX + margin);
  const lines = [{ text, metrics }];
  if (metrics.width > maxTextWidth) {
    lines.length = 0;
    let line = "";
    for (const char of text) {
      if (line && ctx.measureText(line + char).width > maxTextWidth) {
        lines.push({ text: line, metrics: ctx.measureText(line) });
        line = "";
      }
      line += char;
    }
    lines.push({ text: line, metrics: ctx.measureText(line) });
  }
  const boxWidth = Math.ceil(Math.max(fontSize, ...lines.map((line) => line.metrics.width))) + 2 * paddingX;
  const boxHeight = lines.length * lineHeight + 6;
  const centerX = sprite.x + sprite.width / 2;
  const above = sprite.y >= boxHeight + gap + margin;
  let x = centerX - boxWidth / 2;
  let y = sprite.y - boxHeight - gap;
  if (!above) {
    const right = sprite.x + sprite.width + gap;
    const left = sprite.x - gap - boxWidth;
    y = sprite.y + gap;
    if (right + boxWidth <= viewport.width - margin) x = right;
    else if (left >= margin) x = left;
    else y = sprite.y + sprite.height + gap;
  }
  const boxX = Math.max(margin, Math.min(Math.round(x), viewport.width - boxWidth - margin));
  const boxY = Math.max(margin, Math.min(Math.round(y), viewport.height - boxHeight - margin));

  ctx.fillStyle = "#fffdf5";
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

  ctx.strokeStyle = "#2b2520";
  ctx.lineWidth = 1;
  ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxWidth - 1, boxHeight - 1);

  if (above) {
    const tipX = Math.max(boxX + 3, Math.min(Math.round(centerX), boxX + boxWidth - 3));
    ctx.fillStyle = "#fffdf5";
    ctx.fillRect(tipX - 2, boxY + boxHeight - 1, 4, 2);
    ctx.fillStyle = "#2b2520";
    ctx.fillRect(tipX - 1, boxY + boxHeight + 1, 2, 2);
  }

  ctx.fillStyle = "#1e1b18";
  const textX = Math.round(boxX + boxWidth / 2);
  let left = boxX;
  let top = boxY;
  let right = boxX + boxWidth;
  let bottom = boxY + boxHeight + (above ? 3 : 0);
  lines.forEach((line, index) => {
    const textY = boxY + 3 + lineHeight * (index + 0.5);
    ctx.fillText(line.text, textX, textY);
    left = Math.min(left, Math.floor(textX - (line.metrics.actualBoundingBoxLeft || 0)));
    top = Math.min(top, Math.floor(textY - (line.metrics.actualBoundingBoxAscent || 0)));
    right = Math.max(right, Math.ceil(textX + (line.metrics.actualBoundingBoxRight || 0)));
    bottom = Math.max(bottom, Math.ceil(textY + (line.metrics.actualBoundingBoxDescent || 0)));
  });
  ctx.restore();
  return { x: left, y: top, width: right - left, height: bottom - top };
}

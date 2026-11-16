import type { PetActionState, PetClipId, PetEncounterEntity } from "./pixelPet";
import {
  DEFAULT_PIXEL_PET_CONFIG,
  type PixelPetConfig,
  type PixelSpriteFrame,
} from "./pixelPetConfig";

const DEFAULT_FRAME_DURATION_MS: Record<PetActionState, number> = {
  idle: 440,
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
  action: PetClipId,
  animElapsedMs: number,
  config: PixelPetConfig = DEFAULT_PIXEL_PET_CONFIG,
): PixelSpriteFrame {
  const normalizedAction: PetClipId = action === "run" ? "walk" : action;
  const fallback: PetActionState = normalizedAction === "fall" || normalizedAction === "wallJump" ? "jump"
    : normalizedAction === "climb" ? "walk" : "idle";
  const frames = config.clips?.[normalizedAction]?.length ? config.clips[normalizedAction]!
    : config.frames[normalizedAction as PetActionState] ?? config.frames[fallback] ?? config.frames.idle;
  if (!frames || frames.length === 0) {
    return DEFAULT_PIXEL_PET_CONFIG.frames.idle[0];
  }
  if (frames.length <= 1) {
    return frames[0];
  }
  const duration = config.frameDurationsMs?.[normalizedAction]
    ?? DEFAULT_FRAME_DURATION_MS[normalizedAction as PetActionState] ?? 120;
  const safeDuration = Number.isFinite(duration) ? Math.max(40, duration) : 120;
  const elapsed = Number.isFinite(animElapsedMs) ? Math.max(0, animElapsedMs) : 0;
  const weights = normalizedAction === "idle" ? [1.15, 0.85, 1.15, 0.85]
    : normalizedAction === "land" ? [0.65, 1.35] : normalizedAction === "celebrate" ? [1.4, 0.6, 0.7, 1.3] : [1];
  const durations = frames.map((_, i) => {
    const timing = config.frameTimingsMs?.[normalizedAction]?.[i];
    return typeof timing === "number" && Number.isFinite(timing) && timing >= 40
      ? timing : safeDuration * weights[i % weights.length];
  });
  const total = durations.reduce((sum, value) => sum + value, 0);
  const once = ["crouch", "land", "turn", "stop", "edgeLook", "jump", "fall"].includes(normalizedAction);
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

const SLIME_FRAMES: PixelSpriteFrame[] = [
  [
    "...oooo...",
    "..oggggo..",
    ".oggggggo.",
    "ogwogggwgo",
    "ogkogggkgo",
    "oggggggggo",
    ".oooooooo.",
  ],
  [
    "..........",
    "..oooooo..",
    ".oggggggo.",
    "ogwogggwgo",
    "ogkogggkgo",
    "oggggggggo",
    "oooooooooo",
  ],
];

const GHOST_FRAMES: PixelSpriteFrame[] = [
  [
    "..oooooo..",
    ".owwwwwwo.",
    "owkwwwkwwo",
    "owwwwwwwwo",
    "owwwwwwwwo",
    "ow.oww.owo",
    "o..o..o..o",
  ],
  [
    "..oooooo..",
    ".owwwwwwo.",
    "owkwwwkwwo",
    "owwwwwwwwo",
    "owwwwwwwwo",
    "owo.ww.ow.",
    ".o..o..o..",
  ],
];

const STAR_FRAME: PixelSpriteFrame = [
  "...y...",
  "..yyy..",
  "yyyyyyy",
  ".yyyyy.",
  "..yyy..",
  ".yy.yy.",
  "y.....y",
];

const ENCOUNTER_PALETTES: Record<string, Record<string, string>> = {
  slime: {
    o: "#1b4332",
    g: "#52b788",
    w: "#ffffff",
    k: "#111827",
  },
  ghost: {
    o: "#312e81",
    w: "#e0e7ff",
    k: "#1e1b4b",
  },
  star: {
    y: "#facc15",
  },
};

export function drawPetEncounter(
  ctx: CanvasRenderingContext2D,
  encounter: PetEncounterEntity,
  groundY: number,
  animElapsedMs: number,
): void {
  const pixelSize = 2;
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  if (encounter.phase === "defeated") {
    const progress = 1 - Math.max(0, Math.min(1, encounter.remainingMs / 520));
    const spread = Math.round(4 + progress * 14);
    const centerX = Math.round(encounter.x + 10);
    const centerY = Math.round(groundY - 8 - encounter.y);
    const sparkColor = encounter.kind === "star" ? "#fde047" : "#f8fafc";
    const accentColor =
      encounter.kind === "slime"
        ? "#52b788"
        : encounter.kind === "ghost"
          ? "#a5b4fc"
          : "#facc15";
    const offsets = [
      [-spread, -spread],
      [spread, -spread],
      [-spread, Math.round(spread * 0.4)],
      [spread, Math.round(spread * 0.4)],
      [0, -spread - 3],
      [-Math.round(spread * 0.6), -Math.round(spread * 0.9)],
      [Math.round(spread * 0.6), -Math.round(spread * 0.9)],
    ];
    offsets.forEach(([ox, oy], index) => {
      ctx.fillStyle = index % 2 === 0 ? sparkColor : accentColor;
      ctx.fillRect(centerX + ox, centerY + oy, 3, 3);
    });
    ctx.restore();
    return;
  }

  const bob =
    encounter.kind === "ghost"
      ? Math.round(Math.sin(animElapsedMs / 180) * 2)
      : 0;
  const frameIndex = Math.floor(animElapsedMs / 240) % 2;
  const frame =
    encounter.kind === "slime"
      ? SLIME_FRAMES[frameIndex]
      : encounter.kind === "ghost"
        ? GHOST_FRAMES[frameIndex]
        : STAR_FRAME;
  const palette = ENCOUNTER_PALETTES[encounter.kind];
  const cols = frame[0]?.length ?? 0;
  const rows = frame.length;
  const drawX = Math.round(encounter.x);
  const drawY = Math.round(groundY - rows * pixelSize - encounter.y + bob);

  for (let r = 0; r < rows; r += 1) {
    const row = frame[r];
    for (let c = 0; c < cols; c += 1) {
      const token = row[c];
      if (!token || token === ".") continue;
      const color = palette[token];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(
        drawX + c * pixelSize,
        drawY + r * pixelSize,
        pixelSize,
        pixelSize,
      );
    }
  }

  ctx.restore();
}

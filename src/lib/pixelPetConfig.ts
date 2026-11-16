import type { PetActionState, PetClipId } from "./pixelPet";
import { DAIMAO_FRAMES, DAIMAO_PALETTE } from "./pixelPetDaimaoFrames";
import { HERO_FRAMES, HERO_PALETTE } from "./pixelPetHeroFrames";

export type PixelSpriteFrame = readonly string[];

export interface PixelPetBehaviorConfig {
  walkSpeedPxPerSec: number;
  runSpeedPxPerSec: number;
  jumpVelocityPxPerSec: number;
  gravityPxPerSec2: number;
  sleepAfterIdleMs: number;
  allowPlatformHop: boolean;
  allowWallClimb: boolean;
  reactToCodingMood: boolean;
  enableRandomEvents: boolean;
  cheerBubbles: string[];
  workBubbles: string[];
}

export interface PixelPetConfig {
  id: string;
  name: string;
  pixelSize: number;
  submergeRows?: number;
  palette: Record<string, string>;
  frames: Record<PetActionState, string[][]>;
  clips?: Partial<Record<PetClipId, string[][]>>;
  frameDurationsMs?: Partial<Record<PetActionState | PetClipId, number>>;
  frameTimingsMs?: Partial<Record<PetClipId, number[]>>;
  behavior: PixelPetBehaviorConfig;
}

export const DEFAULT_PET_BEHAVIOR: PixelPetBehaviorConfig = {
  walkSpeedPxPerSec: 28,
  runSpeedPxPerSec: 54,
  jumpVelocityPxPerSec: 185,
  gravityPxPerSec2: 720,
  sleepAfterIdleMs: 10_000,
  allowPlatformHop: true,
  allowWallClimb: true,
  reactToCodingMood: true,
  enableRandomEvents: false,
  cheerBubbles: ["!", "+1", "★", "GO!", ":)"],
  workBubbles: ["</>", "...", "RUN", "⚡"],
};

const CAT_PALETTE: Record<string, string> = {
  O: "#fb8c00",
  o: "#e65100",
  C: "#ffe0b2",
  P: "#f48fb1",
  E: "#1e1b18",
  W: "#fff8e1",
};

const CAT_IDLE_0 = [
  "................",
  "................",
  "................",
  "................",
  ".........O...O..",
  "........OPO.OPO.",
  "........OOOOOOO.",
  ".O......OOEOOEO.",
  "OO.....OOOOOOOP.",
  "OO....oOOOOOOCC.",
  ".OO..OOOOoOOO...",
  "..OOOOOOOOOOO...",
  "..OOOOCCCCCOO...",
  "...OO.OO.OO.OO..",
  "...OO.OO.OO.OO..",
  "...WW.WW.WW.WW..",
];

const CAT_IDLE_1 = [
  "................",
  "................",
  "................",
  "................",
  ".........O...O..",
  "........OPO.OPO.",
  "........OOOOOOO.",
  "..O.....OOEOOEO.",
  ".OO....OOOOOOOP.",
  ".OO...oOOOOOOCC.",
  "..OO.OOOOoOOO...",
  "..OOOOOOOOOOO...",
  "..OOOOCCCCCOO...",
  "...OO.OO.OO.OO..",
  "...OO.OO.OO.OO..",
  "...WW.WW.WW.WW..",
];

const CAT_WALK_0 = [
  "................",
  "................",
  "................",
  ".........O...O..",
  "........OPO.OPO.",
  "........OOOOOOO.",
  ".O......OOEOOEO.",
  "OO.....OOOOOOOP.",
  "OO....oOOOOOOCC.",
  ".OO..OOOOoOOO...",
  "..OOOOOOOOOOO...",
  "..OOOOCCCCCOO...",
  "..OO..OO..OO.OO.",
  ".OO...OO...OO.OO",
  ".WW...WW...WW.WW",
  "................",
];

const CAT_WALK_1 = [
  "................",
  "................",
  "................",
  "................",
  ".........O...O..",
  "........OPO.OPO.",
  "........OOOOOOO.",
  "..O.....OOEOOEO.",
  ".OO....OOOOOOOP.",
  ".OO...oOOOOOOCC.",
  "..OO.OOOOoOOO...",
  "..OOOOOOOOOOO...",
  "..OOOOCCCCCOO...",
  "...OO.OO.OO.OO..",
  "....OO.OO.OO.OO.",
  "....WW.WW.WW.WW.",
];

const CAT_WALK_2 = [
  "................",
  "................",
  "................",
  ".........O...O..",
  "........OPO.OPO.",
  "........OOOOOOO.",
  "..O.....OOEOOEO.",
  "..OO...OOOOOOOP.",
  "...OO.oOOOOOOCC.",
  "...OOOOOOoOOO...",
  "..OOOOOOOOOOO...",
  "..OOOOCCCCCOO...",
  "...OO.OO..OO..OO",
  "..OO..OO..OO...O",
  "..WW..WW..WW...W",
  "................",
];

const CAT_JUMP = [
  "................",
  "................",
  ".........O...O..",
  "........OPO.OPO.",
  "........OOOOOOO.",
  "O.......OOEOOEO.",
  "OO.....OOOOOOOP.",
  ".OO...oOOOOOOCC.",
  "..OO.OOOOoOOO...",
  "..OOOOOOOOOOO...",
  "..OOOOCCCCCOO...",
  ".OO.OO....OO..OO",
  "WW..WW....WW..WW",
  "................",
  "................",
  "................",
];

const CAT_SLEEP = [
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "......O...O.....",
  ".....OPO.OPO....",
  "....OOOOOOOOO...",
  "...OOoOOOOOoOO..",
  "..OOOOOOOOOOOOO.",
  "..OOOOCCCCCOOOO.",
  "...OOOOOOOOOOO..",
  "....WWWWWWWWW...",
];

const BOT_PALETTE: Record<string, string> = {
  B: "#94a3b8",
  H: "#cbd5e1",
  s: "#64748b",
  K: "#1e293b",
  Y: "#fef9c3",
};

const BOT_IDLE_0 = [
  ".......HH.......",
  ".......BB.......",
  ".....HHBBBB.....",
  "....HBBBBBBB....",
  "....BBBBBBBB....",
  "...KYYYKKYYYK...",
  "...KYKYKKYKYK...",
  "...KKKKKKKKKK...",
  "....BBBBBBBB....",
  "....KYYYYYYK....",
  "....KYKYKYKK....",
  ".....BBBBBB.....",
  "...ssBBBBBBss...",
  "..ss.BBBBBB.ss..",
  ".....BBBBBB.....",
  ".....BB..BB.....",
  "....sss..sss....",
];

const BOT_IDLE_1 = [
  "................",
  ".......HH.......",
  ".......BB.......",
  ".....HHBBBB.....",
  "....HBBBBBBB....",
  "....BBBBBBBB....",
  "...KYYYKKYYYK...",
  "...KYKYKKYKYK...",
  "...KKKKKKKKKK...",
  "....BBBBBBBB....",
  "....KYYYYYYK....",
  "....KYKYKYKK....",
  ".....BBBBBB.....",
  "...ssBBBBBBss...",
  ".....BBBBBB.....",
  ".....BB..BB.....",
  "....sss..sss....",
];

const BOT_WALK_0 = [
  ".......HH.......",
  ".......BB.......",
  ".....HHBBBB.....",
  "....HBBBBBBB....",
  "....BBBBBBBB....",
  "...KYYYKKYYYK...",
  "...KYKYKKYKYK...",
  "...KKKKKKKKKK...",
  "....BBBBBBBB....",
  "....KYYYYYYK....",
  "....KYKYKYKK....",
  ".....BBBBBB.....",
  "...ssBBBBBBss...",
  ".ss..BBBBBB..ss.",
  ".....BBBBBB.....",
  "....BB....BB....",
  "...sss....sss...",
];

const BOT_WALK_1 = [
  "................",
  ".......HH.......",
  ".......BB.......",
  ".....HHBBBB.....",
  "....HBBBBBBB....",
  "....BBBBBBBB....",
  "...KYYYKKYYYK...",
  "...KYKYKKYKYK...",
  "...KKKKKKKKKK...",
  "....BBBBBBBB....",
  "....KYYYYYYK....",
  "....KYKYKYKK....",
  ".....BBBBBB.....",
  "...ssBBBBBBss...",
  ".....BBBBBB.....",
  ".....BB..BB.....",
  "....sss..sss....",
];

const BOT_JUMP = [
  "..ss...HH...ss..",
  "..ss...BB...ss..",
  ".....HHBBBB.....",
  "....HBBBBBBB....",
  "....BBBBBBBB....",
  "...KYYYKKYYYK...",
  "...KYKYKKYKYK...",
  "...KKKKKKKKKK...",
  "....BBBBBBBB....",
  "....KYYYYYYK....",
  "....KYKYKYKK....",
  ".....BBBBBB.....",
  ".....BBBBBB.....",
  ".....BBBBBB.....",
  "....BB....BB....",
  "...sss....sss...",
  "................",
];

const BOT_SLEEP = [
  "................",
  "................",
  ".......ss.......",
  ".....HHBBBB.....",
  "....HBBBBBBB....",
  "....BBBBBBBB....",
  "...KsssKKsssK...",
  "...KKKKKKKKKK...",
  "....BBBBBBBB....",
  "....KYYYYYYK....",
  "....KYKYKYKK....",
  ".....BBBBBB.....",
  "...ssBBBBBBss...",
  "..ss.BBBBBB.ss..",
  ".....BBBBBB.....",
  "....sss..sss....",
  "................",
];

export const PIXEL_PET_PRESETS: PixelPetConfig[] = [
  {
    id: "hero",
    name: "Red Cap Hero",
    pixelSize: 2,
    palette: HERO_PALETTE,
    frames: {
      idle: HERO_FRAMES.idle,
      walk: HERO_FRAMES.walk,
      run: HERO_FRAMES.run,
      jump: HERO_FRAMES.jump,
      sleep: HERO_FRAMES.sleep,
      celebrate: HERO_FRAMES.celebrate,
      alert: HERO_FRAMES.alert,
    },
    clips: HERO_FRAMES,
    frameTimingsMs: {
      idle: [460, 420],
      land: [65, 125],
      celebrate: [260, 100, 120, 280],
    },
    frameDurationsMs: {
      idle: 440,
      walk: 145,
      run: 95,
      jump: 200,
      fall: 160,
      crouch: 90,
      land: 95,
      turn: 110,
      stop: 120,
      edgeLook: 320,
      sleep: 650,
      celebrate: 190,
      alert: 220,
      wallGrab: 100,
      climb: 140,
      wallHang: 480,
      wallJump: 110,
    },
    behavior: { ...DEFAULT_PET_BEHAVIOR, allowWallClimb: true },
  },
  {
    id: "cat",
    name: "Pixel Ginger Cat",
    pixelSize: 2,
    palette: CAT_PALETTE,
    frames: {
      idle: [CAT_IDLE_0, CAT_IDLE_1, CAT_IDLE_0,
        CAT_IDLE_1.map((row) => row.replaceAll("E", "o"))],
      walk: [CAT_WALK_0, CAT_WALK_1, CAT_WALK_2, CAT_WALK_1],
      run: [CAT_WALK_0, CAT_WALK_2],
      jump: [CAT_JUMP],
      celebrate: [CAT_JUMP],
      sleep: [CAT_SLEEP],
      alert: [CAT_IDLE_0],
    },
    frameDurationsMs: {
      idle: 550,
      walk: 145,
      run: 95,
    },
    behavior: {
      ...DEFAULT_PET_BEHAVIOR,
      allowWallClimb: false,
      walkSpeedPxPerSec: 24,
      runSpeedPxPerSec: 58,
      cheerBubbles: ["Meow", "♥", "★", "~"],
      workBubbles: ["purr", "</>", "🐾"],
    },
  },
  {
    id: "bot",
    name: "Bender",
    pixelSize: 2,
    palette: BOT_PALETTE,
    frames: {
      idle: [BOT_IDLE_0, BOT_IDLE_1, BOT_IDLE_0,
        BOT_IDLE_0.map((row) => row === "...KYKYKKYKYK..." ? "...KKYYKKKYYK..." : row)],
      walk: [BOT_WALK_0, BOT_WALK_1],
      run: [BOT_WALK_0, BOT_WALK_1],
      jump: [BOT_JUMP],
      celebrate: [BOT_JUMP],
      sleep: [BOT_SLEEP],
      alert: [BOT_JUMP],
    },
    frameDurationsMs: {
      walk: 155,
      run: 95,
    },
    behavior: {
      ...DEFAULT_PET_BEHAVIOR,
      allowWallClimb: false,
      walkSpeedPxPerSec: 30,
      runSpeedPxPerSec: 60,
      enableRandomEvents: true,
      cheerBubbles: ["BITE", "40%", "HA!", "COOL"],
      workBubbles: ["BEER", "101", "⚡"],
    },
  },
  {
    id: "daimao",
    name: "Daimao",
    pixelSize: 2,
    palette: DAIMAO_PALETTE,
    frames: {
      idle: DAIMAO_FRAMES.idle,
      walk: DAIMAO_FRAMES.walk,
      run: DAIMAO_FRAMES.run,
      jump: DAIMAO_FRAMES.jump,
      sleep: DAIMAO_FRAMES.sleep,
      celebrate: DAIMAO_FRAMES.celebrate,
      alert: DAIMAO_FRAMES.alert,
    },
    clips: DAIMAO_FRAMES,
    frameTimingsMs: {
      idle: [460, 420],
      land: [70, 120],
      celebrate: [220, 180, 200, 220],
    },
    frameDurationsMs: {
      idle: 440,
      walk: 145,
      run: 95,
      jump: 200,
      fall: 160,
      crouch: 90,
      land: 95,
      turn: 110,
      stop: 120,
      edgeLook: 300,
      sleep: 650,
      celebrate: 200,
      alert: 220,
    },
    behavior: {
      ...DEFAULT_PET_BEHAVIOR,
      allowWallClimb: false,
      walkSpeedPxPerSec: 26,
      runSpeedPxPerSec: 54,
      cheerBubbles: ["Woof!", "♥", "★", ":3"],
      workBubbles: ["...", "</>", "🐾"],
    },
  },
];

export const DEFAULT_PIXEL_PET_CONFIG: PixelPetConfig =
  PIXEL_PET_PRESETS.find((preset) => preset.id === "hero") ?? PIXEL_PET_PRESETS[0];

const ACTION_KEYS: PetActionState[] = [
  "idle",
  "walk",
  "run",
  "jump",
  "sleep",
  "celebrate",
  "alert",
];

const CLIP_KEYS: PetClipId[] = [
  ...ACTION_KEYS,
  "fall",
  "crouch",
  "land",
  "turn",
  "stop",
  "edgeLook",
  "wallGrab",
  "climb",
  "wallHang",
  "wallJump",
];

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function parseFrameTimings(value: unknown): PixelPetConfig["frameTimingsMs"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: NonNullable<PixelPetConfig["frameTimingsMs"]> = {};
  for (const key of CLIP_KEYS) {
    const durations = (value as Record<string, unknown>)[key];
    if (Array.isArray(durations) && durations.length > 0
      && durations.every((duration) => typeof duration === "number" && Number.isFinite(duration) && duration >= 40 && duration <= 10000)) {
      result[key] = durations.slice(0, 128);
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function sanitizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const filtered = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 12));
  return filtered.length > 0 ? filtered : [...fallback];
}

function isValidFrame(frame: unknown): frame is string[] {
  return (
    Array.isArray(frame)
    && frame.length > 0
    && frame.length <= 32
    && frame.every((row) => typeof row === "string" && row.length > 0 && row.length <= 32)
  );
}

/**
 * Parse and validate a user or AI-generated PixelPetConfig JSON string.
 */
export function parsePixelPetConfigJson(
  rawJson: string,
): { ok: true; config: PixelPetConfig } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid JSON",
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "Config must be a JSON object." };
  }

  const record = parsed as Record<string, unknown>;
  const rawPalette = record.palette;
  if (!rawPalette || typeof rawPalette !== "object" || Array.isArray(rawPalette)) {
    return { ok: false, error: "Missing palette object." };
  }

  const palette: Record<string, string> = {};
  for (const [key, val] of Object.entries(rawPalette as Record<string, unknown>)) {
    if (key.length === 1 && typeof val === "string" && val.trim().length > 0) {
      palette[key] = val.trim();
    }
  }
  if (Object.keys(palette).length === 0) {
    return { ok: false, error: "Palette must define at least one single-character color entry." };
  }

  const rawFrames = record.frames;
  if (!rawFrames || typeof rawFrames !== "object" || Array.isArray(rawFrames)) {
    return { ok: false, error: "Missing frames object." };
  }

  const frameMap = rawFrames as Record<string, unknown>;
  const rawIdle = Array.isArray(frameMap.idle) ? frameMap.idle.filter(isValidFrame) : [];
  const rawWalk = Array.isArray(frameMap.walk) ? frameMap.walk.filter(isValidFrame) : [];
  if (rawIdle.length === 0 && rawWalk.length === 0) {
    return { ok: false, error: "frames.idle or frames.walk must contain at least one pixel grid." };
  }

  const fallbackIdle = rawIdle.length > 0 ? rawIdle : rawWalk;
  const fallbackWalk = rawWalk.length > 0 ? rawWalk : fallbackIdle;

  const frames = {} as Record<PetActionState, string[][]>;
  for (const action of ACTION_KEYS) {
    const candidate = frameMap[action];
    const valid = Array.isArray(candidate) ? candidate.filter(isValidFrame) : [];
    if (valid.length > 0) {
      frames[action] = valid;
    } else if (action === "walk" || action === "run") {
      frames[action] = fallbackWalk;
    } else {
      frames[action] = fallbackIdle;
    }
  }

  let clips: Partial<Record<PetClipId, string[][]>> | undefined;
  const rawClips = record.clips;
  if (rawClips && typeof rawClips === "object" && !Array.isArray(rawClips)) {
    const clipMap = rawClips as Record<string, unknown>;
    const parsedClips: Partial<Record<PetClipId, string[][]>> = {};
    for (const clipKey of CLIP_KEYS) {
      const candidate = clipMap[clipKey];
      const valid = Array.isArray(candidate) ? candidate.filter(isValidFrame) : [];
      if (valid.length > 0) {
        parsedClips[clipKey] = valid;
      }
    }
    if (Object.keys(parsedClips).length > 0) {
      clips = parsedClips;
    }
  }

  const rawBehavior =
    record.behavior && typeof record.behavior === "object" && !Array.isArray(record.behavior)
      ? (record.behavior as Record<string, unknown>)
      : {};

  const hasWallFrames = Boolean(clips?.wallGrab?.length && clips?.climb?.length);
  const behavior: PixelPetBehaviorConfig = {
    walkSpeedPxPerSec: clampNumber(
      rawBehavior.walkSpeedPxPerSec,
      DEFAULT_PET_BEHAVIOR.walkSpeedPxPerSec,
      8,
      140,
    ),
    runSpeedPxPerSec: clampNumber(
      rawBehavior.runSpeedPxPerSec,
      DEFAULT_PET_BEHAVIOR.runSpeedPxPerSec,
      12,
      220,
    ),
    jumpVelocityPxPerSec: clampNumber(
      rawBehavior.jumpVelocityPxPerSec,
      DEFAULT_PET_BEHAVIOR.jumpVelocityPxPerSec,
      60,
      360,
    ),
    gravityPxPerSec2: clampNumber(
      rawBehavior.gravityPxPerSec2,
      DEFAULT_PET_BEHAVIOR.gravityPxPerSec2,
      200,
      1600,
    ),
    sleepAfterIdleMs: clampNumber(
      rawBehavior.sleepAfterIdleMs,
      DEFAULT_PET_BEHAVIOR.sleepAfterIdleMs,
      2000,
      120_000,
    ),
    allowPlatformHop:
      typeof rawBehavior.allowPlatformHop === "boolean"
        ? rawBehavior.allowPlatformHop
        : DEFAULT_PET_BEHAVIOR.allowPlatformHop,
    allowWallClimb:
      typeof rawBehavior.allowWallClimb === "boolean"
        ? rawBehavior.allowWallClimb
        : hasWallFrames,
    reactToCodingMood:
      typeof rawBehavior.reactToCodingMood === "boolean"
        ? rawBehavior.reactToCodingMood
        : DEFAULT_PET_BEHAVIOR.reactToCodingMood,
    enableRandomEvents:
      typeof rawBehavior.enableRandomEvents === "boolean"
        ? rawBehavior.enableRandomEvents
        : DEFAULT_PET_BEHAVIOR.enableRandomEvents,
    cheerBubbles: sanitizeStringArray(rawBehavior.cheerBubbles, DEFAULT_PET_BEHAVIOR.cheerBubbles),
    workBubbles: sanitizeStringArray(rawBehavior.workBubbles, DEFAULT_PET_BEHAVIOR.workBubbles),
  };

  const config: PixelPetConfig = {
    id:
      typeof record.id === "string" && record.id.trim().length > 0
        ? record.id.trim().slice(0, 32)
        : "custom",
    name:
      typeof record.name === "string" && record.name.trim().length > 0
        ? record.name.trim().slice(0, 48)
        : "Custom Pixel Pet",
    pixelSize: Math.round(clampNumber(record.pixelSize, 2, 1, 4)),
    submergeRows:
      typeof record.submergeRows === "number"
        ? Math.round(clampNumber(record.submergeRows, 0, 0, 12))
        : undefined,
    palette,
    frames,
    clips,
    frameTimingsMs: parseFrameTimings(record.frameTimingsMs),
    frameDurationsMs:
      record.frameDurationsMs && typeof record.frameDurationsMs === "object"
        ? (record.frameDurationsMs as Partial<Record<PetActionState | PetClipId, number>>)
        : undefined,
    behavior,
  };

  return { ok: true, config };
}

/**
 * Sync persisted preset configurations with the latest built-in frames and clips,
 * while preserving user-tuned behavior parameters and custom pet configs.
 */
export function upgradePersistedPixelPetConfig(
  persisted: PixelPetConfig | null | undefined,
): PixelPetConfig {
  if (!persisted || typeof persisted !== "object") {
    return DEFAULT_PIXEL_PET_CONFIG;
  }
  const builtIn = PIXEL_PET_PRESETS.find((preset) => preset.id === persisted.id);
  if (!builtIn) {
    return persisted;
  }
  return {
    ...builtIn,
    pixelSize: persisted.pixelSize ?? builtIn.pixelSize,
    behavior: {
      ...builtIn.behavior,
      ...persisted.behavior,
      allowWallClimb:
        typeof persisted.behavior?.allowWallClimb === "boolean"
          ? persisted.behavior.allowWallClimb
          : builtIn.behavior.allowWallClimb,
    },
  };
}

/**
 * Generate a prompt template users can give to any AI to design new pixel pets & behavior JSON.
 */
export function buildPixelPetAiPrompt(baseConfig: PixelPetConfig, filePath?: string): string {
  return [
    "请帮我创作 Krosna 像素角色：可以改造当前角色，也可以设计全新角色。",
    filePath ? `角色配置文件：${JSON.stringify(filePath)}` : "请读取我附上的角色 JSON 文件。",
    filePath ? `格式说明文件：${JSON.stringify(`${filePath}.guide.md`)}` : "请同时阅读附上的格式说明。",
    `当前角色名称：${JSON.stringify(baseConfig.name)}。先读取文件，再根据我的要求修改 palette、frames、clips 和 behavior。`,
    "直接保存纯 JSON，保留未要求修改的内容；Krosna 会自动校验并刷新预览。若另存为新文件，请告诉我路径，我会在设置中加载它。",
    "如果无法访问本机文件，请让我附上配置和格式说明，并返回完整 JSON 文件。",
    "我的要求：［在这里描述新角色或修改内容］",
  ].join("\n");
}

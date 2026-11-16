import type { Session } from "@/types";
import type { PixelPetBehaviorConfig } from "./pixelPetConfig";

export type PetActionState =
  | "idle"
  | "walk"
  | "run"
  | "jump"
  | "sleep"
  | "celebrate"
  | "alert";

export type PetCodingMood = "idle" | "working" | "completed" | "error";

export type PetClipId = PetActionState | "crouch" | "fall" | "land" | "turn" | "stop"
  | "edgeLook" | "wallGrab" | "climb" | "wallHang" | "wallJump";

export interface PetPlatform {
  id: string;
  minX: number;
  maxX: number;
  groundY: number;
}

export interface PetBubble {
  text: string;
  remainingMs: number;
}

export type PetEncounterKind = "slime" | "ghost" | "star";

export interface PetEncounterEntity {
  kind: PetEncounterKind;
  x: number;
  y: number;
  phase: "active" | "defeated";
  remainingMs: number;
  facing: 1 | -1;
}

export interface PetSimulationState {
  x: number;
  y: number;
  vy: number;
  facing: 1 | -1;
  platformId: string;
  groundY: number;
  platformStayMs: number;
  action: PetActionState;
  actionTimerMs: number;
  idleAccumulatedMs: number;
  animElapsedMs: number;
  clip: PetClipId;
  clipElapsedMs: number;
  transitionMs: number;
  pendingFacing: 1 | -1 | null;
  motionElapsedMs: number;
  targetX: number | null;
  paused: boolean;
  bubble: PetBubble | null;
  lastMood: PetCodingMood;
  encounter: PetEncounterEntity | null;
  nextEncounterCooldownMs: number;
}

export interface PetStepOptions {
  random?: () => number;
  platforms?: readonly PetPlatform[];
  behavior?: Partial<PixelPetBehaviorConfig>;
  spriteWidth?: number;
}

export const PET_SPRITE_LOGICAL_SIZE = 32;
export const PET_TRACK_PADDING_X = 20;
const WALK_SPEED_PX_PER_SEC = 28;
const RUN_SPEED_PX_PER_SEC = 54;
const JUMP_VELOCITY_PX_PER_SEC = 185;
const GRAVITY_PX_PER_SEC2 = 720;
const SLEEP_AFTER_IDLE_MS = 10_000;
const MIN_PLATFORM_STAY_MS = 15_000;
const MAX_PLATFORM_STAY_MS = 28_000;
const MIN_ENCOUNTER_COOLDOWN_MS = 24_000;
const MAX_ENCOUNTER_COOLDOWN_MS = 44_000;
const ENCOUNTER_ENTITY_SIZE = 18;

const CHEER_BUBBLES = ["!", "+1", "★", "GO!", ":)"];
const WORK_BUBBLES = ["</>", "...", "RUN", "⚡"];
const ENCOUNTER_VICTORY_BUBBLES = ["WIN!", "NICE!", "FIXED!", "★"];

function resolveActivePlatform(
  platformId: string,
  boundsWidth: number,
  platforms?: readonly PetPlatform[],
): PetPlatform {
  if (platforms && platforms.length > 0) {
    const matched = platforms.find((p) => p.id === platformId && p.maxX - p.minX >= PET_SPRITE_LOGICAL_SIZE);
    if (matched) return matched;
    const firstValid = platforms.find((p) => p.maxX - p.minX >= PET_SPRITE_LOGICAL_SIZE);
    if (firstValid) return firstValid;
  }
  const minX = PET_TRACK_PADDING_X;
  const maxX = Math.max(minX + PET_SPRITE_LOGICAL_SIZE, boundsWidth - PET_TRACK_PADDING_X);
  return {
    id: "statusbar",
    minX,
    maxX,
    groundY: 0,
  };
}

function clampXOnPlatform(x: number, platform: PetPlatform): number {
  const maxOriginX = Math.max(platform.minX, platform.maxX - PET_SPRITE_LOGICAL_SIZE);
  return Math.max(platform.minX, Math.min(maxOriginX, x));
}

/**
 * Derive the pet's coding mood from current workspace sessions.
 */
export function derivePetCodingMood(
  sessions: readonly Session[],
  activeSessionId: string | null,
): PetCodingMood {
  const activeSession = activeSessionId
    ? sessions.find((session) => session.id === activeSessionId) ?? null
    : null;

  if (activeSession?.status === "error") {
    return "error";
  }
  if (activeSession?.status === "starting" || activeSession?.status === "running") {
    return "working";
  }

  let hasWorking = false;
  let hasError = false;
  for (const session of sessions) {
    if (!session.active) continue;
    if (session.status === "starting" || session.status === "running") {
      hasWorking = true;
    } else if (session.status === "error") {
      hasError = true;
    }
  }

  if (hasWorking) return "working";
  if (hasError) return "error";
  if (activeSession?.status === "completed") return "completed";
  return "idle";
}

/**
 * Create the initial pet simulation state for a given track width or platform list.
 */
export function createInitialPetSimulation(
  boundsWidth: number,
  platforms?: readonly PetPlatform[],
): PetSimulationState {
  const platform = resolveActivePlatform("statusbar", boundsWidth, platforms);
  const maxOriginX = Math.max(platform.minX, platform.maxX - PET_SPRITE_LOGICAL_SIZE);
  const startX = Math.round(platform.minX + (maxOriginX - platform.minX) * 0.25);
  return {
    x: clampXOnPlatform(startX, platform),
    y: 0,
    vy: 0,
    facing: 1,
    platformId: platform.id,
    groundY: platform.groundY,
    platformStayMs: 18_000,
    action: "walk",
    actionTimerMs: 4200,
    idleAccumulatedMs: 0,
    animElapsedMs: 0,
    clip: "walk",
    clipElapsedMs: 0,
    transitionMs: 0,
    pendingFacing: null,
    motionElapsedMs: 0,
    targetX: null,
    paused: false,
    bubble: null,
    lastMood: "idle",
    encounter: null,
    nextEncounterCooldownMs: 26_000,
  };
}

/**
 * Spawn a random pixel easter-egg encounter (slime, ghost, or falling star) on the current platform.
 */
export function spawnPetEncounter(
  state: PetSimulationState,
  boundsWidth: number,
  platforms?: readonly PetPlatform[],
  random: () => number = Math.random,
  kindOverride?: PetEncounterKind,
): PetSimulationState {
  const platform = resolveActivePlatform(state.platformId, boundsWidth, platforms);
  const span = Math.max(40, platform.maxX - platform.minX - ENCOUNTER_ENTITY_SIZE);
  const petCenter = state.x + PET_SPRITE_LOGICAL_SIZE / 2;
  const platformMid = platform.minX + span / 2;

  // Place the encounter on the opposite side of the platform so the pet walks/runs over to it.
  const spawnLeft = petCenter > platformMid;
  const offsetRatio = 0.1 + random() * 0.25;
  const spawnX = spawnLeft
    ? Math.round(platform.minX + span * offsetRatio)
    : Math.round(platform.minX + span * (1 - offsetRatio));

  const kinds: PetEncounterKind[] = ["slime", "ghost", "star"];
  const kind = kindOverride ?? kinds[Math.floor(random() * kinds.length)] ?? "slime";

  return {
    ...state,
    paused: false,
    targetX: null,
    encounter: {
      kind,
      x: Math.max(platform.minX, Math.min(platform.maxX - ENCOUNTER_ENTITY_SIZE, spawnX)),
      y: kind === "star" ? 28 : 0,
      phase: "active",
      remainingMs: 12_000,
      facing: spawnX < state.x ? 1 : -1,
    },
    bubble: kind === "star" ? { text: "★?", remainingMs: 1200 } : { text: "!", remainingMs: 1200 },
  };
}

/**
 * Trigger a jump and optional pixel speech bubble on the pet.
 */
export function triggerPetJump(
  state: PetSimulationState,
  bubbleText?: string,
  random: () => number = Math.random,
  behavior?: Partial<PixelPetBehaviorConfig>,
): PetSimulationState {
  const cheerBubbles = behavior?.cheerBubbles && behavior.cheerBubbles.length > 0
    ? behavior.cheerBubbles
    : CHEER_BUBBLES;
  const jumpVelocity = behavior?.jumpVelocityPxPerSec ?? JUMP_VELOCITY_PX_PER_SEC;
  const nextBubbleText =
    bubbleText ?? cheerBubbles[Math.floor(random() * cheerBubbles.length)] ?? "!";
  return {
    ...state,
    vy: state.y === 0 ? jumpVelocity : Math.max(state.vy, jumpVelocity * 0.8),
    action: "jump",
    clip: state.y === 0 ? "crouch" : "jump",
    clipElapsedMs: 0,
    transitionMs: state.y === 0 ? 100 : 0,
    pendingFacing: null,
    actionTimerMs: 650,
    idleAccumulatedMs: 0,
    paused: false,
    bubble: {
      text: nextBubbleText,
      remainingMs: 1600,
    },
  };
}

/**
 * Hop the pet to another available platform (e.g. from statusbar to titlebar blank space).
 */
export function hopPetToPlatform(
  state: PetSimulationState,
  targetPlatform: PetPlatform,
  random: () => number = Math.random,
): PetSimulationState {
  const maxOriginX = Math.max(targetPlatform.minX, targetPlatform.maxX - PET_SPRITE_LOGICAL_SIZE);
  const ratio = 0.2 + random() * 0.6;
  const nextX = Math.round(targetPlatform.minX + (maxOriginX - targetPlatform.minX) * ratio);
  return {
    ...state,
    platformId: targetPlatform.id,
    groundY: targetPlatform.groundY,
    platformStayMs:
      MIN_PLATFORM_STAY_MS + Math.floor(random() * (MAX_PLATFORM_STAY_MS - MIN_PLATFORM_STAY_MS)),
    x: clampXOnPlatform(nextX, targetPlatform),
    y: 10,
    vy: JUMP_VELOCITY_PX_PER_SEC * 0.72,
    action: "jump",
    clip: "jump",
    clipElapsedMs: 0,
    transitionMs: 0,
    pendingFacing: null,
    motionElapsedMs: 0,
    actionTimerMs: 900,
    idleAccumulatedMs: 0,
    targetX: null,
    paused: false,
    bubble: {
      text: "★",
      remainingMs: 1200,
    },
  };
}

/**
 * Direct the pet to walk toward a clicked X coordinate on the current platform.
 */
export function setPetWalkTarget(
  state: PetSimulationState,
  clickX: number,
  boundsWidth: number,
  platforms?: readonly PetPlatform[],
): PetSimulationState {
  const platform = resolveActivePlatform(state.platformId, boundsWidth, platforms);
  const targetX = clampXOnPlatform(clickX - PET_SPRITE_LOGICAL_SIZE / 2, platform);
  const facing: 1 | -1 = targetX >= state.x ? 1 : -1;
  return {
    ...state,
    targetX,
    facing: state.facing,
    pendingFacing: facing !== state.facing ? facing : null,
    clip: facing !== state.facing ? "turn" : "walk",
    clipElapsedMs: 0,
    transitionMs: facing !== state.facing ? 120 : 0,
    motionElapsedMs: 0,
    action: Math.abs(targetX - state.x) > 120 ? "run" : "walk",
    actionTimerMs: 5000,
    idleAccumulatedMs: 0,
    paused: false,
  };
}

/**
 * Toggle pause/rest mode for the pet.
 */
export function togglePetPaused(state: PetSimulationState): PetSimulationState {
  const nextPaused = !state.paused;
  return {
    ...state,
    paused: nextPaused,
    vy: nextPaused && state.y === 0 ? 0 : state.vy,
    action: nextPaused ? "sleep" : "walk",
    clip: nextPaused ? "sleep" : "walk",
    clipElapsedMs: 0,
    transitionMs: 0,
    pendingFacing: null,
    motionElapsedMs: 0,
    actionTimerMs: nextPaused ? 60_000 : 3500,
    targetX: null,
    bubble: nextPaused ? { text: "Zzz", remainingMs: 2200 } : { text: "GO!", remainingMs: 1200 },
  };
}

/**
 * Advance the pet simulation by `dtMs` milliseconds.
 */
export function stepPetSimulation(
  prev: PetSimulationState,
  dtMs: number,
  boundsWidth: number,
  mood: PetCodingMood,
  options?: PetStepOptions,
): PetSimulationState {
  const dt = Number.isFinite(dtMs) ? Math.max(0, Math.min(dtMs, 100)) : 0;
  // 过渡期间保留动作意图，播完后才执行转向、起跳或继续行走。
  if (prev.transitionMs > 0 && !prev.paused) {
    const platform = resolveActivePlatform(prev.platformId, boundsWidth, options?.platforms);
    const maxX = Math.max(platform.minX, platform.maxX - (options?.spriteWidth ?? PET_SPRITE_LOGICAL_SIZE));
    const held = {
      ...prev,
      x: Math.max(platform.minX, Math.min(maxX, prev.x)),
      groundY: platform.groundY,
      transitionMs: Math.max(0, prev.transitionMs - dt),
      clipElapsedMs: prev.clipElapsedMs + dt,
      animElapsedMs: prev.animElapsedMs + dt,
      bubble: prev.bubble && prev.bubble.remainingMs > dt
        ? { ...prev.bubble, remainingMs: prev.bubble.remainingMs - dt } : null,
      encounter: options?.behavior?.enableRandomEvents === false ? null : prev.encounter,
    };
    if (held.transitionMs === 0) {
      if (prev.clip === "edgeLook") {
        return { ...held, clip: "turn", clipElapsedMs: 0, transitionMs: 120 };
      }
      return {
        ...held, facing: prev.pendingFacing ?? prev.facing, pendingFacing: null,
        clip: prev.action, clipElapsedMs: 0, motionElapsedMs: 0,
      };
    }
    return held;
  }

  // 起步逐渐加速；临近边缘收步，避免匀速撞墙再瞬间反弹。
  const moving = prev.action === "walk" || prev.action === "run";
  const platform = resolveActivePlatform(prev.platformId, boundsWidth, options?.platforms);
  const maxX = Math.max(platform.minX, platform.maxX - (options?.spriteWidth ?? PET_SPRITE_LOGICAL_SIZE));
  const distance = prev.facing === 1 ? maxX - prev.x : prev.x - platform.minX;
  const ramp = Math.min(1, 0.25 + prev.motionElapsedMs / 220);
  const remaining = prev.targetX === null ? distance : Math.abs(prev.targetX - prev.x);
  const brake = prev.y === 0 ? Math.min(1, Math.max(0.25, remaining / 16)) : 1;
  const speedScale = moving ? ramp * brake : 1;
  const next = advancePetBehavior(prev, dt, boundsWidth, mood, {
    ...options,
    behavior: {
      ...options?.behavior,
      walkSpeedPxPerSec: (options?.behavior?.walkSpeedPxPerSec ?? WALK_SPEED_PX_PER_SEC) * speedScale,
      runSpeedPxPerSec: (options?.behavior?.runSpeedPxPerSec ?? RUN_SPEED_PX_PER_SEC) * speedScale,
    },
  });
  next.motionElapsedMs = moving && next.action === prev.action ? prev.motionElapsedMs + dt : 0;
  if (next.clip === "crouch" && next.transitionMs > 0) {
    // 完成通知等行为内部触发的跳跃也要先蓄力。
    next.y = 0;
    next.x = prev.x;
    return next;
  }
  let clip: PetClipId = next.action;
  let holdMs = 0;
  if (!next.paused && prev.y > 0 && next.y === 0) {
    clip = "land";
    holdMs = 190;
  } else if (!next.paused && next.y === 0 && next.facing !== prev.facing) {
    clip = next.x <= platform.minX || next.x >= maxX ? "edgeLook" : "turn";
    holdMs = clip === "edgeLook" ? 420 : 120;
    next.pendingFacing = next.facing;
    next.facing = prev.facing;
  } else if (!next.paused && next.y > 0 && next.action !== "celebrate") {
    clip = next.vy > 0 ? "jump" : "fall";
  } else if (!next.paused && moving && next.action === "idle") {
    clip = "stop";
    holdMs = 120;
  }
  next.clip = clip;
  next.transitionMs = holdMs;
  next.clipElapsedMs = clip === prev.clip ? prev.clipElapsedMs + dt : 0;
  return next;
}

function advancePetBehavior(
  prev: PetSimulationState,
  dtMs: number,
  boundsWidth: number,
  mood: PetCodingMood,
  options?: PetStepOptions,
): PetSimulationState {
  const random = options?.random ?? Math.random;
  const behavior = options?.behavior;
  const walkSpeed = behavior?.walkSpeedPxPerSec ?? WALK_SPEED_PX_PER_SEC;
  const runSpeed = behavior?.runSpeedPxPerSec ?? RUN_SPEED_PX_PER_SEC;
  const gravity = behavior?.gravityPxPerSec2 ?? GRAVITY_PX_PER_SEC2;
  const sleepAfterIdleMs = behavior?.sleepAfterIdleMs ?? SLEEP_AFTER_IDLE_MS;
  const allowPlatformHop = behavior?.allowPlatformHop ?? true;
  const reactToCodingMood = behavior?.reactToCodingMood ?? true;
  const enableRandomEvents = behavior?.enableRandomEvents ?? true;
  const effectiveMood: PetCodingMood = reactToCodingMood ? mood : "idle";
  const workBubbles = behavior?.workBubbles && behavior.workBubbles.length > 0
    ? behavior.workBubbles
    : WORK_BUBBLES;
  const spriteWidth = options?.spriteWidth ?? PET_SPRITE_LOGICAL_SIZE;

  const clampedDtMs = Math.max(0, Math.min(dtMs, 100));
  const dtSec = clampedDtMs / 1000;
  const platform = resolveActivePlatform(prev.platformId, boundsWidth, options?.platforms);
  const minX = platform.minX;
  const maxX = Math.max(minX, platform.maxX - spriteWidth);

  let next: PetSimulationState = {
    ...prev,
    platformId: platform.id,
    groundY: platform.groundY,
    x: Math.max(minX, Math.min(maxX, prev.x)),
    animElapsedMs: prev.animElapsedMs + clampedDtMs,
    platformStayMs: prev.platformStayMs - clampedDtMs,
    nextEncounterCooldownMs: Math.max(0, prev.nextEncounterCooldownMs - clampedDtMs),
    bubble: prev.bubble
      ? prev.bubble.remainingMs > clampedDtMs
        ? { ...prev.bubble, remainingMs: prev.bubble.remainingMs - clampedDtMs }
        : null
      : null,
  };

  if (!enableRandomEvents) {
    next.encounter = null;
  } else if (!next.paused && !next.encounter && next.nextEncounterCooldownMs <= 0 && platform.maxX - platform.minX >= spriteWidth * 3) {
    next = spawnPetEncounter(next, boundsWidth, options?.platforms, random);
    next.nextEncounterCooldownMs =
      MIN_ENCOUNTER_COOLDOWN_MS + Math.floor(random() * (MAX_ENCOUNTER_COOLDOWN_MS - MIN_ENCOUNTER_COOLDOWN_MS));
  }

  // React to coding mood transitions.
  if (effectiveMood !== prev.lastMood) {
    next.lastMood = effectiveMood;
    if (!next.paused) {
      if (effectiveMood === "working") {
        next.action = "run";
        next.actionTimerMs = 3200;
        next.idleAccumulatedMs = 0;
        next.bubble = {
          text: workBubbles[Math.floor(random() * workBubbles.length)] ?? "</>",
          remainingMs: 1800,
        };
      } else if (effectiveMood === "completed" && prev.lastMood === "working") {
        next = triggerPetJump(next, "OK!", random, behavior);
        next.action = "celebrate";
        next.actionTimerMs = 1100;
        next.lastMood = effectiveMood;
      } else if (effectiveMood === "error") {
        next.action = "alert";
        next.actionTimerMs = 1600;
        next.idleAccumulatedMs = 0;
        next.bubble = { text: "!?", remainingMs: 2200 };
      }
    }
  }

  // Vertical jump physics runs even if transitioning back to ground.
  if (next.y > 0 || next.vy !== 0) {
    next.y = next.y + next.vy * dtSec;
    next.vy = next.vy - gravity * dtSec;
    if (next.y <= 0) {
      next.y = 0;
      next.vy = 0;
      if (next.action === "jump" || next.action === "celebrate") {
        next.action = next.paused ? "sleep" : effectiveMood === "working" ? "run" : "walk";
        next.actionTimerMs = 3000;
      }
    }
  }

  if (next.paused) {
    next.action = "sleep";
    return next;
  }

  // Handle click-to-walk target.
  if (next.targetX !== null) {
    const clampedTarget = Math.max(minX, Math.min(maxX, next.targetX));
    const delta = clampedTarget - next.x;
    if (Math.abs(delta) <= 3) {
      next.x = clampedTarget;
      next.targetX = null;
      next.action = "idle";
      next.actionTimerMs = 1400;
      return next;
    }
    const dir: 1 | -1 = delta >= 0 ? 1 : -1;
    const speed = Math.abs(delta) > 90 ? runSpeed : walkSpeed;
    next.facing = dir;
    next.action = speed === runSpeed ? "run" : "walk";
    next.x = Math.max(minX, Math.min(maxX, next.x + dir * speed * dtSec));
    return next;
  }

  // Handle active easter-egg encounter (monster / falling star).
  if (next.encounter) {
    const enc = { ...next.encounter };
    enc.remainingMs -= clampedDtMs;

    if (enc.phase === "defeated") {
      if (enc.remainingMs <= 0) {
        next.encounter = null;
      } else {
        next.encounter = enc;
      }
    } else if (enc.remainingMs <= 0) {
      next.encounter = null;
    } else {
      if (enc.kind === "star" && enc.y > 0) {
        enc.y = Math.max(0, enc.y - 18 * dtSec);
      } else if (enc.kind === "slime") {
        // Gentle idle hop/wiggle in place
        const wobble = Math.sin(next.animElapsedMs / 240) * 6 * dtSec;
        enc.x = Math.max(platform.minX, Math.min(platform.maxX - ENCOUNTER_ENTITY_SIZE, enc.x + wobble));
      }

      const petCenter = next.x + spriteWidth / 2;
      const encCenter = enc.x + ENCOUNTER_ENTITY_SIZE / 2;
      const dist = encCenter - petCenter;

      if (Math.abs(dist) <= 18 && enc.y <= 10) {
        if (enc.kind === "star") {
          next.encounter = null;
          next = triggerPetJump(next, "★", random, behavior);
        } else {
          enc.phase = "defeated";
          enc.remainingMs = 520;
          next.encounter = enc;
          const winText =
            ENCOUNTER_VICTORY_BUBBLES[Math.floor(random() * ENCOUNTER_VICTORY_BUBBLES.length)] ?? "WIN!";
          next = triggerPetJump(next, winText, random, behavior);
          next.action = "celebrate";
          next.actionTimerMs = 650;
        }
        return next;
      }

      const dir: 1 | -1 = dist >= 0 ? 1 : -1;
      next.facing = dir;
      next.action = "run";
      next.x = Math.max(minX, Math.min(maxX, next.x + dir * runSpeed * dtSec));
      next.encounter = enc;
      return next;
    }
  }

  // Occasionally hop to another available blank surface (e.g. titlebar blank zone <-> statusbar line).
  if (
    allowPlatformHop
    && next.platformStayMs <= 0
    && next.y === 0
    && options?.platforms
    && options.platforms.length > 1
  ) {
    const candidates = options.platforms.filter(
      (p) => p.id !== next.platformId && p.maxX - p.minX >= spriteWidth * 2,
    );
    if (candidates.length > 0) {
      const target = candidates[Math.floor(random() * candidates.length)];
      if (target) {
        return hopPetToPlatform(next, target, random);
      }
    }
    next.platformStayMs = MIN_PLATFORM_STAY_MS;
  }

  // Horizontal movement during walk / run / airborne.
  if (next.action === "walk" || next.action === "run" || next.y > 0) {
    const speed = next.action === "run" ? runSpeed : walkSpeed;
    const candidateX = next.x + next.facing * speed * dtSec;
    if (candidateX <= minX) {
      next.x = minX;
      next.facing = 1;
    } else if (candidateX >= maxX) {
      next.x = maxX;
      next.facing = -1;
    } else {
      next.x = candidateX;
    }
  }

  // State machine timer transitions.
  next.actionTimerMs -= clampedDtMs;
  if (next.action === "idle") {
    next.idleAccumulatedMs += clampedDtMs;
  } else if (next.action !== "sleep") {
    next.idleAccumulatedMs = 0;
  }

  if (next.actionTimerMs <= 0 && next.y === 0) {
    if (effectiveMood === "working") {
      const shouldRun = random() < 0.65;
      next.action = shouldRun ? "run" : "walk";
      next.actionTimerMs = 2400 + Math.floor(random() * 2600);
      if (random() < 0.25) {
        next.facing = next.facing === 1 ? -1 : 1;
      }
      if (!next.bubble && random() < 0.22) {
        next.bubble = {
          text: workBubbles[Math.floor(random() * workBubbles.length)] ?? "</>",
          remainingMs: 1500,
        };
      }
    } else if (next.action === "walk" || next.action === "run" || next.action === "alert") {
      if (random() < 0.55) {
        next.action = "idle";
        next.actionTimerMs = 1500 + Math.floor(random() * 2200);
      } else {
        if (random() < 0.35) {
          next.facing = next.facing === 1 ? -1 : 1;
        }
        next.action = "walk";
        next.actionTimerMs = 2800 + Math.floor(random() * 3400);
      }
    } else if (next.action === "idle") {
      if (next.idleAccumulatedMs >= sleepAfterIdleMs && random() < 0.6) {
        next.action = "sleep";
        next.actionTimerMs = 5000 + Math.floor(random() * 4000);
        next.bubble = { text: "Zzz", remainingMs: 2200 };
      } else {
        if (random() < 0.4) {
          next.facing = next.facing === 1 ? -1 : 1;
        }
        next.action = "walk";
        next.actionTimerMs = 3000 + Math.floor(random() * 3800);
      }
    } else if (next.action === "sleep") {
      next.action = "walk";
      next.idleAccumulatedMs = 0;
      next.actionTimerMs = 3200 + Math.floor(random() * 3200);
    }
  }

  return next;
}

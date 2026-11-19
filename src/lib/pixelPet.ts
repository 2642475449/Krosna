import type { Session } from "@/types";
import type { PixelPetBehaviorConfig, PixelPetCapabilities } from "./pixelPetConfig";

export type PetActionState =
  | "idle"
  | "walk"
  | "run"
  | "jump"
  | "sleep"
  | "celebrate"
  | "alert";

export type PetCodingMood = "idle" | "working" | "completed" | "error";

export type PetClipId =
  | PetActionState
  | "crouch"
  | "fall"
  | "land"
  | "turn"
  | "stop"
  | "edgeLook"
  | "doze"
  | "wake"
  | "wallGrab"
  | "climb"
  | "wallHang"
  | "wallJump"
  | "easterEgg";

export type PetStandardEvent =
  | "click"
  | "work_start"
  | "work_complete"
  | "work_error"
  | "rest"
  | "wake"
  | "easter_egg"
  | "wall_climb"
  | "hop_platform";

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

export type PetClimbPhase = "grab" | "climb" | "hang" | "jump";

export interface PetClimbState {
  targetPlatformId: string;
  targetGroundY: number;
  targetX: number;
  phase: PetClimbPhase;
  phaseMs: number;
  side: "left" | "right";
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
  pendingAction: PetActionState | null;
  motionElapsedMs: number;
  targetX: number | null;
  paused: boolean;
  bubble: PetBubble | null;
  lastMood: PetCodingMood;
  lastEvent: PetStandardEvent | "auto" | null;
  easterEggRemainingMs: number;
  nextEasterEggCooldownMs: number;
  climb: PetClimbState | null;
}

export interface PetStepOptions {
  random?: () => number;
  platforms?: readonly PetPlatform[];
  behavior?: Partial<PixelPetBehaviorConfig>;
  capabilities?: Partial<PixelPetCapabilities>;
  spriteWidth?: number;
}

export const PET_SPRITE_LOGICAL_SIZE = 32;
export const PET_TRACK_PADDING_X = 20;
const WALK_SPEED_PX_PER_SEC = 28;
const RUN_SPEED_PX_PER_SEC = 54;
const CLIMB_SPEED_PX_PER_SEC = 76;
const JUMP_VELOCITY_PX_PER_SEC = 185;
const GRAVITY_PX_PER_SEC2 = 720;
const SLEEP_AFTER_IDLE_MS = 10_000;
const MIN_PLATFORM_STAY_MS = 15_000;
const MAX_PLATFORM_STAY_MS = 28_000;
const MIN_EASTER_EGG_COOLDOWN_MS = 22_000;
const MAX_EASTER_EGG_COOLDOWN_MS = 40_000;
const EASTER_EGG_DURATION_MS = 1_800;

function resolveActivePlatform(
  platformId: string,
  boundsWidth: number,
  platforms?: readonly PetPlatform[],
  spriteWidth = PET_SPRITE_LOGICAL_SIZE,
): PetPlatform {
  if (platforms && platforms.length > 0) {
    const matched = platforms.find((p) => p.id === platformId && p.maxX - p.minX >= spriteWidth);
    if (matched) return matched;
    const firstValid = platforms.find((p) => p.maxX - p.minX >= spriteWidth);
    if (firstValid) return firstValid;
  }
  const minX = PET_TRACK_PADDING_X;
  const maxX = Math.max(minX + spriteWidth, boundsWidth - PET_TRACK_PADDING_X);
  return {
    id: "statusbar",
    minX,
    maxX,
    groundY: 0,
  };
}

function clampXOnPlatform(x: number, platform: PetPlatform, spriteWidth = PET_SPRITE_LOGICAL_SIZE): number {
  const maxOriginX = Math.max(platform.minX, platform.maxX - spriteWidth);
  return Math.max(platform.minX, Math.min(maxOriginX, x));
}

function nextCooldown(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min));
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
    action: "idle",
    actionTimerMs: 5_000,
    idleAccumulatedMs: 0,
    animElapsedMs: 0,
    clip: "idle",
    clipElapsedMs: 0,
    transitionMs: 0,
    pendingFacing: null,
    pendingAction: null,
    motionElapsedMs: 0,
    targetX: null,
    paused: false,
    bubble: null,
    lastMood: "idle",
    lastEvent: null,
    easterEggRemainingMs: 0,
    nextEasterEggCooldownMs: 24_000,
    climb: null,
  };
}

function pickBubble(lines: readonly string[] | undefined, random: () => number, remainingMs: number): PetBubble | null {
  if (!lines?.length) return null;
  const text = lines[Math.floor(random() * lines.length)];
  return text ? { text, remainingMs } : null;
}

/** 点击和动作试演共用跳跃逻辑；调用方也可指定本次气泡的文字。 */
export function triggerPetJump(
  state: PetSimulationState,
  textOrBehavior?: string | Partial<PixelPetBehaviorConfig>,
  random: () => number = Math.random,
  behavior?: Partial<PixelPetBehaviorConfig>,
): PetSimulationState {
  if (typeof textOrBehavior === "object") behavior = textOrBehavior;
  const jumpVelocity = behavior?.jumpVelocityPxPerSec ?? JUMP_VELOCITY_PX_PER_SEC;
  const fromGround = state.y === 0 && !state.climb;
  return {
    ...state,
    climb: null,
    easterEggRemainingMs: 0,
    vy: state.y === 0 ? jumpVelocity : Math.max(state.vy, jumpVelocity * 0.8),
    action: "jump",
    clip: fromGround ? "crouch" : "jump",
    clipElapsedMs: 0,
    transitionMs: fromGround ? 100 : 0,
    pendingFacing: null,
    pendingAction: null,
    actionTimerMs: 650,
    idleAccumulatedMs: 0,
    paused: false,
    lastEvent: "click",
    bubble: typeof textOrBehavior === "string"
      ? { text: textOrBehavior, remainingMs: 1600 }
      : pickBubble(behavior?.cheerBubbles, random, 1600),
  };
}

/**
 * Trigger the character's own easter egg animation.
 */
export function triggerPetEasterEgg(
  state: PetSimulationState,
  random: () => number = Math.random,
): PetSimulationState {
  return {
    ...state,
    climb: null,
    targetX: null,
    paused: false,
    y: state.climb ? 0 : state.y,
    vy: state.climb ? 0 : state.vy,
    action: "celebrate",
    clip: "easterEgg",
    clipElapsedMs: 0,
    transitionMs: 0,
    pendingFacing: null,
    pendingAction: null,
    easterEggRemainingMs: EASTER_EGG_DURATION_MS,
    nextEasterEggCooldownMs: nextCooldown(random, MIN_EASTER_EGG_COOLDOWN_MS, MAX_EASTER_EGG_COOLDOWN_MS),
    actionTimerMs: EASTER_EGG_DURATION_MS,
    idleAccumulatedMs: 0,
    lastEvent: "easter_egg",
  };
}

/**
 * Start climbing toward another platform along the side wall when capable.
 */
export function startPetWallClimb(
  state: PetSimulationState,
  currentPlatform: PetPlatform,
  targetPlatform: PetPlatform,
  spriteWidth = PET_SPRITE_LOGICAL_SIZE,
  random: () => number = Math.random,
): PetSimulationState {
  const distToLeft = Math.abs(state.x - currentPlatform.minX);
  const maxOriginX = Math.max(currentPlatform.minX, currentPlatform.maxX - spriteWidth);
  const distToRight = Math.abs(maxOriginX - state.x);
  const side: "left" | "right" = distToLeft <= distToRight ? "left" : "right";
  const wallX = side === "left" ? currentPlatform.minX : maxOriginX;
  const targetMaxX = Math.max(targetPlatform.minX, targetPlatform.maxX - spriteWidth);
  const targetX = clampXOnPlatform(
    side === "left"
      ? targetPlatform.minX + Math.min(24, (targetMaxX - targetPlatform.minX) * 0.25)
      : targetMaxX - Math.min(24, (targetMaxX - targetPlatform.minX) * 0.25),
    targetPlatform,
    spriteWidth,
  );

  return {
    ...state,
    x: wallX,
    y: 0,
    vy: 0,
    facing: side === "right" ? 1 : -1,
    paused: false,
    targetX: null,
    easterEggRemainingMs: 0,
    transitionMs: 0,
    pendingFacing: null,
    pendingAction: null,
    action: "walk",
    clip: "wallGrab",
    clipElapsedMs: 0,
    platformStayMs: nextCooldown(random, MIN_PLATFORM_STAY_MS, MAX_PLATFORM_STAY_MS),
    lastEvent: "wall_climb",
    climb: {
      targetPlatformId: targetPlatform.id,
      targetGroundY: targetPlatform.groundY,
      targetX,
      phase: "grab",
      phaseMs: 180,
      side,
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
  spriteWidth = PET_SPRITE_LOGICAL_SIZE,
): PetSimulationState {
  const maxOriginX = Math.max(targetPlatform.minX, targetPlatform.maxX - spriteWidth);
  const ratio = 0.2 + random() * 0.6;
  const nextX = Math.round(targetPlatform.minX + (maxOriginX - targetPlatform.minX) * ratio);
  return {
    ...state,
    climb: null,
    easterEggRemainingMs: 0,
    platformId: targetPlatform.id,
    groundY: targetPlatform.groundY,
    platformStayMs: nextCooldown(random, MIN_PLATFORM_STAY_MS, MAX_PLATFORM_STAY_MS),
    x: clampXOnPlatform(nextX, targetPlatform, spriteWidth),
    y: 10,
    vy: JUMP_VELOCITY_PX_PER_SEC * 0.72,
    action: "jump",
    clip: "jump",
    clipElapsedMs: 0,
    transitionMs: 0,
    pendingFacing: null,
    pendingAction: null,
    motionElapsedMs: 0,
    actionTimerMs: 900,
    idleAccumulatedMs: 0,
    targetX: null,
    paused: false,
    lastEvent: "hop_platform",
    bubble: { text: "★", remainingMs: 1200 },
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
    climb: null,
    easterEggRemainingMs: 0,
    targetX,
    facing: state.facing,
    pendingFacing: facing !== state.facing ? facing : null,
    pendingAction: null,
    clip: facing !== state.facing ? "turn" : "walk",
    clipElapsedMs: 0,
    transitionMs: facing !== state.facing ? 120 : 0,
    motionElapsedMs: 0,
    action: "walk",
    actionTimerMs: 5000,
    idleAccumulatedMs: 0,
    paused: false,
  };
}

function enterSleepState(state: PetSimulationState, paused: boolean, durationMs: number): PetSimulationState {
  return {
    ...state,
    climb: null,
    easterEggRemainingMs: 0,
    paused,
    bubble: { text: "Zzz", remainingMs: 2200 },
    vy: state.y === 0 ? 0 : state.vy,
    action: "sleep",
    clip: "doze",
    clipElapsedMs: 0,
    transitionMs: 320,
    pendingFacing: null,
    pendingAction: "sleep",
    motionElapsedMs: 0,
    actionTimerMs: durationMs,
    targetX: null,
    idleAccumulatedMs: 0,
  };
}

function wakeFromSleepState(state: PetSimulationState, nextAction: PetActionState = "idle"): PetSimulationState {
  return {
    ...state,
    bubble: { text: "GO!", remainingMs: 1200 },
    climb: null,
    easterEggRemainingMs: 0,
    paused: false,
    action: nextAction,
    clip: "wake",
    clipElapsedMs: 0,
    transitionMs: 360,
    pendingFacing: null,
    pendingAction: nextAction,
    motionElapsedMs: 0,
    actionTimerMs: nextAction === "walk" ? 3500 : 4000,
    targetX: null,
    idleAccumulatedMs: 0,
  };
}

/**
 * Toggle pause/rest mode for the pet.
 */
export function togglePetPaused(state: PetSimulationState): PetSimulationState {
  const nextPaused = !state.paused;
  if (nextPaused) {
    return {
      ...enterSleepState(state, true, 60_000),
      lastEvent: "rest",
    };
  }
  return {
    ...wakeFromSleepState(state, "walk"),
    lastEvent: "wake",
  };
}

/**
 * Dispatch a standard event to the pet simulation (used by both runtime triggers and settings audition).
 */
export function dispatchPetEvent(
  state: PetSimulationState,
  event: PetStandardEvent,
  boundsWidth: number,
  options?: PetStepOptions,
): PetSimulationState {
  const random = options?.random ?? Math.random;
  const spriteWidth = options?.spriteWidth ?? PET_SPRITE_LOGICAL_SIZE;
  const platform = resolveActivePlatform(state.platformId, boundsWidth, options?.platforms, spriteWidth);

  switch (event) {
    case "click":
      return triggerPetJump(state, options?.behavior, random);
    case "work_start":
      return {
        ...state,
        climb: null,
        easterEggRemainingMs: 0,
        paused: false,
        action: "run",
        clip: "run",
        clipElapsedMs: 0,
        transitionMs: 0,
        pendingAction: null,
        actionTimerMs: 3200,
        idleAccumulatedMs: 0,
        lastMood: "working",
        lastEvent: "work_start",
        bubble: pickBubble(options?.behavior?.workBubbles, random, 1800),
      };
    case "work_complete": {
      const jumped = triggerPetJump(state, options?.behavior, random);
      return {
        ...jumped,
        action: "celebrate",
        clip: "celebrate",
        actionTimerMs: 1100,
        lastMood: "completed",
        lastEvent: "work_complete",
      };
    }
    case "work_error":
      return {
        ...state,
        climb: null,
        easterEggRemainingMs: 0,
        paused: false,
        action: "alert",
        clip: "alert",
        clipElapsedMs: 0,
        transitionMs: 0,
        pendingAction: null,
        actionTimerMs: 1600,
        idleAccumulatedMs: 0,
        lastMood: "error",
        lastEvent: "work_error",
        bubble: { text: "!?", remainingMs: 2200 },
      };
    case "rest":
      return {
        ...enterSleepState(state, true, 60_000),
        lastEvent: "rest",
      };
    case "wake":
      return {
        ...wakeFromSleepState(state, "idle"),
        lastEvent: "wake",
      };
    case "easter_egg":
      return triggerPetEasterEgg(state, random);
    case "hop_platform": {
      const candidates = (options?.platforms ?? []).filter(
        (p) => p.id !== platform.id && p.maxX - p.minX >= spriteWidth * 2,
      );
      const target = candidates[0];
      return target ? hopPetToPlatform(state, target, random, spriteWidth) : triggerPetJump(state, options?.behavior, random);
    }
    case "wall_climb": {
      const candidates = (options?.platforms ?? []).filter(
        (p) => p.id !== platform.id && p.maxX - p.minX >= spriteWidth * 2,
      );
      const target = candidates[0];
      if (target && options?.capabilities?.wallClimb) {
        return startPetWallClimb(state, platform, target, spriteWidth, random);
      }
      return triggerPetJump(state, options?.behavior, random);
    }
  }
}

function stepClimbSimulation(
  prev: PetSimulationState,
  dtMs: number,
  options?: PetStepOptions,
): PetSimulationState {
  const climb = prev.climb!;
  const spriteWidth = options?.spriteWidth ?? PET_SPRITE_LOGICAL_SIZE;
  const platforms = options?.platforms;
  const targetPlatform = platforms?.find(
    (p) => p.id === climb.targetPlatformId && p.maxX - p.minX >= spriteWidth,
  );
  if (!targetPlatform) {
    // Target platform disappeared (e.g. window resized too narrow); drop safely.
    return {
      ...prev,
      climb: null,
      y: Math.max(0, prev.y),
      vy: 0,
      action: "jump",
      clip: prev.y > 0 ? "fall" : "idle",
      clipElapsedMs: 0,
      transitionMs: 0,
    };
  }

  const dtSec = dtMs / 1000;
  const next: PetSimulationState = {
    ...prev,
    animElapsedMs: prev.animElapsedMs + dtMs,
    clipElapsedMs: prev.clipElapsedMs + dtMs,
  };

  if (climb.phase === "grab") {
    const remaining = climb.phaseMs - dtMs;
    if (remaining > 0) {
      next.clip = "wallGrab";
      next.climb = { ...climb, phaseMs: remaining };
      return next;
    }
    next.clip = "climb";
    next.clipElapsedMs = 0;
    next.climb = { ...climb, phase: "climb", phaseMs: 0 };
    return next;
  }

  if (climb.phase === "climb") {
    // Delta Y between current ground and target ground. Positive targetY means target is higher on screen.
    const desiredHeight = prev.groundY - targetPlatform.groundY;
    const step = CLIMB_SPEED_PX_PER_SEC * dtSec;
    const nextY = desiredHeight >= 0
      ? Math.min(desiredHeight, prev.y + step)
      : Math.max(desiredHeight, prev.y - step);
    next.y = nextY;
    next.clip = "climb";
    if (Math.abs(nextY - desiredHeight) <= 1.5) {
      next.y = desiredHeight;
      next.clip = "wallHang";
      next.clipElapsedMs = 0;
      next.climb = { ...climb, phase: "hang", phaseMs: 360 };
    }
    return next;
  }

  if (climb.phase === "hang") {
    const remaining = climb.phaseMs - dtMs;
    next.clip = "wallHang";
    if (remaining > 0) {
      next.climb = { ...climb, phaseMs: remaining };
      return next;
    }
    next.clip = "wallJump";
    next.clipElapsedMs = 0;
    next.climb = { ...climb, phase: "jump", phaseMs: 220 };
    return next;
  }

  // Final wallJump onto the target platform.
  const remaining = climb.phaseMs - dtMs;
  if (remaining > 0) {
    const progress = 1 - remaining / 220;
    const startX = prev.x;
    next.x = Math.round(startX + (climb.targetX - startX) * Math.min(1, progress * 0.35));
    next.clip = "wallJump";
    next.climb = { ...climb, phaseMs: remaining };
    return next;
  }

  return {
    ...next,
    climb: null,
    platformId: targetPlatform.id,
    groundY: targetPlatform.groundY,
    x: clampXOnPlatform(climb.targetX, targetPlatform, spriteWidth),
    y: 0,
    vy: 0,
    facing: climb.side === "left" ? 1 : -1,
    action: "walk",
    clip: "land",
    clipElapsedMs: 0,
    transitionMs: 140,
    pendingAction: "walk",
    actionTimerMs: 2800,
    motionElapsedMs: 0,
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
  const spriteWidth = options?.spriteWidth ?? PET_SPRITE_LOGICAL_SIZE;
  // 攀墙、过渡、彩蛋和休息都有提前返回，气泡先统一按模拟时钟计时。
  if (prev.bubble && dt > 0) {
    const remainingMs = prev.bubble.remainingMs - dt;
    prev = { ...prev, bubble: remainingMs > 0 ? { ...prev.bubble, remainingMs } : null };
  }

  if (prev.climb) {
    return stepClimbSimulation(prev, dt, options);
  }

  // Handle active character-owned easter egg playback.
  if (prev.easterEggRemainingMs > 0 && !prev.paused) {
    const platform = resolveActivePlatform(prev.platformId, boundsWidth, options?.platforms, spriteWidth);
    const maxX = Math.max(platform.minX, platform.maxX - spriteWidth);
    const remaining = Math.max(0, prev.easterEggRemainingMs - dt);
    const base: PetSimulationState = {
      ...prev,
      x: Math.max(platform.minX, Math.min(maxX, prev.x)),
      groundY: platform.groundY,
      animElapsedMs: prev.animElapsedMs + dt,
      clipElapsedMs: prev.clipElapsedMs + dt,
      easterEggRemainingMs: remaining,
      clip: "easterEgg",
    };
    if (remaining === 0) {
      return {
        ...base,
        action: "idle",
        clip: "idle",
        clipElapsedMs: 0,
        actionTimerMs: 2400,
      };
    }
    return base;
  }

  // 过渡期间保留动作意图，播完后才执行转向、打盹、醒来或继续行走。
  if (prev.transitionMs > 0 && (!prev.paused || prev.clip === "doze")) {
    const platform = resolveActivePlatform(prev.platformId, boundsWidth, options?.platforms, spriteWidth);
    const maxX = Math.max(platform.minX, platform.maxX - spriteWidth);
    const held: PetSimulationState = {
      ...prev,
      x: Math.max(platform.minX, Math.min(maxX, prev.x)),
      groundY: platform.groundY,
      transitionMs: Math.max(0, prev.transitionMs - dt),
      clipElapsedMs: prev.clipElapsedMs + dt,
      animElapsedMs: prev.animElapsedMs + dt,
    };
    if (held.transitionMs === 0) {
      if (prev.clip === "edgeLook") {
        return { ...held, clip: "turn", clipElapsedMs: 0, transitionMs: 120 };
      }
      const nextAction = prev.pendingAction ?? prev.action;
      return {
        ...held,
        facing: prev.pendingFacing ?? prev.facing,
        pendingFacing: null,
        pendingAction: null,
        action: nextAction,
        clip: nextAction,
        clipElapsedMs: 0,
        motionElapsedMs: 0,
      };
    }
    return held;
  }

  // 起步逐渐加速；临近边缘收步，避免匀速撞墙再瞬间反弹。
  const moving = prev.action === "walk" || prev.action === "run";
  const platform = resolveActivePlatform(prev.platformId, boundsWidth, options?.platforms, spriteWidth);
  const maxX = Math.max(platform.minX, platform.maxX - spriteWidth);
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

  if (next.climb || next.easterEggRemainingMs > 0 || next.transitionMs > 0) {
    return next;
  }

  next.motionElapsedMs = moving && next.action === prev.action ? prev.motionElapsedMs + dt : 0;
  if (next.clip === "crouch" && next.transitionMs > 0) {
    next.y = 0;
    next.x = prev.x;
    return next;
  }

  let clip: PetClipId = next.action;
  let holdMs = 0;
  let pendingAction: PetActionState | null = null;
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
    pendingAction = "idle";
  } else if (!next.paused && prev.action !== "sleep" && next.action === "sleep") {
    clip = "doze";
    holdMs = 300;
    pendingAction = "sleep";
  } else if (!next.paused && prev.action === "sleep" && next.action !== "sleep") {
    clip = "wake";
    holdMs = 320;
    pendingAction = next.action;
  }
  next.clip = clip;
  next.transitionMs = holdMs;
  next.pendingAction = pendingAction;
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
  const capabilities = options?.capabilities;
  const walkSpeed = behavior?.walkSpeedPxPerSec ?? WALK_SPEED_PX_PER_SEC;
  const runSpeed = behavior?.runSpeedPxPerSec ?? RUN_SPEED_PX_PER_SEC;
  const gravity = behavior?.gravityPxPerSec2 ?? GRAVITY_PX_PER_SEC2;
  const sleepAfterIdleMs = behavior?.sleepAfterIdleMs ?? SLEEP_AFTER_IDLE_MS;
  const allowPlatformHop = behavior?.allowPlatformHop ?? true;
  const allowWallClimb = Boolean(behavior?.allowWallClimb ?? true) && (capabilities?.wallClimb ?? true);
  const reactToCodingMood = behavior?.reactToCodingMood ?? true;
  const enableRandomEvents = behavior?.enableRandomEvents ?? true;
  const effectiveMood: PetCodingMood = reactToCodingMood ? mood : "idle";
  const spriteWidth = options?.spriteWidth ?? PET_SPRITE_LOGICAL_SIZE;

  const clampedDtMs = Math.max(0, Math.min(dtMs, 100));
  const dtSec = clampedDtMs / 1000;
  const platform = resolveActivePlatform(prev.platformId, boundsWidth, options?.platforms, spriteWidth);
  const minX = platform.minX;
  const maxX = Math.max(minX, platform.maxX - spriteWidth);

  let next: PetSimulationState = {
    ...prev,
    platformId: platform.id,
    groundY: platform.groundY,
    x: Math.max(minX, Math.min(maxX, prev.x)),
    animElapsedMs: prev.animElapsedMs + clampedDtMs,
    platformStayMs: prev.platformStayMs - clampedDtMs,
    nextEasterEggCooldownMs: Math.max(0, prev.nextEasterEggCooldownMs - clampedDtMs),
  };

  // React to coding mood transitions.
  if (effectiveMood !== prev.lastMood) {
    next.lastMood = effectiveMood;
    if (!next.paused) {
      if (effectiveMood === "working") {
        next.action = "run";
        next.actionTimerMs = 3200;
        next.idleAccumulatedMs = 0;
        next.lastEvent = "work_start";
        next.bubble = pickBubble(behavior?.workBubbles, random, 1800);
      } else if (effectiveMood === "completed" && prev.lastMood === "working") {
        next = triggerPetJump(next, behavior, random);
        next.action = "celebrate";
        next.actionTimerMs = 1100;
        next.lastMood = effectiveMood;
        next.lastEvent = "work_complete";
      } else if (effectiveMood === "error") {
        next.action = "alert";
        next.actionTimerMs = 1600;
        next.idleAccumulatedMs = 0;
        next.lastEvent = "work_error";
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
    const isRun = Math.abs(delta) > 90;
    const speed = isRun ? runSpeed : walkSpeed;
    next.facing = dir;
    next.action = isRun ? "run" : "walk";
    next.x = Math.max(minX, Math.min(maxX, next.x + dir * speed * dtSec));
    return next;
  }

  // Autonomous character-specific easter egg when idle or walking on the ground.
  if (
    enableRandomEvents
    && (capabilities?.easterEgg ?? true)
    && next.nextEasterEggCooldownMs <= 0
    && next.y === 0
    && (next.action === "idle" || next.action === "walk")
  ) {
    return triggerPetEasterEgg(next, random);
  }

  // Occasionally move to another available blank surface (either climb or hop).
  if (
    (allowPlatformHop || allowWallClimb)
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
        const nearEdge = next.x <= minX + 18 || next.x >= maxX - 18;
        if (allowWallClimb && (nearEdge || random() < 0.45)) {
          return startPetWallClimb(next, platform, target, spriteWidth, random);
        }
        if (allowPlatformHop) {
          return hopPetToPlatform(next, target, random, spriteWidth);
        }
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
      next.action = random() < 0.65 ? "run" : "walk";
      next.actionTimerMs = 2400 + Math.floor(random() * 2600);
      if (random() < 0.25) {
        next.facing = next.facing === 1 ? -1 : 1;
      }
      if (!next.bubble && behavior?.workBubbles?.length && random() < 0.22) {
        next.bubble = pickBubble(behavior.workBubbles, random, 1500);
      }
    } else if (next.action === "walk" || next.action === "run" || next.action === "alert") {
      if (random() < 0.72) {
        next.action = "idle";
        next.actionTimerMs = 5200 + Math.floor(random() * 4200);
      } else {
        if (random() < 0.35) {
          next.facing = next.facing === 1 ? -1 : 1;
        }
        next.action = random() < 0.22 ? "run" : "walk";
        next.actionTimerMs = 2200 + Math.floor(random() * 2000);
      }
    } else if (next.action === "idle") {
      if (next.idleAccumulatedMs >= sleepAfterIdleMs && random() < 0.65) {
        next.action = "sleep";
        next.actionTimerMs = 6000 + Math.floor(random() * 4500);
      } else if (random() < 0.42) {
        if (random() < 0.35) {
          next.facing = next.facing === 1 ? -1 : 1;
        }
        next.action = "idle";
        next.actionTimerMs = 4200 + Math.floor(random() * 3200);
      } else {
        if (random() < 0.4) {
          next.facing = next.facing === 1 ? -1 : 1;
        }
        next.action = random() < 0.2 ? "run" : "walk";
        next.actionTimerMs = 2400 + Math.floor(random() * 2200);
      }
    } else if (next.action === "sleep") {
      next.action = "idle";
      next.idleAccumulatedMs = 0;
      next.actionTimerMs = 4500 + Math.floor(random() * 3000);
    }
  }

  return next;
}

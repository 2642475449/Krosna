import { describe, expect, it } from "vitest";
import type { Session } from "@/types";
import {
  createInitialPetSimulation,
  derivePetCodingMood,
  dispatchPetEvent,
  PET_SPRITE_LOGICAL_SIZE,
  PET_TRACK_PADDING_X,
  setPetWalkTarget,
  stepPetSimulation,
  togglePetPaused,
  triggerPetEasterEgg,
  triggerPetJump,
  type PetSimulationState,
} from "./pixelPet";

function makeSession(overrides: Partial<Session>): Session {
  return {
    id: "session-1",
    path: "D:/repo",
    name: "Session 1",
    createdAt: 1,
    active: true,
    ...overrides,
  };
}

describe("derivePetCodingMood", () => {
  it("prioritizes active session working and error states", () => {
    const working = makeSession({ id: "s1", status: "running" });
    const errored = makeSession({ id: "s2", status: "error" });

    expect(derivePetCodingMood([working, errored], "s1")).toBe("working");
    expect(derivePetCodingMood([working, errored], "s2")).toBe("error");
  });

  it("falls back to other active working sessions when active tab is idle", () => {
    const idle = makeSession({ id: "s1", status: "waiting" });
    const bgRunning = makeSession({ id: "s2", status: "running" });

    expect(derivePetCodingMood([idle, bgRunning], "s1")).toBe("working");
  });

  it("returns completed when active session finished and no other session is running", () => {
    const done = makeSession({ id: "s1", status: "completed" });
    expect(derivePetCodingMood([done], "s1")).toBe("completed");
  });
});

describe("stepPetSimulation", () => {
  it("brakes, looks over the edge and turns before walking back", () => {
    const width = 300;
    const maxX = width - PET_TRACK_PADDING_X - PET_SPRITE_LOGICAL_SIZE;
    let sim: PetSimulationState = {
      ...createInitialPetSimulation(width),
      x: maxX - 1,
      facing: 1,
      action: "walk",
      actionTimerMs: 5000,
    };

    sim = stepPetSimulation(sim, 100, width, "idle", { random: () => 0.5 });
    expect(sim.x).toBeLessThan(maxX);
    for (let i = 0; i < 20 && sim.clip !== "edgeLook"; i++) {
      sim = stepPetSimulation(sim, 50, width, "idle", { random: () => 0.5 });
    }
    expect(sim.x).toBe(maxX);
    expect(sim.facing).toBe(1);
    expect(sim.clip).toBe("edgeLook");
    for (let i = 0; i < 15 && sim.facing === 1; i++) {
      sim = stepPetSimulation(sim, 50, width, "idle", { random: () => 0.5 });
      expect(sim.x).toBe(maxX);
    }
    expect(sim.facing).toBe(-1);
    sim = stepPetSimulation(sim, 50, width, "idle");
    expect(sim.x).toBeLessThan(maxX);
  });

  it("walks toward clicked target and stops upon arrival", () => {
    const width = 400;
    let sim = {
      ...createInitialPetSimulation(width),
      x: 50,
    };
    sim = setPetWalkTarget(sim, 140, width);
    expect(sim.targetX).not.toBeNull();
    expect(sim.facing).toBe(1);

    for (let i = 0; i < 60 && sim.targetX !== null; i++) {
      sim = stepPetSimulation(sim, 80, width, "idle", { random: () => 0.5 });
    }
    expect(sim.targetX).toBeNull();
    expect(sim.action).toBe("idle");
    expect(sim.x).toBeCloseTo(140 - PET_SPRITE_LOGICAL_SIZE / 2, 0);
  });

  it("jumps and lands back on the ground via gravity when no dialogue is configured", () => {
    const width = 400;
    let sim = triggerPetJump(createInitialPetSimulation(width));
    expect(sim.action).toBe("jump");
    expect(sim.bubble).toBeNull();

    sim = stepPetSimulation(sim, 50, width, "idle", { random: () => 0.5 });
    expect(sim.y).toBe(0);
    expect(sim.clip).toBe("crouch");
    sim = stepPetSimulation(sim, 50, width, "idle", { random: () => 0.5 });
    sim = stepPetSimulation(sim, 50, width, "idle", { random: () => 0.5 });
    expect(sim.y).toBeGreaterThan(0);

    const clips = new Set<string>();
    for (let i = 0; i < 30; i++) {
      sim = stepPetSimulation(sim, 50, width, "idle", { random: () => 0.5 });
      clips.add(sim.clip);
    }
    expect(clips.has("fall")).toBe(true);
    expect(clips.has("land")).toBe(true);
    expect(sim.y).toBe(0);
    expect(sim.vy).toBe(0);
  });

  it("uses the configured lines for clicks, live work transitions and the action preview", () => {
    const state = createInitialPetSimulation(400);
    const behavior = { cheerBubbles: ["老大，出发喵！", "开饭喵！"], workBubbles: ["老大，我望风。"] };
    const options = { behavior, random: () => 0.9 };
    expect(triggerPetJump(state, "★", options.random, behavior).bubble?.text).toBe("★");
    const click = dispatchPetEvent(state, "click", 400, options);
    expect(click.bubble?.text).toBe("开饭喵！");
    const working = stepPetSimulation(state, 16, 400, "working", options);
    expect(working.bubble).toEqual(dispatchPetEvent(state, "work_start", 400, options).bubble);
    expect(working.bubble?.text).toBe("老大，我望风。");
    const done = stepPetSimulation(working, 16, 400, "completed", options);
    expect(done.bubble).toEqual(dispatchPetEvent(working, "work_complete", 400, options).bubble);
    expect(done.bubble?.text).toBe("开饭喵！");

    // 蹲跳蓄力、落地等过渡也消耗显示时间，刚过期的气泡不会留在画布上。
    let jumping = click;
    for (let i = 0; i < 16; i++) jumping = stepPetSimulation(jumping, 100, 400, "idle", options);
    expect(jumping.bubble).toBeNull();
    expect(click.bubble?.remainingMs).toBe(1600);
  });

  it("runs while working and celebrates when coding mood transitions from working to completed", () => {
    const width = 400;
    let sim = createInitialPetSimulation(width);
    sim = stepPetSimulation(sim, 16, width, "working", { random: () => 0.5 });
    expect(sim.action).toBe("run");

    sim = stepPetSimulation(sim, 16, width, "completed", { random: () => 0.5 });
    expect(sim.action).toBe("celebrate");
    expect(sim.vy).toBeGreaterThan(0);
  });

  it("transitions through doze to sleep when paused and wake on resume", () => {
    const width = 400;
    let sim = togglePetPaused(createInitialPetSimulation(width));
    expect(sim.paused).toBe(true);
    expect(sim.clip).toBe("doze");

    for (let i = 0; i < 10; i++) {
      sim = stepPetSimulation(sim, 50, width, "working", { random: () => 0.5 });
    }
    expect(sim.action).toBe("sleep");
    expect(sim.clip).toBe("sleep");

    sim = togglePetPaused(sim);
    expect(sim.paused).toBe(false);
    expect(sim.clip).toBe("wake");
    for (let i = 0; i < 10; i++) {
      sim = stepPetSimulation(sim, 50, width, "idle", { random: () => 0.5 });
    }
    expect(sim.clip).toBe("walk");
  });

  it("hops between available platforms when platformStayMs expires and wall climb is disabled", () => {
    const platforms = [
      { id: "statusbar", minX: 10, maxX: 800, groundY: 772 },
      { id: "titlebar-blank", minX: 280, maxX: 600, groundY: 40 },
    ];
    let sim: PetSimulationState = {
      ...createInitialPetSimulation(800, platforms),
      platformStayMs: 10,
      y: 0,
    };

    sim = stepPetSimulation(sim, 50, 800, "idle", {
      random: () => 0.5,
      platforms,
      behavior: { allowWallClimb: false, allowPlatformHop: true },
    });
    expect(sim.platformId).toBe("titlebar-blank");
    expect(sim.groundY).toBe(40);
    expect(sim.x).toBeGreaterThanOrEqual(280);
    expect(sim.x).toBeLessThanOrEqual(600 - PET_SPRITE_LOGICAL_SIZE);
  });

  it("climbs between platforms using wallGrab, climb, wallHang, and wallJump when capable", () => {
    const platforms = [
      { id: "statusbar", minX: 10, maxX: 800, groundY: 772 },
      { id: "titlebar-blank", minX: 280, maxX: 600, groundY: 40 },
    ];
    let sim = dispatchPetEvent(
      createInitialPetSimulation(800, platforms),
      "wall_climb",
      800,
      { platforms, capabilities: { wallClimb: true } },
    );
    expect(sim.climb).not.toBeNull();
    expect(sim.clip).toBe("wallGrab");

    const seenClips = new Set<string>([sim.clip]);
    for (let i = 0; i < 300 && sim.climb !== null; i++) {
      sim = stepPetSimulation(sim, 60, 800, "idle", {
        platforms,
        capabilities: { wallClimb: true },
      });
      seenClips.add(sim.clip);
    }
    expect(seenClips.has("wallGrab")).toBe(true);
    expect(seenClips.has("climb")).toBe(true);
    expect(seenClips.has("wallHang")).toBe(true);
    expect(seenClips.has("wallJump")).toBe(true);
    expect(sim.climb).toBeNull();
    expect(sim.platformId).toBe("titlebar-blank");
    expect(sim.y).toBe(0);
  });

  it("recovers safely if the target platform disappears mid-climb", () => {
    const platforms = [
      { id: "statusbar", minX: 10, maxX: 800, groundY: 772 },
      { id: "titlebar-blank", minX: 280, maxX: 600, groundY: 40 },
    ];
    let sim = dispatchPetEvent(
      createInitialPetSimulation(800, platforms),
      "wall_climb",
      800,
      { platforms, capabilities: { wallClimb: true } },
    );
    for (let i = 0; i < 10; i++) {
      sim = stepPetSimulation(sim, 60, 800, "idle", {
        platforms,
        capabilities: { wallClimb: true },
      });
    }
    expect(sim.climb).not.toBeNull();

    // Shrink platforms so titlebar-blank disappears
    sim = stepPetSimulation(sim, 60, 300, "idle", {
      platforms: [{ id: "statusbar", minX: 10, maxX: 290, groundY: 772 }],
    });
    expect(sim.climb).toBeNull();
  });

  it("autonomously triggers character-specific easterEgg when cooldown expires", () => {
    const width = 500;
    let sim: PetSimulationState = {
      ...createInitialPetSimulation(width),
      nextEasterEggCooldownMs: 0,
    };
    sim = stepPetSimulation(sim, 16, width, "idle", {
      random: () => 0.1,
      behavior: { enableRandomEvents: true },
      capabilities: { easterEgg: true },
    });
    expect(sim.clip).toBe("easterEgg");
    expect(sim.easterEggRemainingMs).toBeGreaterThan(0);
    expect(sim.nextEasterEggCooldownMs).toBeGreaterThan(0);

    for (let i = 0; i < 40 && sim.easterEggRemainingMs > 0; i++) {
      sim = stepPetSimulation(sim, 60, width, "idle", {
        behavior: { enableRandomEvents: true },
        capabilities: { easterEgg: true },
      });
    }
    expect(sim.easterEggRemainingMs).toBe(0);
    expect(sim.clip).toBe("idle");
  });

  it("does not trigger easterEgg when disabled in behavior or capabilities", () => {
    const width = 500;
    let sim: PetSimulationState = {
      ...createInitialPetSimulation(width),
      nextEasterEggCooldownMs: 0,
    };
    sim = stepPetSimulation(sim, 16, width, "idle", {
      behavior: { enableRandomEvents: false },
      capabilities: { easterEgg: true },
    });
    expect(sim.clip).not.toBe("easterEgg");

    sim = triggerPetEasterEgg(sim);
    expect(sim.clip).toBe("easterEgg");
  });
});

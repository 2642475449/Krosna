import { describe, expect, it } from "vitest";
import type { Session } from "@/types";
import {
  createInitialPetSimulation,
  derivePetCodingMood,
  PET_SPRITE_LOGICAL_SIZE,
  PET_TRACK_PADDING_X,
  setPetWalkTarget,
  spawnPetEncounter,
  stepPetSimulation,
  togglePetPaused,
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
  it("walks forward and reverses at the right boundary", () => {
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
    expect(sim.x).toBe(maxX);
    expect(sim.facing).toBe(-1);
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

  it("jumps and lands back on the ground via gravity", () => {
    const width = 400;
    let sim = triggerPetJump(createInitialPetSimulation(width), "GO!");
    expect(sim.action).toBe("jump");
    expect(sim.bubble?.text).toBe("GO!");

    sim = stepPetSimulation(sim, 50, width, "idle", { random: () => 0.5 });
    expect(sim.y).toBeGreaterThan(0);

    for (let i = 0; i < 30; i++) {
      sim = stepPetSimulation(sim, 50, width, "idle", { random: () => 0.5 });
    }
    expect(sim.y).toBe(0);
    expect(sim.vy).toBe(0);
  });

  it("celebrates when coding mood transitions from working to completed", () => {
    const width = 400;
    let sim: PetSimulationState = {
      ...createInitialPetSimulation(width),
      lastMood: "working",
    };
    sim = stepPetSimulation(sim, 16, width, "completed", { random: () => 0.5 });
    expect(sim.action).toBe("celebrate");
    expect(sim.bubble?.text).toBe("OK!");
    expect(sim.vy).toBeGreaterThan(0);
  });

  it("enters sleep mode when paused", () => {
    const width = 400;
    let sim = togglePetPaused(createInitialPetSimulation(width));
    expect(sim.paused).toBe(true);
    expect(sim.action).toBe("sleep");
    expect(sim.bubble?.text).toBe("Zzz");

    sim = stepPetSimulation(sim, 100, width, "working", { random: () => 0.5 });
    expect(sim.action).toBe("sleep");
  });

  it("hops between available platforms when platformStayMs expires", () => {
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
    });
    expect(sim.platformId).toBe("titlebar-blank");
    expect(sim.groundY).toBe(40);
    expect(sim.x).toBeGreaterThanOrEqual(280);
    expect(sim.x).toBeLessThanOrEqual(600 - PET_SPRITE_LOGICAL_SIZE);
  });

  it("spawns a random encounter when cooldown expires", () => {
    const width = 500;
    let sim: PetSimulationState = {
      ...createInitialPetSimulation(width),
      nextEncounterCooldownMs: 0,
    };
    sim = stepPetSimulation(sim, 16, width, "idle", {
      random: () => 0.1,
      behavior: { enableRandomEvents: true },
    });
    expect(sim.encounter).not.toBeNull();
    expect(sim.encounter?.phase).toBe("active");
    expect(sim.nextEncounterCooldownMs).toBeGreaterThan(0);
  });

  it("chases and defeats a slime or ghost encounter", () => {
    const width = 500;
    let sim = spawnPetEncounter(
      createInitialPetSimulation(width),
      width,
      undefined,
      () => 0.1, // "slime"
    );
    expect(sim.encounter?.kind).toBe("slime");

    for (let i = 0; i < 120; i += 1) {
      sim = stepPetSimulation(sim, 50, width, "idle", {
        random: () => 0.5,
        behavior: { enableRandomEvents: true, allowPlatformHop: false },
      });
      if (sim.encounter?.phase === "defeated") break;
    }

    expect(sim.encounter?.phase).toBe("defeated");
    expect(sim.vy).toBeGreaterThan(0);
  });

  it("catches a falling star encounter with star bubble", () => {
    const width = 500;
    let sim = spawnPetEncounter(
      createInitialPetSimulation(width),
      width,
      undefined,
      () => 0.9, // "star"
    );
    expect(sim.encounter?.kind).toBe("star");

    for (let i = 0; i < 120; i += 1) {
      sim = stepPetSimulation(sim, 50, width, "idle", {
        random: () => 0.5,
        behavior: { enableRandomEvents: true, allowPlatformHop: false },
      });
      if (!sim.encounter) break;
    }

    expect(sim.encounter).toBeNull();
    expect(sim.bubble?.text).toBe("★");
  });

  it("clears active encounter when enableRandomEvents is false", () => {
    const width = 500;
    let sim = spawnPetEncounter(createInitialPetSimulation(width), width);
    expect(sim.encounter).not.toBeNull();

    sim = stepPetSimulation(sim, 16, width, "idle", {
      behavior: { enableRandomEvents: false },
    });
    expect(sim.encounter).toBeNull();
  });
});

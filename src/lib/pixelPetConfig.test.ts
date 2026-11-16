import { describe, expect, it } from "vitest";
import {
  buildPixelPetAiPrompt,
  parsePixelPetConfigJson,
  PIXEL_PET_PRESETS,
} from "./pixelPetConfig";

describe("pixelPetConfig", () => {
  it("round-trips all built-in pixel presets cleanly", () => {
    for (const preset of PIXEL_PET_PRESETS) {
      const result = parsePixelPetConfigJson(JSON.stringify(preset));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.id).toBe(preset.id);
        expect(result.config.frames.walk.length).toBeGreaterThan(0);
        expect(result.config.behavior.enableRandomEvents).toBe(preset.id === "bot");
      }
    }
  });

  it("normalizes minimal AI-generated pixel configs and clamps integer pixelSize", () => {
    const minimal = JSON.stringify({
      id: "slime",
      name: "Pixel Slime",
      pixelSize: 2.7,
      palette: { G: "#4caf50" },
      frames: {
        idle: [["..GG..", ".GGGG.", "GGGGGG"]],
      },
      behavior: {
        walkSpeedPxPerSec: 999,
      },
    });

    const result = parsePixelPetConfigJson(minimal);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.pixelSize).toBe(3);
      expect(result.config.frames.walk.length).toBe(1);
      expect(result.config.frames.jump.length).toBe(1);
      expect(result.config.behavior.walkSpeedPxPerSec).toBe(140);
    }
  });

  it("rejects invalid JSON or empty palettes", () => {
    expect(parsePixelPetConfigJson("{bad").ok).toBe(false);
    expect(
      parsePixelPetConfigJson(
        JSON.stringify({ palette: {}, frames: { idle: [["."]] } }),
      ).ok,
    ).toBe(false);
  });

  it("references the files without embedding any preset's full animation data", () => {
    for (const preset of PIXEL_PET_PRESETS) {
      const prompt = buildPixelPetAiPrompt(preset, "D:/我的角色/pet.json");
      expect(prompt).toContain("D:/我的角色/pet.json");
      expect(prompt).toContain("pet.json.guide.md");
      expect(prompt).toContain("全新角色");
      expect(prompt).toContain("改造当前角色");
      expect(prompt).not.toContain(preset.frames.idle[0].join("\n"));
      expect(prompt).not.toContain('"frames":');
      expect(prompt).not.toContain("16x16");
      expect(prompt.length).toBeLessThan(1000);
    }
  });
});

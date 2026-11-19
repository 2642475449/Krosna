import { describe, expect, it } from "vitest";
import {
  localizePixelPetDialogue,
  buildPixelPetAiPrompt,
  parsePixelPetConfigJson,
  PIXEL_PET_PRESETS,
  upgradePersistedPixelPetConfig,
} from "./pixelPetConfig";

describe("pixelPetConfig", () => {
  it("updates the old Daimao bubbles and adapts the built-in lines when the language changes", () => {
    const daimao = PIXEL_PET_PRESETS.find((preset) => preset.id === "daimao")!;
    const old = { ...daimao, behavior: {
      ...daimao.behavior,
      cheerBubbles: ["Woof!", "♥", "★", ":3"],
      workBubbles: ["...", "</>", "🐾"],
    } };
    let config = old;
    for (const [language, line] of [
      ["zh_CN", "团子分我一串？"], ["en", "One dango?"], ["ja", "お団子一本ちょうだいニャ"],
    ] as const) {
      config = localizePixelPetDialogue(config, language);
      expect(config.behavior.cheerBubbles).toContain(line);
      expect(config.behavior.workBubbles).not.toEqual(old.behavior.workBubbles);
      expect([...config.behavior.cheerBubbles, ...config.behavior.workBubbles]
        .every((text) => text.length > 0 && text.length <= 12)).toBe(true);
      expect(localizePixelPetDialogue(config, language)).toBe(config);
    }
    const customized = { ...old, behavior: { ...old.behavior, workBubbles: ["巡逻中"] } };
    const updated = localizePixelPetDialogue(customized, "zh_CN");
    expect(updated.behavior.cheerBubbles).toEqual(daimao.behavior.cheerBubbles);
    expect(updated.behavior.workBubbles).toBe(customized.behavior.workBubbles);
    expect(upgradePersistedPixelPetConfig(customized).behavior.workBubbles).toEqual(["巡逻中"]);
    const beforeBubbles = JSON.parse(JSON.stringify(daimao));
    delete beforeBubbles.behavior.cheerBubbles;
    delete beforeBubbles.behavior.workBubbles;
    expect(localizePixelPetDialogue(beforeBubbles, "en").behavior.cheerBubbles).toContain("One dango?");
    expect(localizePixelPetDialogue(PIXEL_PET_PRESETS[0], "ja")).toBe(PIXEL_PET_PRESETS[0]);
  });

  it("round-trips all built-in pixel presets cleanly", () => {
    for (const preset of PIXEL_PET_PRESETS) {
      const result = parsePixelPetConfigJson(JSON.stringify(preset));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.id).toBe(preset.id);
        expect(result.config.frames.walk.length).toBeGreaterThan(0);
        expect(result.config.behavior.enableRandomEvents).toBe(preset.behavior.enableRandomEvents);
        expect(result.config.behavior.cheerBubbles).toEqual(preset.behavior.cheerBubbles);
        expect(result.config.behavior.workBubbles).toEqual(preset.behavior.workBubbles);
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
        cheerBubbles: [false, "   ", "  出发喵！  ", "12345678901🐾🐾"],
      },
    });

    const result = parsePixelPetConfigJson(minimal);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.pixelSize).toBe(3);
      expect(result.config.frames.walk.length).toBe(1);
      expect(result.config.frames.jump.length).toBe(1);
      expect(result.config.behavior.walkSpeedPxPerSec).toBe(140);
      expect(result.config.behavior.cheerBubbles).toEqual(["出发喵！", "12345678901🐾"]);
      expect(result.config.behavior.workBubbles).toEqual([]);
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

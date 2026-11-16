import { expect, it } from "vitest";
import { HERO_FRAMES, HERO_PALETTE } from "./pixelPetHeroFrames";

it("keeps the original cap, hair, moustache and broad overalls", () => {
  expect(HERO_FRAMES.idle[0]).toEqual([
    ".....RRRRRR.....", "....RRRRWRRR....", "....RRRRRRRRRR..", "....HHHHSSSS....",
    "...HHSHHSSSHS...", "...HHSHHHSSSE...", "...HHHHSSSSHHH..", ".....SSSSSSS....",
    "....RRBRRBR.....", "...RRRBRRBRRR...", "..WW.RBYBBYBR...", "..WW.BBBBBBBB...",
    ".....BBBBBBBB...", "....BBBb..bBBB..", "....KKK....KKK..", "...KKKK....KKKK.",
  ]);
});

it("keeps transition frames on the same grid and palette as the original character", () => {
  for (const frames of Object.values(HERO_FRAMES)) {
    for (const frame of frames) {
      expect(frame).toHaveLength(16);
      for (const row of frame) {
        expect(row).toHaveLength(16);
        for (const pixel of row) expect(pixel === "." || pixel in HERO_PALETTE).toBe(true);
      }
    }
  }
  expect(HERO_FRAMES.crouch[0].slice(2, 10)).toEqual(HERO_FRAMES.idle[0].slice(0, 8));
  expect(HERO_FRAMES.fall[0].slice(0, 8)).toEqual(HERO_FRAMES.idle[0].slice(0, 8));
});

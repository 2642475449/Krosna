// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { collectPetPlatforms } from "./PixelPetTrack";

function surface(name: string, rect: { left?: number; top: number; width: number; height: number }) {
  const element = document.createElement("div");
  element.dataset.petSurface = name;
  element.getBoundingClientRect = () => new DOMRect(rect.left ?? 0, rect.top, rect.width, rect.height);
  document.body.append(element);
  return element;
}

afterEach(() => document.body.replaceChildren());

it("grounds the titlebar pet on the visible workspace edge after layout padding", () => {
  surface("titlebar-blank", { left: 500, top: 6, width: 400, height: 34 });
  surface("statusbar", { top: 772, width: 1200, height: 28 });
  const workspace = surface("workspace", { top: 40, width: 1000, height: 732 });
  workspace.style.paddingTop = "6px";

  expect(collectPetPlatforms(1200, 800, 40)).toEqual([
    { id: "statusbar", minX: 10, maxX: 1190, groundY: 772 },
    { id: "titlebar-blank", minX: 508, maxX: 892, groundY: 46 },
  ]);

  // A theme/layout change must move the ground without a fixed pixel offset.
  workspace.style.paddingTop = "10px";
  expect(collectPetPlatforms(1200, 800, 48)[1]?.groundY).toBe(50);
});

it("falls back to the titlebar edge when the workspace surface is unavailable", () => {
  surface("titlebar-blank", { left: 500, top: 6, width: 400, height: 34 });
  expect(collectPetPlatforms(1200, 800, 40)[0]).toEqual({
    id: "titlebar-blank", minX: 508, maxX: 892, groundY: 40,
  });
  expect(collectPetPlatforms(1200, 800, 48).map((platform) => platform.id)).toEqual(["statusbar"]);
});

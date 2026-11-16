import { beforeEach, expect, it, vi } from "vitest";
import { ensurePixelPetFileGuide, exportPixelPetFile } from "./pixelPetFileIO";

const mocks = vi.hoisted(() => ({ read: vi.fn(), create: vi.fn(), write: vi.fn() }));
vi.mock("./api", () => ({ readProjectFile: mocks.read, createProjectFile: mocks.create, writeProjectFile: mocks.write }));
beforeEach(() => { vi.resetAllMocks(); });

it("creates a new configuration and companion guide without an unchecked overwrite", async () => {
  mocks.read.mockRejectedValue(new Error("missing"));
  const result = await exportPixelPetFile("D:/pets/hero.json", "{}");
  expect(mocks.create.mock.calls).toEqual([
    ["D:/pets/", "D:/pets/", "hero.json"],
    ["D:/pets/", "D:/pets/", "hero.json.guide.md"],
  ]);
  expect(mocks.write).toHaveBeenNthCalledWith(1, "D:/pets/", "D:/pets/hero.json", "{}", "utf-8", { content: "", encoding: "utf-8" });
  expect(mocks.write.mock.calls[1][2]).toContain("frameTimingsMs");
  expect(result).toEqual({ content: "{}", encoding: "utf-8" });
});

it("compares the existing snapshot and preserves an existing guide", async () => {
  const existing = { content: "old", encoding: "utf-8" };
  mocks.read.mockResolvedValue(existing);
  await exportPixelPetFile("D:/pets/hero.json", "new");
  expect(mocks.write).toHaveBeenCalledExactlyOnceWith("D:/pets/", "D:/pets/hero.json", "new", "utf-8", existing);
  expect(mocks.create).not.toHaveBeenCalled();
});

it("propagates external write conflicts and does not generate a misleading guide", async () => {
  mocks.read.mockResolvedValue({ content: "old", encoding: "utf-8" });
  mocks.write.mockRejectedValue(new Error("file-write-conflict"));
  await expect(exportPixelPetFile("D:/pets/hero.json", "new")).rejects.toThrow("file-write-conflict");
  expect(mocks.read).toHaveBeenCalledTimes(1);
});

it("does not overwrite an unreadable guide or a racing file creation", async () => {
  mocks.read.mockRejectedValue(new Error("unreadable"));
  mocks.create.mockRejectedValue(new Error("already exists"));
  await expect(ensurePixelPetFileGuide("D:/pets/hero.json")).rejects.toThrow("already exists");
  expect(mocks.write).not.toHaveBeenCalled();
});

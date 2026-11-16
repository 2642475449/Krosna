import { afterEach, expect, it, vi } from "vitest";
import { PIXEL_PET_PRESETS } from "./pixelPetConfig";
import { buildPixelPetFileGuide, parsePixelPetFile, pixelPetFileLocation, watchPixelPetFile } from "./pixelPetFile";

const json = (name: string) => JSON.stringify({ id: "custom", name, palette: { K: "#112233" }, frames: { idle: [[".K.", "KKK"]] } });
afterEach(() => vi.useRealTimers());

it("accepts exported presets, including non-16×16 characters and a UTF-8 BOM", () => {
  for (const preset of PIXEL_PET_PRESETS) {
    expect(parsePixelPetFile("\uFEFF" + JSON.stringify(preset)).name).toBe(preset.name);
  }
});

it("rejects partial saves, malformed frames and undefined palette characters", () => {
  expect(() => parsePixelPetFile('{"frames":')).toThrow();
  expect(() => parsePixelPetFile(json("pet").replace('"KKK"', '"KK"'))).toThrow("equal widths");
  expect(() => parsePixelPetFile(json("pet").replace('"KKK"', '"KXK"'))).toThrow("missing palette");
  const partial = JSON.parse(json("pet"));
  partial.frames.walk = [];
  expect(() => parsePixelPetFile(JSON.stringify(partial))).toThrow();
});

it.each([
  ["C:\\角色\\pet.json", "C:/角色/", "pet.json"],
  ["C:\\pet.json", "C:/", "pet.json"],
  ["/pet.json", "/", "pet.json"],
  ["\\\\host\\share\\pet.json", "//host/share/", "pet.json"],
])("scopes file access to the parent: %s", (path, directory, name) => {
  expect(pixelPetFileLocation(path)).toEqual({ directory, name });
});

it("rejects relative or directory-only file paths", () => {
  for (const path of ["pet.json", "pets/pet.json", "C:pet.json", "C:/pets/"]) {
    expect(() => pixelPetFileLocation(path)).toThrow("absolute file path");
  }
});

it("loads only changed valid files, preserves the previous pet on errors, then recovers", async () => {
  vi.useFakeTimers();
  let content = json("first");
  const onLoad = vi.fn();
  const onError = vi.fn();
  const stop = watchPixelPetFile({ read: async () => ({ content, encoding: "utf-8" }), onLoad, onError });
  await vi.advanceTimersByTimeAsync(0);
  expect(onLoad.mock.calls[0][0].name).toBe("first");
  await vi.advanceTimersByTimeAsync(1000);
  expect(onLoad).toHaveBeenCalledTimes(1);
  content = '{"name":';
  await vi.advanceTimersByTimeAsync(1000);
  expect(onLoad).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenLastCalledWith(expect.any(String));
  content = json("second");
  await vi.advanceTimersByTimeAsync(1000);
  expect(onLoad.mock.calls[1][0].name).toBe("second");
  expect(onError).toHaveBeenLastCalledWith(null);
  stop();
});

it("ignores a late read after unlinking or switching files", async () => {
  vi.useFakeTimers();
  let resolve!: (value: { content: string; encoding: string }) => void;
  const onLoad = vi.fn();
  const onError = vi.fn();
  const read = vi.fn(() => new Promise<{ content: string; encoding: string }>((done) => { resolve = done; }));
  const stop = watchPixelPetFile({ read, onLoad, onError });
  await vi.advanceTimersByTimeAsync(5000);
  expect(read).toHaveBeenCalledTimes(1);
  stop();
  resolve({ content: json("stale"), encoding: "utf-8" });
  await vi.advanceTimersByTimeAsync(5000);
  expect(onLoad).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledTimes(1);
});

it("recovers from a deleted/replaced file even when the content is unchanged", async () => {
  vi.useFakeTimers();
  const snapshot = { content: json("pet"), encoding: "utf-8" };
  const read = vi.fn().mockResolvedValueOnce(snapshot).mockRejectedValueOnce(new Error("missing")).mockResolvedValue(snapshot);
  const onLoad = vi.fn();
  const onError = vi.fn();
  const stop = watchPixelPetFile({ read, onLoad, onError });
  await vi.advanceTimersByTimeAsync(2000);
  expect(onLoad).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenLastCalledWith(null);
  stop();
});

it("includes a parseable minimal example and the optional animation format in the guide", () => {
  const guide = buildPixelPetFileGuide();
  expect(guide).toContain("wallGrab");
  expect(guide).toContain("frameTimingsMs");
  const example = guide.split("\n").find((line) => line.startsWith('{"id"'))!;
  expect(parsePixelPetFile(example).id).toBe("custom");
});

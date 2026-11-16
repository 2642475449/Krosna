import { createProjectFile, readProjectFile, writeProjectFile } from "./api";
import { buildPixelPetFileGuide, pixelPetFileLocation, type PixelPetFileSnapshot } from "./pixelPetFile";

/** Existing files use the editor API's compare-and-write protection. */
export async function exportPixelPetFile(path: string, content: string) {
  const { directory, name } = pixelPetFileLocation(path);
  let expected: PixelPetFileSnapshot;
  try {
    expected = await readProjectFile(directory, path);
  } catch {
    // create_new refuses collisions, including files that were unreadable above.
    await createProjectFile(directory, directory, name);
    expected = { content: "", encoding: "utf-8" };
  }
  await writeProjectFile(directory, path, content, "utf-8", expected);
  await ensurePixelPetFileGuide(path);
  return { content, encoding: "utf-8" };
}

export async function ensurePixelPetFileGuide(path: string) {
  const guidePath = `${path}.guide.md`;
  const { directory, name } = pixelPetFileLocation(guidePath);
  try {
    await readProjectFile(directory, guidePath);
    return; // Preserve notes or refinements the user has added to the guide.
  } catch {
    await createProjectFile(directory, directory, name);
  }
  await writeProjectFile(directory, guidePath, buildPixelPetFileGuide(), "utf-8", { content: "", encoding: "utf-8" });
}

import { afterEach, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { checkpointFileDiff, gitDiffContent, gitGraphFileDiff } from "./index";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
afterEach(() => { vi.clearAllMocks(); });

it.each([
  ["working tree", () => gitDiffContent("repo", "large.txt", false)],
  ["history", () => gitGraphFileDiff("repo", "commit", "large.txt")],
  ["checkpoint", () => checkpointFileDiff("repo", "turn", "large.txt")],
] as const)("localizes %s preview budget errors at the IPC boundary", async (_kind, preview) => {
  mocks.invoke.mockRejectedValueOnce("FILE_PREVIEW_TOO_LARGE:git:8");
  await expect(preview()).rejects.toBe(i18n.t("filePreview.tooLargeGitDiff", { limit: 8 }));
  mocks.invoke.mockRejectedValueOnce("repository unavailable");
  await expect(preview()).rejects.toBe("repository unavailable");
});

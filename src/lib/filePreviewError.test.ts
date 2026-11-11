import { describe, expect, it, vi } from "vitest";
import { getFilePreviewErrorMessage, isFilePreviewSizeLimitError } from "./filePreviewError";

const translate = vi.hoisted(() => vi.fn((key: string, values: { limit: number }) => `${key} (${values.limit} MiB)`));
vi.mock("@/i18n", () => ({ default: { t: translate } }));

describe("file preview size errors", () => {
  it("localizes capacity errors from Tauri string rejections and Error objects", () => {
    expect(getFilePreviewErrorMessage("FILE_PREVIEW_TOO_LARGE:text:16")).toBe("filePreview.tooLargeText (16 MiB)");
    expect(getFilePreviewErrorMessage(new Error("FILE_PREVIEW_TOO_LARGE:image:16"))).toBe("filePreview.tooLargeImage (16 MiB)");
    expect(translate).toHaveBeenCalledWith("filePreview.tooLargeImage", { limit: 16 });
    expect(isFilePreviewSizeLimitError("FILE_PREVIEW_TOO_LARGE:text:16")).toBe(true);
    expect(getFilePreviewErrorMessage("FILE_PREVIEW_TOO_LARGE:git:8")).toBe("filePreview.tooLargeGitDiff (8 MiB)");
  });

  it("preserves ordinary and malformed errors without hiding useful failure details", () => {
    for (const error of ["file-write-conflict", "Permission denied", "FILE_PREVIEW_TOO_LARGE:text:0", "FILE_PREVIEW_TOO_LARGE:pdf:16", "FILE_PREVIEW_TOO_LARGE:text:16.5"]) {
      expect(getFilePreviewErrorMessage(error)).toBe(error);
      expect(isFilePreviewSizeLimitError(error)).toBe(false);
    }
    expect(getFilePreviewErrorMessage(new Error("disk unavailable"))).toBe("disk unavailable");
    expect(getFilePreviewErrorMessage(null)).toBe("null");
  });
});

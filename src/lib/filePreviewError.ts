import i18n from "@/i18n";

function sizeLimit(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const match = /^FILE_PREVIEW_TOO_LARGE:(text|image|git):([1-9]\d*)$/.exec(message);
  if (!match) return null;
  const limit = Number(match[2]);
  return Number.isSafeInteger(limit) ? { kind: match[1], limit } : null;
}

export function isFilePreviewSizeLimitError(error: unknown): boolean {
  return sizeLimit(error) !== null;
}

/** 后端容量错误只携带种类与限额；预览入口统一转换为用户语言。 */
export function getFilePreviewErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const size = sizeLimit(error);
  if (!size) return message;
  const key = size.kind === "git" ? "filePreview.tooLargeGitDiff"
    : size.kind === "text" ? "filePreview.tooLargeText" : "filePreview.tooLargeImage";
  return i18n.t(key, { limit: size.limit });
}

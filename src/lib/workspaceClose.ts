import { getUnsavedFileDocuments } from "@/lib/fileDocument";

/** 同时覆盖主工作区、辅助栏和暂时未挂载的文档；等待已开始的写入结束。 */
export async function flushWorkspaceDocuments(): Promise<string[]> {
  const pending = getUnsavedFileDocuments();
  const results = await Promise.allSettled(pending.map(({ document }) => document.save()));
  const failed = pending.filter((_, index) => results[index].status === "rejected" ||
    (results[index].status === "fulfilled" && !results[index].value)).map(({ path }) => path);
  // 保存期间仍可能产生其他草稿；任何未保存状态都阻止销毁窗口。
  return [...new Set([...failed, ...getUnsavedFileDocuments().map(({ path }) => path)])];
}

export function pauseWorkspaceDocumentAutoSave(): () => void {
  const releases = getUnsavedFileDocuments().map(({ document }) => document.pauseAutoSave());
  return () => releases.forEach((release) => release());
}

export async function discardWorkspaceDocuments(): Promise<string[]> {
  const pending = getUnsavedFileDocuments();
  const results = await Promise.allSettled(pending.map(({ document }) => document.discardChanges()));
  const failed = pending.filter((_, index) => results[index].status === "rejected").map(({ path }) => path);
  return [...new Set([...failed, ...getUnsavedFileDocuments().map(({ path }) => path)])];
}

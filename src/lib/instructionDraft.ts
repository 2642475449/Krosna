/** 保存响应只替换尚未再次编辑的草稿；发送快照始终由调用方作为保存基线。 */
export function mergeSavedInstructionDraft(currentDraft: string, submittedDraft: string, savedContent: string): string {
  return currentDraft === submittedDraft ? savedContent : currentDraft;
}

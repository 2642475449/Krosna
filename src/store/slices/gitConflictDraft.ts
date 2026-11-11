import { create } from "zustand";
import type { GitConflictDraftState } from "../types";

/** 草稿只在当前进程保留；关闭标签页不清除，明确重新加载或解决后清除。 */
export const useGitConflictDraftStore = create<GitConflictDraftState>((set, get) => ({
  drafts: {},
  busy: {},
  setOperationBusy: (projectPath, busy) => {
    if (busy && get().busy[projectPath]) return false;
    set(state => ({ busy: { ...state.busy, [projectPath]: busy } }));
    return true;
  },
  setDraft: (key, detail) => set(state => {
    const result = detail.mergedContent ?? detail.oursContent ?? detail.theirsContent ?? "";
    return { drafts: { ...state.drafts, [key]: { detail, result, initialResult: result } } };
  }),
  setResult: (key, result) => set(state => {
    const draft = state.drafts[key];
    return draft ? { drafts: { ...state.drafts, [key]: { ...draft, result } } } : state;
  }),
  clearDraft: key => set(state => {
    const drafts = { ...state.drafts };
    delete drafts[key];
    return { drafts };
  }),
}));

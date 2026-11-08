import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import { getFileDocument, retainFileDocument } from "@/lib/fileDocument";

export function useFileDocument(projectPath: string, path: string, active: boolean) {
  const document = useMemo(() => getFileDocument(projectPath, path), [projectPath, path]);
  const state = useStore(document.store);
  useEffect(() => retainFileDocument(projectPath, path), [projectPath, path]);
  useEffect(() => {
    if (document.store.getState().status) void document.refresh();
    else void document.load();
  }, [document]);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void document.refresh(), 3000);
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ projectPath?: string; path?: string }>).detail;
      if (detail?.projectPath === projectPath && (!detail.path || detail.path === path)) void document.refresh();
    };
    window.addEventListener("termflow:git-refresh", refresh);
    window.addEventListener("git:file-change", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("termflow:git-refresh", refresh);
      window.removeEventListener("git:file-change", refresh);
    };
  }, [active, document, path, projectPath]);
  useEffect(() => {
    if (!active || state.autoSavePaused || state.loading || state.saving || state.conflict || state.status?.readOnly || state.content === state.savedContent) return;
    const timer = window.setTimeout(() => void document.save(), 1500);
    return () => window.clearTimeout(timer);
  }, [active, document, state]);
  useEffect(() => {
    if (!active) return;
    const save = () => { void document.save(); };
    window.addEventListener("blur", save);
    return () => {
      window.removeEventListener("blur", save);
      void document.save();
    };
  }, [active, document]);
  return { ...state, document, isDirty: state.content !== state.savedContent };
}

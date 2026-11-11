import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import i18n from "@/i18n";
import { chooseProjectIconImage, detectProjectIcon, ensureProjectIconPreference, loadProjectIconPreferences, saveProjectIconPreference } from "@/lib/api";
import { projectPathKey } from "@/lib/openProjects";
import { getProjectIconColor, isProjectIconEmoji } from "@/lib/projectIcons";
import type { ProjectIconPreference, ProjectIconsState } from "@/store/types";

let initialization: Promise<void> | null = null;

function samePreference(left: ProjectIconPreference | undefined, right: ProjectIconPreference): boolean {
  return !!left && left.revision === right.revision && left.color === right.color
    && left.mode === right.mode && left.emoji === right.emoji && left.image === right.image;
}

// 图标检测、加载进度和编辑草稿不应反复写入没有变化的颜色缓存。
let savedColors: string | null = null;
const colorStorage = {
  getItem(name: string): string | null {
    savedColors = typeof localStorage === "undefined" ? null : localStorage.getItem(name);
    return savedColors;
  },
  setItem(name: string, value: string): void {
    if (value === savedColors) return;
    if (typeof localStorage !== "undefined") localStorage.setItem(name, value);
    savedColors = value;
  },
  removeItem(name: string): void {
    if (typeof localStorage !== "undefined") localStorage.removeItem(name);
    savedColors = null;
  },
};

export const useProjectIconsStore = create<ProjectIconsState>()(persist((set, get) => ({
  icons: {}, loading: {}, preferences: {}, colors: {}, initialized: false, editor: null,
  setPreference: (path, preference) => {
    const key = projectPathKey(path);
    const previous = get().preferences[key];
    if ((previous?.revision ?? -1) > preference.revision || samePreference(previous, preference)) return;
    set((state) => ({ preferences: { ...state.preferences, [key]: preference }, colors: { ...state.colors, [key]: preference.color } }));
  },
  setInitialized: async (legacyPaths) => {
    if (initialization) return initialization;
    if (get().initialized) return;
    initialization = (async () => {
      const loaded = await loadProjectIconPreferences([...new Set(legacyPaths)].filter(Boolean).map((path) => ({ path, color: getProjectIconColor(path, 6) })));
      // 整批合并只提交一次；初始化期间收到的新修订与已加载图片不能被旧快照覆盖。
      set((state) => {
        const preferences = { ...state.preferences };
        const colors = { ...state.colors };
        for (const [path, preference] of Object.entries(loaded)) {
          const key = projectPathKey(path);
          const previous = preferences[key];
          if (previous && previous.revision >= preference.revision) continue;
          preferences[key] = preference;
          colors[key] = preference.color;
        }
        return { preferences, colors, initialized: true };
      });
    })();
    try { await initialization; } finally { initialization = null; }
  },
  setProjectIcon: async (path) => {
    const key = projectPathKey(path);
    const state = get();
    if (state.loading[key] || (state.icons[key] && Date.now() - state.icons[key].checkedAt < 60_000)) return;
    set({ loading: { ...state.loading, [key]: true } });
    try {
      const preference = get().preferences[key];
      if (get().initialized && (!preference || (preference.mode === "image" && !preference.image))) {
        get().setPreference(path, await ensureProjectIconPreference(path));
      }
      const src = await detectProjectIcon(path);
      set((current) => ({ icons: { ...current.icons, [key]: { src, checkedAt: Date.now() } } }));
    } catch {
      // 暂时不可用时保留已有图标，下次打开菜单可重试。
    } finally {
      set((current) => ({ loading: { ...current.loading, [key]: false } }));
    }
  },
  setProjectIconFailed: (path, src) => {
    const key = projectPathKey(path);
    if (get().icons[key]?.src !== src) return;
    set((state) => ({ icons: { ...state.icons, [key]: { src: null, checkedAt: Date.now() } } }));
  },
  setEditor: async (project) => {
    const key = projectPathKey(project.path);
    const draft = get().preferences[key] ?? { mode: "auto" as const, color: get().colors[key] ?? getProjectIconColor(project.path, 6), revision: 0 };
    set({ editor: { project, draft: { ...draft }, loading: true, loaded: false, saving: false, importing: false, error: null } });
    try {
      if (initialization) await initialization;
      if (!get().initialized) throw new Error("Icon preferences are not initialized");
      const preference = await ensureProjectIconPreference(project.path);
      get().setPreference(project.path, preference);
      if (get().editor?.project === project) set((state) => ({ editor: state.editor ? { ...state.editor, draft: { ...preference }, loading: false, loaded: true } : null }));
    } catch {
      if (get().editor?.project === project) set((state) => ({ editor: state.editor ? { ...state.editor, loading: false, error: i18n.t("projectIcons.loadFailed") } : null }));
    }
  },
  setEditorDraft: (patch) => set((state) => ({ editor: state.editor && !state.editor.saving && !state.editor.importing && !state.editor.loading && state.editor.loaded ? { ...state.editor, draft: { ...state.editor.draft, ...patch }, error: null } : state.editor })),
  setEditorClosed: () => { if (!get().editor?.saving) set({ editor: null }); },
  setEditorImage: async () => {
    const editor = get().editor;
    if (!editor || editor.saving || editor.importing || editor.loading || !editor.loaded) return;
    set({ editor: { ...editor, importing: true, error: null } });
    try {
      const image = await chooseProjectIconImage();
      if (get().editor?.project !== editor.project) return;
      set((state) => ({ editor: state.editor ? { ...state.editor, importing: false, draft: image ? { ...state.editor.draft, mode: "image", image } : state.editor.draft } : null }));
    } catch {
      if (get().editor?.project === editor.project) set((state) => ({ editor: state.editor ? { ...state.editor, importing: false, error: i18n.t("projectIcons.imageFailed") } : null }));
    }
  },
  setEditorSaved: async () => {
    const editor = get().editor;
    if (!editor || editor.saving || editor.importing || editor.loading || !editor.loaded) return;
    if (editor.draft.mode === "emoji" && !isProjectIconEmoji(editor.draft.emoji ?? "")) {
      set({ editor: { ...editor, error: i18n.t("projectIcons.emojiInvalid") } }); return;
    }
    if (editor.draft.mode === "image" && !editor.draft.image) {
      set({ editor: { ...editor, error: i18n.t("projectIcons.imageRequired") } }); return;
    }
    set({ editor: { ...editor, saving: true, error: null } });
    try {
      // 只保存当前模式需要的数据，避免无用图片长期占用空间。
      const { color, mode, revision } = editor.draft;
      const preference = await saveProjectIconPreference(editor.project.path, { color, mode, revision, ...(mode === "emoji" ? { emoji: editor.draft.emoji?.trim() } : {}), ...(mode === "image" ? { image: editor.draft.image } : {}) });
      get().setPreference(editor.project.path, preference);
      set({ editor: null });
    } catch (error) {
      const conflict = String(error).includes("PROJECT_ICON_CONFLICT");
      set((state) => ({ editor: state.editor ? { ...state.editor, saving: false, loaded: !conflict, error: i18n.t(conflict ? "projectIcons.conflict" : "projectIcons.saveFailed") } : null }));
    }
  },
}), {
  name: "krosna-project-icon-colors",
  storage: createJSONStorage(() => colorStorage),
  // 图片和完整偏好由 SQLite 保存；localStorage 只缓存颜色，避免重复存储大图。
  partialize: (state) => ({ colors: state.colors }),
}));

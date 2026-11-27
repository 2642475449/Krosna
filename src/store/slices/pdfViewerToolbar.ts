import { create } from "zustand";

export type PdfZoomMode = "manual" | "width" | "page";

export interface PdfViewerToolbarState {
  pageNumber: number;
  pageCount: number;
  zoomPercent: number;
  zoomMode: PdfZoomMode;
  canZoomOut: boolean;
  canZoomIn: boolean;
  onPrevPage: () => void;
  onNextPage: () => void;
  onJumpToPage: (page: number) => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  onOpenExternal: () => void;
}

interface PdfViewerToolbarStore {
  viewers: Record<string, PdfViewerToolbarState>;
  setViewerToolbar: (tabId: string, state: PdfViewerToolbarState) => void;
  removeViewerToolbar: (tabId: string) => void;
}

// PDF 工具栏状态仅属于当前窗口的预览实例，不持久化。
export const usePdfViewerToolbarStore = create<PdfViewerToolbarStore>((set) => ({
  viewers: {},
  setViewerToolbar: (tabId, toolbarState) =>
    set((state) => ({
      viewers: { ...state.viewers, [tabId]: toolbarState },
    })),
  removeViewerToolbar: (tabId) =>
    set((state) => {
      if (!(tabId in state.viewers)) return state;
      const viewers = { ...state.viewers };
      delete viewers[tabId];
      return { viewers };
    }),
}));

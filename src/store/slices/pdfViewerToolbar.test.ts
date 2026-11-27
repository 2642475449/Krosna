import { describe, expect, it } from "vitest";
import { usePdfViewerToolbarStore, type PdfViewerToolbarState } from "./pdfViewerToolbar";

function createToolbarState(overrides: Partial<PdfViewerToolbarState> = {}): PdfViewerToolbarState {
  return {
    pageNumber: 1,
    pageCount: 23,
    zoomPercent: 100,
    zoomMode: "page",
    canZoomOut: true,
    canZoomIn: true,
    onPrevPage: () => {},
    onNextPage: () => {},
    onJumpToPage: () => {},
    onZoomOut: () => {},
    onZoomIn: () => {},
    onFitWidth: () => {},
    onFitPage: () => {},
    onOpenExternal: () => {},
    ...overrides,
  };
}

describe("usePdfViewerToolbarStore", () => {
  it("registers, updates, and removes toolbar state per tabId", () => {
    const store = usePdfViewerToolbarStore.getState();
    store.setViewerToolbar("tab-pdf-1", createToolbarState({ pageNumber: 3, zoomPercent: 147 }));

    expect(usePdfViewerToolbarStore.getState().viewers["tab-pdf-1"]?.pageNumber).toBe(3);
    expect(usePdfViewerToolbarStore.getState().viewers["tab-pdf-1"]?.zoomPercent).toBe(147);

    usePdfViewerToolbarStore.getState().removeViewerToolbar("tab-pdf-1");
    expect(usePdfViewerToolbarStore.getState().viewers["tab-pdf-1"]).toBeUndefined();
  });

  it("keeps multiple split-pane PDF tabs isolated", () => {
    const store = usePdfViewerToolbarStore.getState();
    store.setViewerToolbar("tab-a", createToolbarState({ pageNumber: 2 }));
    store.setViewerToolbar("tab-b", createToolbarState({ pageNumber: 9 }));

    expect(usePdfViewerToolbarStore.getState().viewers["tab-a"]?.pageNumber).toBe(2);
    expect(usePdfViewerToolbarStore.getState().viewers["tab-b"]?.pageNumber).toBe(9);

    usePdfViewerToolbarStore.getState().removeViewerToolbar("tab-a");
    expect(usePdfViewerToolbarStore.getState().viewers["tab-a"]).toBeUndefined();
    expect(usePdfViewerToolbarStore.getState().viewers["tab-b"]?.pageNumber).toBe(9);

    usePdfViewerToolbarStore.getState().removeViewerToolbar("tab-b");
  });
});

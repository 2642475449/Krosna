import { FilePdfOutlined, FolderOpenOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Spin } from "antd";
import { PdfToolbarControls } from "@/components/pdf/PdfToolbarControls";
import { usePdfViewerToolbarStore, type PdfZoomMode } from "@/store/slices/pdfViewerToolbar";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const SCALE_STEP = 0.25;
const PAGE_PADDING = 24;
const DEFAULT_PAGE_SIZE = { width: 612, height: 792 };

type ZoomMode = PdfZoomMode;

interface PageSize {
  width: number;
  height: number;
}

interface ZoomAnchor {
  pageNumber: number;
  xRatio: number;
  yRatio: number;
  clientX: number;
  clientY: number;
}

interface PdfPreviewProps {
  tabId?: string;
  data: Uint8Array | null;
  loadError?: string | null;
  onOpenExternal: () => void | Promise<void>;
}

interface PdfPageCanvasProps {
  pdfDocument: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  fallbackSize: PageSize;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  onRenderError: (error: string) => void;
}

function describePdfError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(scale * 100) / 100));
}

function PdfPageCanvas({
  pdfDocument,
  pageNumber,
  scale,
  fallbackSize,
  scrollContainerRef,
  onRenderError,
}: PdfPageCanvasProps) {
  const { t } = useTranslation();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageRef = useRef<PDFPageProxy | null>(null);
  const [pageSize, setPageSize] = useState(fallbackSize);
  const [shouldRender, setShouldRender] = useState(false);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const root = scrollContainerRef.current;
    if (!wrapper || !root) {
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      setShouldRender(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setShouldRender(entry.isIntersecting),
      {
        root,
        rootMargin: "150% 0px",
      },
    );
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [scrollContainerRef]);

  useEffect(() => {
    if (!shouldRender || !canvasRef.current) {
      return;
    }

    let disposed = false;
    let renderTask: RenderTask | null = null;
    setRendering(true);

    void (async () => {
      const page = pageRef.current ?? (await pdfDocument.getPage(pageNumber));
      pageRef.current = page;
      if (disposed || !canvasRef.current) {
        return;
      }

      const naturalViewport = page.getViewport({ scale: 1 });
      if (
        naturalViewport.width !== pageSize.width ||
        naturalViewport.height !== pageSize.height
      ) {
        setPageSize({
          width: naturalViewport.width,
          height: naturalViewport.height,
        });
      }

      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error(t("fileTabs.pdfCanvasUnavailable"));
      }

      const viewport = page.getViewport({ scale });
      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
      canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
      renderTask = page.render({
        canvasContext: context,
        viewport,
        transform:
          outputScale === 1
            ? undefined
            : [outputScale, 0, 0, outputScale, 0, 0],
      });
      await renderTask.promise;
    })()
      .catch((reason) => {
        if (!disposed && reason?.name !== "RenderingCancelledException") {
          onRenderError(describePdfError(reason, t("fileTabs.pdfRenderFailed")));
        }
      })
      .finally(() => {
        if (!disposed) {
          setRendering(false);
        }
      });

    return () => {
      disposed = true;
      renderTask?.cancel();
    };
  }, [
    onRenderError,
    pageNumber,
    pageSize.height,
    pageSize.width,
    pdfDocument,
    scale,
    shouldRender,
    t,
  ]);

  return (
    <div
      ref={wrapperRef}
      data-pdf-page={pageNumber}
      className="relative shrink-0 overflow-hidden bg-white shadow-lg"
      style={{
        width: Math.max(1, pageSize.width * scale),
        height: Math.max(1, pageSize.height * scale),
      }}
      aria-label={t("fileTabs.pdfPageAria", { page: pageNumber })}
    >
      {shouldRender ? (
        <>
          <canvas ref={canvasRef} className="block h-full w-full bg-white" />
          {rendering ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/60">
              <Spin size="small" />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export default function PdfPreview({
  tabId,
  data,
  loadError = null,
  onOpenExternal,
}: PdfPreviewProps) {
  const { t } = useTranslation();
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pendingZoomAnchorRef = useRef<ZoomAnchor | null>(null);
  const lastWheelZoomRef = useRef(0);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [fallbackPageSize, setFallbackPageSize] =
    useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("page");
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(loadError);

  useEffect(() => {
    setPdfDocument(null);
    setFallbackPageSize(DEFAULT_PAGE_SIZE);
    setPageNumber(1);
    setScale(1);
    setZoomMode("page");
    setError(loadError);

    if (!data || loadError) {
      setLoading(false);
      return;
    }

    let disposed = false;
    setLoading(true);
    const loadingTask = getDocument({ data: data.slice() });

    void loadingTask.promise
      .then(async (nextDocument) => {
        const firstPage = await nextDocument.getPage(1);
        if (disposed) {
          await nextDocument.destroy();
          return;
        }
        const viewport = firstPage.getViewport({ scale: 1 });
        setFallbackPageSize({
          width: viewport.width,
          height: viewport.height,
        });
        setPdfDocument(nextDocument);
        setError(null);
      })
      .catch((reason) => {
        if (!disposed) {
          setError(describePdfError(reason, t("fileTabs.pdfLoadFailed")));
        }
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false);
        }
      });

    return () => {
      disposed = true;
      void loadingTask.destroy();
    };
  }, [data, loadError, t]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const updateSize = () => {
      setContainerSize({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };
    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [pdfDocument]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !pdfDocument) {
      return;
    }

    const visiblePages = new Map<number, number>();
    const pageElements = Array.from(
      container.querySelectorAll<HTMLElement>("[data-pdf-page]"),
    );

    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.pdfPage);
          if (entry.isIntersecting) {
            visiblePages.set(page, entry.intersectionRect.height);
          } else {
            visiblePages.delete(page);
          }
        }

        let mostVisiblePage = 1;
        let largestVisibleHeight = -1;
        for (const [page, visibleHeight] of visiblePages) {
          if (visibleHeight > largestVisibleHeight) {
            mostVisiblePage = page;
            largestVisibleHeight = visibleHeight;
          }
        }
        if (largestVisibleHeight >= 0) {
          setPageNumber(mostVisiblePage);
        }
      },
      {
        root: container,
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      },
    );

    pageElements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [pdfDocument]);

  const findZoomAnchor = useCallback(
    (clientX?: number, clientY?: number): ZoomAnchor | null => {
      const container = scrollContainerRef.current;
      if (!container) {
        return null;
      }

      const containerRect = container.getBoundingClientRect();
      const anchorX = clientX ?? containerRect.left + containerRect.width / 2;
      const anchorY = clientY ?? containerRect.top + containerRect.height / 2;
      const pointedElement = globalThis.document.elementFromPoint(anchorX, anchorY);
      const pointedPage = pointedElement?.closest<HTMLElement>("[data-pdf-page]");
      const pageElement =
        pointedPage ??
        container.querySelector<HTMLElement>(
          `[data-pdf-page="${pageNumber}"]`,
        );
      if (!pageElement) {
        return null;
      }

      const pageRect = pageElement.getBoundingClientRect();
      return {
        pageNumber: Number(pageElement.dataset.pdfPage),
        xRatio: Math.min(1, Math.max(0, (anchorX - pageRect.left) / pageRect.width)),
        yRatio: Math.min(1, Math.max(0, (anchorY - pageRect.top) / pageRect.height)),
        clientX: anchorX,
        clientY: anchorY,
      };
    },
    [pageNumber],
  );

  const changeScale = useCallback(
    (
      nextScale: number,
      nextMode: ZoomMode = "manual",
      clientX?: number,
      clientY?: number,
    ) => {
      const clampedScale = clampScale(nextScale);
      if (clampedScale === scale && nextMode === zoomMode) {
        return;
      }
      pendingZoomAnchorRef.current = findZoomAnchor(clientX, clientY);
      setZoomMode(nextMode);
      setScale(clampedScale);
    },
    [findZoomAnchor, scale, zoomMode],
  );

  useLayoutEffect(() => {
    const anchor = pendingZoomAnchorRef.current;
    const container = scrollContainerRef.current;
    if (!anchor || !container) {
      return;
    }

    pendingZoomAnchorRef.current = null;
    const pageElement = container.querySelector<HTMLElement>(
      `[data-pdf-page="${anchor.pageNumber}"]`,
    );
    if (!pageElement) {
      return;
    }

    const pageRect = pageElement.getBoundingClientRect();
    container.scrollLeft +=
      pageRect.left + pageRect.width * anchor.xRatio - anchor.clientX;
    container.scrollTop +=
      pageRect.top + pageRect.height * anchor.yRatio - anchor.clientY;
  }, [scale]);

  useEffect(() => {
    if (zoomMode === "manual" || !containerSize.width || !containerSize.height) {
      return;
    }

    const widthScale =
      (containerSize.width - PAGE_PADDING * 2) / fallbackPageSize.width;
    const nextScale =
      zoomMode === "width"
        ? widthScale
        : Math.min(
            widthScale,
            (containerSize.height - PAGE_PADDING * 2) /
              fallbackPageSize.height,
          );
    changeScale(nextScale, zoomMode);
  }, [
    changeScale,
    containerSize.height,
    containerSize.width,
    fallbackPageSize.height,
    fallbackPageSize.width,
    zoomMode,
  ]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();
      const now = performance.now();
      if (now - lastWheelZoomRef.current < 50 || event.deltaY === 0) {
        return;
      }
      lastWheelZoomRef.current = now;
      changeScale(
        scale + (event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP),
        "manual",
        event.clientX,
        event.clientY,
      );
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [changeScale, scale]);

  const openExternal = useCallback(() => {
    void Promise.resolve(onOpenExternal());
  }, [onOpenExternal]);

  const goToPage = useCallback((nextPage: number, behavior: ScrollBehavior = "smooth") => {
    if (!pdfDocument) {
      return;
    }
    const targetPage = Math.min(pdfDocument.numPages, Math.max(1, nextPage));
    const container = scrollContainerRef.current;
    const pageElement = container?.querySelector<HTMLElement>(
      `[data-pdf-page="${targetPage}"]`,
    );
    if (container && pageElement) {
      container.scrollTo({
        top: Math.max(0, pageElement.offsetTop - PAGE_PADDING),
        behavior,
      });
    }
    setPageNumber(targetPage);
  }, [pdfDocument]);

  useEffect(() => {
    if (!tabId) return;
    if (!pdfDocument || loading) {
      usePdfViewerToolbarStore.getState().removeViewerToolbar(tabId);
      return;
    }
    usePdfViewerToolbarStore.getState().setViewerToolbar(tabId, {
      pageNumber,
      pageCount: pdfDocument.numPages,
      zoomPercent: Math.round(scale * 100),
      zoomMode,
      canZoomOut: scale > MIN_SCALE,
      canZoomIn: scale < MAX_SCALE,
      onPrevPage: () => goToPage(pageNumber - 1),
      onNextPage: () => goToPage(pageNumber + 1),
      onJumpToPage: (page) => goToPage(page),
      onZoomOut: () => changeScale(scale - SCALE_STEP),
      onZoomIn: () => changeScale(scale + SCALE_STEP),
      onFitWidth: () => setZoomMode("width"),
      onFitPage: () => setZoomMode("page"),
      onOpenExternal: openExternal,
    });
  }, [tabId, pdfDocument, loading, pageNumber, scale, zoomMode, goToPage, changeScale, openExternal]);

  useEffect(() => {
    if (!tabId) return;
    return () => {
      usePdfViewerToolbarStore.getState().removeViewerToolbar(tabId);
    };
  }, [tabId]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spin description={t("fileTabs.pdfLoading")} />
      </div>
    );
  }

  if (!pdfDocument) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Empty
          image={
            <FilePdfOutlined
              style={{ fontSize: 52, color: "var(--cs-text-tertiary)" }}
            />
          }
          description={
            <div className="flex flex-col items-center gap-3">
              <span>{error ?? t("fileTabs.pdfLoadFailed")}</span>
              <Button icon={<FolderOpenOutlined />} onClick={openExternal}>
                {t("common.openInAssociatedApp")}
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  const pageCount = pdfDocument.numPages;
  const zoomPercent = Math.round(scale * 100);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!tabId ? (
        <div className="flex min-h-10 shrink-0 items-center justify-end border-b border-[var(--cs-border-sidebar)] px-3 py-1.5">
          <PdfToolbarControls
            pageNumber={pageNumber}
            pageCount={pageCount}
            zoomPercent={zoomPercent}
            zoomMode={zoomMode}
            canZoomOut={scale > MIN_SCALE}
            canZoomIn={scale < MAX_SCALE}
            onPrevPage={() => goToPage(pageNumber - 1)}
            onNextPage={() => goToPage(pageNumber + 1)}
            onJumpToPage={(page) => goToPage(page)}
            onZoomOut={() => changeScale(scale - SCALE_STEP)}
            onZoomIn={() => changeScale(scale + SCALE_STEP)}
            onFitWidth={() => setZoomMode("width")}
            onFitPage={() => setZoomMode("page")}
            onOpenExternal={openExternal}
          />
        </div>
      ) : null}
      {error ? (
        <Alert
          className="m-3 shrink-0"
          type="error"
          showIcon
          closable
          title={error}
          action={
            <Button size="small" onClick={openExternal}>
              {t("common.openInAssociatedApp")}
            </Button>
          }
          onClose={() => setError(null)}
        />
      ) : null}
      <div
        ref={scrollContainerRef}
        className="app-thin-scrollbar min-h-0 flex-1 overflow-auto bg-[var(--cs-bg-card-solid)]"
        style={{ overflowAnchor: "none" }}
      >
        <div className="flex w-max min-w-full flex-col items-center gap-4 p-6">
          {Array.from({ length: pageCount }, (_, index) => {
            const currentPage = index + 1;
            return (
              <PdfPageCanvas
                key={currentPage}
                pdfDocument={pdfDocument}
                pageNumber={currentPage}
                scale={scale}
                fallbackSize={fallbackPageSize}
                scrollContainerRef={scrollContainerRef}
                onRenderError={setError}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

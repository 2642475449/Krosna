import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Dropdown, Empty, Segmented, Spin, Tag, message } from "antd";
import {
  EllipsisOutlined,
  FileMarkdownOutlined,
  FileOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { getTerminalTheme } from "@/lib/terminalTheme";
import { openInAssociatedApplication } from "@/lib/api";
import { useFileDocument } from "@/hooks/useFileDocument";
import MonacoTextEditor from "@/components/editors/MonacoTextEditor";
import {
  consumePendingFileNavigation,
  FILE_NAVIGATION_EVENT,
  isNavigationForPath,
  type FileNavigationRequest,
  type FileRevealTarget,
} from "@/lib/fileNavigation";
import MarkdownPreview from "@/components/markdown/MarkdownPreview";
import { replaceMarkdownSourceBlock } from "@/components/markdown/markdownSourceBlocks";
import { revealExplorerPath } from "@/lib/explorer";
import { supportsOfficePreview } from "@/lib/officePreview";
import { getFilePreviewErrorMessage, isFilePreviewSizeLimitError } from "@/lib/filePreviewError";
import { useAppStore } from "@/store";
import { useTranslation } from "react-i18next";

type FileKind = "text" | "image" | "pdf" | "binary";
const MAX_VISIBLE_BREADCRUMB_ITEMS = 4;

export interface FileDocumentViewProps {
  tabId?: string;
  onOpenProjectPath?: (path: string) => void;
  renderActions?: (save: () => Promise<boolean>) => ReactNode;
  projectPath: string;
  path: string;
  isActive: boolean;
}

const PdfPreview = lazy(() => import("@/components/pdf/PdfPreview"));
const OfficeFilePreview = lazy(() => import("@/components/documents/OfficeFilePreview"));

interface FileBreadcrumbItem {
  label: string;
  path: string;
  kind: "file" | "directory";
}

type MarkdownViewMode = "edit" | "preview";

function inferFileKind(path: string): FileKind {
  const normalizedPath = path.replace(/[\\/]+$/, "");
  const fileName = normalizedPath.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "pdf") {
    return "pdf";
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(extension)) {
    return "image";
  }
  if (
    [
      "txt", "md", "markdown", "rst", "adoc", "json", "jsonc", "json5", "ndjson",
      "js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "vue", "svelte", "astro",
      "rs", "css", "scss", "sass", "less", "styl", "html", "htm", "xhtml", "xml", "xsd",
      "xsl", "xslt", "jsp", "jspf", "tag", "tagx", "tld", "ftl", "vm", "ejs", "erb", "hbs",
      "handlebars", "mustache", "twig", "liquid", "php", "phtml", "asp", "aspx", "cshtml", "razor",
      "yml", "yaml", "toml", "properties", "ini", "conf", "cfg", "env", "sh", "bash", "zsh",
      "fish", "ps1", "psm1", "psd1", "bat", "cmd", "log", "csv", "tsv", "sql", "py", "pyw",
      "pyi", "java", "kt", "kts", "groovy", "gradle", "scala", "go", "c", "cc", "cp", "cpp",
      "cxx", "h", "hh", "hpp", "hxx", "cs", "fs", "fsx", "vb", "swift", "m", "mm", "rb",
      "rake", "gemspec", "pl", "pm", "lua", "r", "dart", "ex", "exs", "erl", "hrl", "clj",
      "cljs", "cljc", "edn", "hs", "lhs", "jl", "nim", "zig", "sol", "lock",
    ].includes(extension)
  ) {
    return "text";
  }
  return "binary";
}

function isMarkdownFile(path: string) {
  const normalizedPath = path.replace(/[\\/]+$/, "");
  const fileName = normalizedPath.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return extension === "md" || extension === "markdown";
}

function formatFileSize(sizeBytes: number | null): string | null {
  if (sizeBytes === null || !Number.isFinite(sizeBytes)) {
    return null;
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = sizeBytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const digits = unitIndex === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

function joinPath(basePath: string, segments: string[]): string {
  const separator = basePath.includes("\\") ? "\\" : "/";
  const normalizedBasePath = basePath.replace(/[\\/]+$/, "");
  if (segments.length === 0) {
    return normalizedBasePath;
  }

  return [normalizedBasePath, ...segments].join(separator);
}

function buildFileBreadcrumbs(projectPath: string, filePath: string): FileBreadcrumbItem[] {
  const normalizedProjectPath = projectPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedFilePath = filePath.replace(/\\/g, "/");
  const projectPrefix = `${normalizedProjectPath}/`;

  if (!normalizedFilePath.startsWith(projectPrefix)) {
    const fallbackLabel = filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
    return [
      {
        label: fallbackLabel,
        path: filePath,
        kind: "file",
      },
    ];
  }

  const relativePath = normalizedFilePath.slice(normalizedProjectPath.length + 1);
  const segments = relativePath.split("/").filter(Boolean);

  return segments.map((segment, index) => ({
    label: segment,
    path: joinPath(projectPath, segments.slice(0, index + 1)),
    kind: index === segments.length - 1 ? "file" : "directory",
  }));
}

function collapseBreadcrumbs(items: FileBreadcrumbItem[]) {
  if (items.length <= MAX_VISIBLE_BREADCRUMB_ITEMS) {
    return {
      leadingItems: items,
      hiddenItems: [] as FileBreadcrumbItem[],
      trailingItems: [] as FileBreadcrumbItem[],
    };
  }

  return {
    leadingItems: items.slice(0, 1),
    hiddenItems: items.slice(1, -2),
    trailingItems: items.slice(-2),
  };
}

function FileDocumentView({ tabId, projectPath, path, isActive, onOpenProjectPath, renderActions }: FileDocumentViewProps) {
  const { t } = useTranslation();
  const activeTheme = useAppStore((s) => s.activeTheme());
  const registerFileDocument = useAppStore((s) => s.registerFileDocument);
  const setTabDirty = useAppStore((s) => s.setTabDirty);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  const setActiveSidebarSection = useAppStore((s) => s.setActiveSidebarSection);
  const openFileTab = useAppStore((s) => s.openFileTab);
  const promoteTab = useAppStore((s) => s.promoteTab);
  const tab = useAppStore((s) => tabId ? s.tabsById[tabId] : undefined);
  const { document, status, loading, content, imageSrc, pdfData, error, conflict, isDirty } = useFileDocument(projectPath, path, isActive);
  const errorMessage = error ? getFilePreviewErrorMessage(error) : null;
  const kind = status?.kind ?? inferFileKind(path);
  const readOnly = status?.readOnly ?? true;
  const sizeBytes = status?.sizeBytes ?? null;
  const largeFile = status?.largeFile ?? false;
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  useEffect(() => setImageLoadFailed(false), [imageSrc]);
  useEffect(() => {
    if (status) registerFileDocument(status);
  }, [registerFileDocument, status]);
  useEffect(() => {
    if (tabId) setTabDirty(tabId, isDirty);
  }, [isDirty, setTabDirty, tabId]);
  const [markdownViewMode, setMarkdownViewMode] = useState<MarkdownViewMode>("preview");
  const [revealTarget, setRevealTarget] = useState<FileRevealTarget | null>(() =>
    tabId ? consumePendingFileNavigation(path) : null
  );
  const markdownFile = isMarkdownFile(path);

  // 滚动位置记忆
  const previewScrollTopRef = useRef<number>(0);
  const editorScrollTopRef = useRef<number>(0);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);

  // 保存预览区滚动位置
  const handlePreviewScroll = useCallback(() => {
    if (previewContainerRef.current) {
      previewScrollTopRef.current = previewContainerRef.current.scrollTop;
    }
  }, []);

  // 恢复滚动位置
  useEffect(() => {
    if (markdownViewMode === "preview" && previewContainerRef.current) {
      requestAnimationFrame(() => {
        if (previewContainerRef.current) {
          previewContainerRef.current.scrollTop = previewScrollTopRef.current;
        }
      });
    }
    // 编辑器的滚动位置由 MonacoTextEditor 的 onScroll 回调保存为比例
    // 恢复需要通过 Monaco Editor API，这里暂时不处理
    // 因为 Monaco Editor 会在组件挂载时自动恢复状态
  }, [markdownViewMode]);

  // 重置滚动位置（切换文件时）
  useEffect(() => {
    previewScrollTopRef.current = 0;
    editorScrollTopRef.current = 0;
  }, [path]);

  useEffect(() => {
    setMarkdownViewMode("preview");
  }, [path]);

  useEffect(() => {
    if (revealTarget) {
      setMarkdownViewMode("edit");
    }
  }, [revealTarget]);

  useEffect(() => {
    if (!tabId) return;
    const pending = consumePendingFileNavigation(path);
    if (pending) {
      setRevealTarget(pending);
      setMarkdownViewMode("edit");
    }

    const handleNavigation = (event: Event) => {
      const request = (event as CustomEvent<FileNavigationRequest>).detail;
      if (!request || !isNavigationForPath(request.path, path)) return;
      consumePendingFileNavigation(path);
      setRevealTarget(request);
      setMarkdownViewMode("edit");
    };
    window.addEventListener(FILE_NAVIGATION_EVENT, handleNavigation);
    return () => window.removeEventListener(FILE_NAVIGATION_EVENT, handleNavigation);
  }, [path, tabId]);

  const handleSave = useCallback(async (options?: { silent?: boolean }) => {
    const saved = await document.save();
    if (saved && !options?.silent) message.success(t("fileTabs.saveSuccess"));
    return saved;
  }, [document, t]);

  function handleEditorChange(value: string) {
    document.setContent(value);
    if (tabId && tab?.preview) {
      promoteTab(tabId);
    }
  }

  const fileSizeLabel = formatFileSize(sizeBytes);
  const breadcrumbs = useMemo(() => buildFileBreadcrumbs(projectPath, path), [path, projectPath]);
  const collapsedBreadcrumbs = useMemo(() => collapseBreadcrumbs(breadcrumbs), [breadcrumbs]);
  const handleRevealBreadcrumb = useCallback(
    (targetPath: string, targetKind: "file" | "directory") => {
      setSidebarCollapsed(false);
      setActiveSidebarSection("project");

      const dispatchReveal = () => revealExplorerPath(targetPath, targetKind);
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(dispatchReveal);
        });
        return;
      }

      window.setTimeout(dispatchReveal, 32);
    },
    [setActiveSidebarSection, setSidebarCollapsed]
  );
  const handleOpenExternalLink = useCallback(async (href: string) => {
    try {
      await openInAssociatedApplication(href);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("fileTabs.openFailed"));
    }
  }, [t]);
  const handleOpenProjectMarkdownPath = useCallback((targetPath: string) => {
    if (onOpenProjectPath) onOpenProjectPath(targetPath);
    else openFileTab(targetPath);
  }, [onOpenProjectPath, openFileTab]);
  const collapsedBreadcrumbMenuItems = useMemo(
    () =>
      collapsedBreadcrumbs.hiddenItems.map((item) => ({
        key: item.path,
        label: item.label,
        onClick: () => handleRevealBreadcrumb(item.path, item.kind),
      })),
    [collapsedBreadcrumbs.hiddenItems, handleRevealBreadcrumb]
  );
  const visibleBreadcrumbs = useMemo(
    () => [...collapsedBreadcrumbs.leadingItems, ...collapsedBreadcrumbs.trailingItems],
    [collapsedBreadcrumbs.leadingItems, collapsedBreadcrumbs.trailingItems]
  );
  const breadcrumbNode = (
    <div className="min-w-0 flex-1 overflow-x-auto" title={path}>
      <div className="flex min-w-max items-center gap-1 text-[13px] text-[var(--cs-text-secondary)]">
        {visibleBreadcrumbs.map((item, index) => {
          const shouldInsertCollapsedMenu =
            index === collapsedBreadcrumbs.leadingItems.length &&
            collapsedBreadcrumbs.hiddenItems.length > 0;
          const isCurrent = item.path === breadcrumbs[breadcrumbs.length - 1]?.path;
          return (
            <Fragment key={`${item.path}-${item.kind}`}>
              {(index > 0 || shouldInsertCollapsedMenu) && (
                <RightOutlined className="text-[10px] text-[var(--cs-text-quaternary)]" />
              )}
              {shouldInsertCollapsedMenu && (
                <Fragment>
                  <Dropdown menu={{ items: collapsedBreadcrumbMenuItems }} trigger={["click"]}>
                    <button
                      type="button"
                      className="rounded-sm bg-transparent border-0 px-1 py-0.5 leading-none text-[var(--cs-text-secondary)] transition-colors hover:text-[var(--cs-primary)]"
                      title={collapsedBreadcrumbs.hiddenItems.map((segment) => segment.label).join(" \\ ")}
                    >
                      <EllipsisOutlined />
                    </button>
                  </Dropdown>
                  <RightOutlined className="text-[10px] text-[var(--cs-text-quaternary)]" />
                </Fragment>
              )}
              <button
                type="button"
                className={`rounded-sm bg-transparent border-0 px-1 py-0.5 leading-none transition-colors ${
                  isCurrent
                    ? "text-[var(--cs-text-primary)] hover:text-[var(--cs-primary)]"
                    : "text-[var(--cs-text-secondary)] hover:text-[var(--cs-primary)]"
                }`}
                onClick={() => handleRevealBreadcrumb(item.path, item.kind)}
              >
                {item.label}
              </button>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
  const largeFileAlert =
    kind === "text" && largeFile ? (
      <div className="px-4 pt-3">
        <Alert
          type="info"
          showIcon
          title={t("fileTabs.largeFileReadOnly", { size: fileSizeLabel ?? "--" })}
        />
      </div>
    ) : null;

  const toolbar = (
    <div
        data-file-document-toolbar
        className="px-4 py-2 flex shrink-0 items-center gap-3"
        style={{ borderBottom: "1px solid var(--cs-border-sidebar)" }}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {markdownFile ? <FileMarkdownOutlined /> : <FileOutlined />}
          {breadcrumbNode}
          {readOnly && <Tag>{t("fileTabs.readOnly")}</Tag>}
          {largeFile && <Tag>{t("fileTabs.largeFile")}</Tag>}
        </div>
        {markdownFile && (!error || status) ? (
          <Segmented<MarkdownViewMode>
            size="small"
            value={markdownViewMode}
            onChange={(value) => setMarkdownViewMode(value)}
            options={[
              {
                value: "edit",
                label: t("fileTabs.markdownModeEdit"),
              },
              {
                value: "preview",
                label: t("fileTabs.markdownModePreview"),
              },
            ]}
          />
        ) : null}
        {renderActions?.(() => handleSave({ silent: true }))}
      </div>
  );

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spin description={t("fileTabs.loading")} />
      </div>
    );
  }

  if (isFilePreviewSizeLimitError(error)) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {toolbar}
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <Empty description={errorMessage}>
            <Button onClick={() => { void handleOpenExternalLink(path); }}>
              {t("common.openInAssociatedApp")}
            </Button>
          </Empty>
        </div>
      </div>
    );
  }

  if (kind === "image") {
    return (
      <div className="h-full flex flex-col min-h-0">
        {toolbar}
        <div className="flex-1 min-h-0 overflow-auto p-6 flex items-center justify-center">
          {imageSrc && !imageLoadFailed ? (
            <img
              src={imageSrc}
              alt={status?.name ?? path}
              className="max-w-full max-h-full object-contain"
              onError={() => setImageLoadFailed(true)}
            />
          ) : (
            <Empty description={errorMessage ?? t("fileTabs.openFailed")} />
          )}
        </div>
      </div>
    );
  }

  if (kind === "pdf") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {toolbar}
        <div className="min-h-0 flex-1">
          <Suspense fallback={<div className="flex h-full items-center justify-center"><Spin /></div>}>
            <PdfPreview
              data={pdfData}
              loadError={errorMessage}
              onOpenExternal={() => handleOpenExternalLink(path)}
            />
          </Suspense>
        </div>
      </div>
    );
  }

  if (kind === "binary") {
    if (supportsOfficePreview(path)) {
      return (
        <div className="flex h-full min-h-0 flex-col">
          {toolbar}
          <div className="min-h-0 flex-1">
            <Suspense fallback={<div className="flex h-full items-center justify-center"><Spin /></div>}>
              <OfficeFilePreview
                projectPath={projectPath}
                path={path}
                modifiedAtMs={status?.modifiedAtMs}
                sizeBytes={status?.sizeBytes}
              />
            </Suspense>
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-full min-h-0 flex-col">
        {toolbar}
        <div className="w-full min-h-0 flex-1 flex flex-col">
          <div className="h-full flex items-center justify-center px-6">
            <Empty
              image={<FileOutlined style={{ fontSize: 48, color: "var(--cs-text-tertiary)" }} />}
              description={errorMessage ?? t("fileTabs.binaryUnsupported")}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {largeFileAlert}
      {toolbar}
      {conflict ? (
        <Alert type="warning" showIcon title={t("fileTabs.externalChange")} action={
          <div className="flex gap-2">
            <Button size="small" onClick={() => { void document.load(true); }}>{t("fileTabs.reloadFromDisk")}</Button>
            <Button size="small" onClick={() => { void document.save(true); }}>{t("fileTabs.overwriteFile")}</Button>
          </div>
        } />
      ) : error && status ? <Alert type="error" showIcon title={errorMessage} /> : null}
      {error && !status ? (
        <div className="h-full flex items-center justify-center px-6">
          <Empty description={errorMessage} />
        </div>
      ) : markdownFile && markdownViewMode === "preview" ? (
        <div
          ref={previewContainerRef}
          className="app-markdown-preview-shell flex-1 min-h-0 overflow-auto p-5"
          style={{ background: getTerminalTheme(activeTheme).cssBackground }}
          onScroll={handlePreviewScroll}
        >
          <MarkdownPreview
            content={content}
            emptyText={t("fileTabs.markdownPreviewEmpty")}
            filePath={path}
            projectPath={projectPath}
            className="app-markdown-preview-surface"
            onEditBlock={readOnly ? undefined : (block, source) => {
              handleEditorChange(replaceMarkdownSourceBlock(content, block, source));
            }}
            editBlockLabel={t("fileTabs.markdownEditBlock")}
            finishEditingLabel={t("fileTabs.markdownFinishBlockEditing")}
            cancelEditingLabel={t("fileTabs.markdownCancelBlockEditing")}
            formattingMenuLabel={t("fileTabs.markdownFormattingMenu")}
            headingLabel={t("fileTabs.markdownHeading")}
            boldLabel={t("fileTabs.markdownBold")}
            italicLabel={t("fileTabs.markdownItalic")}
            inlineCodeLabel={t("fileTabs.markdownInlineCode")}
            linkLabel={t("fileTabs.markdownLink")}
            bulletListLabel={t("fileTabs.markdownBulletList")}
            orderedListLabel={t("fileTabs.markdownOrderedList")}
            onOpenExternalLink={(href) => {
              void handleOpenExternalLink(href);
            }}
            onOpenProjectPath={handleOpenProjectMarkdownPath}
          />
        </div>
      ) : (
        <MonacoTextEditor
          isActive={isActive}
          statusTabId={tabId}
          filePath={path}
          value={content}
          readOnly={readOnly}
          revealTarget={revealTarget}
          onChange={handleEditorChange}
          onSave={() => {
            void handleSave();
          }}
          saveEnabled={isDirty && !readOnly}
          onScroll={(ratio) => {
            editorScrollTopRef.current = ratio;
          }}
        />
      )}
    </div>
  );
}

export default function SharedFileDocumentView(props: FileDocumentViewProps) {
  return <div className="app-file-document-view h-full min-h-0 flex flex-col"><FileDocumentView {...props} /></div>;
}

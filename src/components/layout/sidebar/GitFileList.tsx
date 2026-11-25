import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button, Dropdown, Tooltip } from "antd";
import type { MenuProps } from "antd";
import {
  CheckOutlined,
  DownOutlined,
  MinusOutlined,
} from "@ant-design/icons";
import type { GitFileStatus, GitStatusType } from "@/types";
import { getFileIconByName } from "@/lib/fileIcon";
import { getVirtualRange } from "@/lib/virtualList";

const FILE_ROW_HEIGHT = 28;
const FILE_ROW_OVERSCAN = 8;
const INITIAL_RENDERED_ROWS = 40;

/** 文件状态徽章标签 */
const STATUS_LABEL: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  untracked: "U",
  renamed: "R",
  typechange: "T",
  conflicted: "C",
};

/** 分割 Git 路径为文件名和父路径 */
function splitGitPath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const fileName = parts.pop() ?? normalized;
  return {
    fileName,
    parentPath: parts.join("\\"),
  };
}

function renderDiffStat(value: number | null | undefined, prefix: "+" | "-") {
  if (typeof value !== "number" || value <= 0) {
    return null;
  }

  return `${prefix}${value}`;
}

interface GitFileListProps {
  /** 文件列表 */
  files: GitFileStatus[];
  /** 是否为已暂存文件 */
  staged: boolean;
  /** 分组标题 */
  sectionTitle: string;
  /** 操作按钮提示文本（暂存/取消暂存） */
  actionText: string;
  /** 是否折叠 */
  collapsed: boolean;
  /** 切换折叠状态 */
  onToggleCollapse: () => void;
  /** 当前正在打开差异的文件路径 */
  openingDiffPath: string | null;
  activeDiffKey: string | null;
  /** 查看差异回调 */
  onViewDiff: (
    filePath: string,
    staged: boolean,
    oldFilePath?: string | null,
    hunkActionsAvailable?: boolean,
    preview?: boolean,
    changeKind?: GitStatusType,
  ) => void;
  /** 暂存/取消暂存单个文件 */
  onToggleFile: (file: GitFileStatus) => void;
  /** 暂存/取消暂存所有文件 */
  onToggleAll: () => void;
  /** 丢弃更改回调（仅 unstaged） */
  onDiscard?: (filePath: string) => void;
  /** 构建右键菜单 */
  buildFileMenu: (file: GitFileStatus, staged: boolean) => MenuProps;
  /** 当前 Git 操作不允许常规暂存/取消暂存 */
  actionsDisabled?: boolean;
  /** 额外的操作按钮（如 discard all） */
  extraActions?: ReactNode;
}

/**
 * Git 文件列表组件
 *
 * 复用于显示已暂存和未暂存的文件列表。
 */
export function GitFileList({
  files,
  staged,
  sectionTitle,
  actionText,
  collapsed,
  onToggleCollapse,
  openingDiffPath,
  activeDiffKey,
  onViewDiff,
  onToggleFile,
  onToggleAll,
  buildFileMenu,
  actionsDisabled = false,
  extraActions,
}: GitFileListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [renderedRange, setRenderedRange] = useState({
    start: 0,
    end: Math.min(files.length, INITIAL_RENDERED_ROWS),
  });

  const updateRenderedRange = useCallback(() => {
    const list = listRef.current;
    const scrollContainer = list?.closest<HTMLElement>(".app-project-tree-scroll");
    if (!list || !scrollContainer) {
      setRenderedRange({ start: 0, end: Math.min(files.length, INITIAL_RENDERED_ROWS) });
      return;
    }

    const listRect = list.getBoundingClientRect();
    const scrollRect = scrollContainer.getBoundingClientRect();
    const nextRange = getVirtualRange(
      files.length,
      FILE_ROW_HEIGHT,
      Math.max(0, scrollRect.top - listRect.top),
      Math.max(0, scrollRect.bottom - listRect.top),
      FILE_ROW_OVERSCAN,
    );
    setRenderedRange((current) =>
      current.start === nextRange.start && current.end === nextRange.end ? current : nextRange,
    );
  }, [files.length]);

  useLayoutEffect(() => {
    updateRenderedRange();
  }, [collapsed, updateRenderedRange]);

  useEffect(() => {
    const list = listRef.current;
    const scrollContainer = list?.closest<HTMLElement>(".app-project-tree-scroll");
    if (!list || !scrollContainer || collapsed) return;

    scrollContainer.addEventListener("scroll", updateRenderedRange, { passive: true });
    const resizeObserver = new ResizeObserver(updateRenderedRange);
    resizeObserver.observe(scrollContainer);
    resizeObserver.observe(list);
    return () => {
      scrollContainer.removeEventListener("scroll", updateRenderedRange);
      resizeObserver.disconnect();
    };
  }, [collapsed, updateRenderedRange]);

  if (files.length === 0) {
    return null;
  }

  return (
    <div className="git-file-list mb-1">
      {/* 分组标题 */}
      <div className="git-file-section-header group">
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 text-left text-[12px] font-semibold text-[var(--cs-text-secondary)] hover:text-[var(--cs-text-primary)]"
          onClick={onToggleCollapse}
        >
          <DownOutlined className="app-disclosure-chevron text-[9px]" data-open={!collapsed} />
          <span className="truncate">{sectionTitle}</span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <div className="hidden items-center gap-0.5 group-hover:flex group-focus-within:flex">
            <Tooltip title={actionText} mouseEnterDelay={0.4}>
              <Button
                type="text"
                size="small"
                aria-label={actionText}
                icon={staged ? <MinusOutlined /> : <CheckOutlined />}
                disabled={actionsDisabled}
                className="h-5 w-5 min-w-5 p-0 text-[var(--cs-text-secondary)]"
                onClick={onToggleAll}
              />
            </Tooltip>
            {extraActions}
          </div>
          <span
            key={files.length}
            className="app-badge-pop inline-flex min-w-[18px] items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--cs-text-secondary)_10%,transparent)] px-1.5 font-mono text-[10px] font-medium leading-[16px] tabular-nums text-[var(--cs-text-secondary)]"
          >
            {files.length}
          </span>
        </div>
      </div>

      {/* 文件列表 */}
      {!collapsed && (
        <div
          ref={listRef}
          className="relative"
          style={{ height: files.length * FILE_ROW_HEIGHT }}
        >
          {files.slice(renderedRange.start, renderedRange.end).map((file, visibleIndex) => {
            const statusLabel = STATUS_LABEL[file.statusType] ?? "M";
            const { fileName, parentPath } = splitGitPath(file.path);
            const fileVisual = getFileIconByName(fileName);
            const addedText = renderDiffStat(file.insertions, "+");
            const removedText = renderDiffStat(file.deletions, "-");
            const fileKey = `${staged ? "staged" : "unstaged"}-${file.path}`;
            const selected = activeDiffKey === fileKey || openingDiffPath === file.path;
            const isDeletedUnstaged = !staged && file.statusType === "deleted";
            const hunkActionsAvailable =
              file.statusType !== "conflicted" &&
              file.statusType !== "deleted" &&
              file.statusType !== "typechange" &&
              file.statusType !== "untracked";

            return (
              <div
                key={fileKey}
                className="absolute inset-x-0"
                style={{ top: (renderedRange.start + visibleIndex) * FILE_ROW_HEIGHT }}
              >
                <Dropdown trigger={["contextMenu"]} menu={buildFileMenu(file, staged)}>
                  <div
                    className="git-file-row group"
                    data-selected={selected ? "true" : "false"}
                    onClick={() => {
                      onViewDiff(
                        file.path,
                        staged,
                        file.oldPath,
                        hunkActionsAvailable,
                        true,
                        file.statusType,
                      );
                    }}
                    onDoubleClick={() => {
                      onViewDiff(
                        file.path,
                        staged,
                        file.oldPath,
                        hunkActionsAvailable,
                        false,
                        file.statusType,
                      );
                    }}
                  >
                    {file.oldPath ? (
                      <span className="mr-1 text-[11px]" style={{ color: "var(--cs-text-tertiary)" }}>
                        {file.oldPath} →
                      </span>
                    ) : null}
                    {fileName}
                    {parentPath ? (
                      <span className="ml-1.5 text-[11px]" style={{ color: "var(--cs-text-tertiary)" }}>
                        {parentPath}
                      </span>
                    ) : null}
                  </span>
                  <div className="ml-auto flex items-center shrink-0 gap-1.5">
                    <span className="git-file-diff-stats">
                      {addedText ? <span className="git-file-diff-added">{addedText}</span> : null}
                      {removedText ? <span className="git-file-diff-removed">{removedText}</span> : null}
                    </span>
                    <div className="git-file-trailing">
                      <span
                        className="git-file-status-badge inline-flex w-5 justify-center text-[12px] font-semibold leading-[22px]"
                        style={{ color: badge.color }}
                      >
                        {badge.label}
                      </span>
                      <Tooltip title={actionText} mouseEnterDelay={0.4}>
                        <Button
                          type="text"
                          size="small"
                          aria-label={actionText}
                          icon={staged ? <MinusOutlined /> : <CheckOutlined />}
                          disabled={actionsDisabled}
                          style={{ width: 20, height: 20, padding: 0, color: "var(--cs-text-secondary)" }}
                          className="git-file-action-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (actionsDisabled) return;
                            onToggleFile(file);
                          }}
                        />
                      </Tooltip>
                    </div>
                  </div>
                </Dropdown>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

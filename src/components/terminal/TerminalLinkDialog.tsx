import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CopyOutlined,
  ExportOutlined,
  EyeOutlined,
  FolderOpenOutlined,
  InfoCircleOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Popover, Radio, Tooltip } from "antd";
import { useTranslation } from "react-i18next";
import type { TerminalLinkResolution } from "@/lib/api/terminalLinks";
import type { TerminalFileOpenMode } from "@/lib/terminalFileLinks";
import "./TerminalLinkDialog.css";

export interface TerminalLinkAnchor {
  x: number;
  y: number;
}

interface TerminalLinkDialogProps {
  open: boolean;
  kind: "file" | "external";
  value: string;
  line?: number;
  column?: number;
  anchor?: TerminalLinkAnchor;
  resolution?: TerminalLinkResolution;
  selectedPath?: string;
  opening: boolean;
  onSelectPath: (path: string) => void;
  onConfirm: (mode?: TerminalFileOpenMode) => void;
  onCopy?: () => void;
  onCancel: () => void;
}

const ANCHOR_VIEWPORT_PADDING = 12;
const FOCUSABLE_SELECTOR = [
  "button:not(:disabled)",
  "input:not(:disabled)",
  "[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function clampAnchorCoordinate(value: number, limit: number): number {
  if (!Number.isFinite(limit) || limit <= ANCHOR_VIEWPORT_PADDING * 2) return ANCHOR_VIEWPORT_PADDING;
  return Math.max(ANCHOR_VIEWPORT_PADDING, Math.min(value, limit - ANCHOR_VIEWPORT_PADDING));
}

function readViewportSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 1280, height: 800 };
  return { width: window.innerWidth, height: window.innerHeight };
}

function isRadioControl(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element instanceof HTMLInputElement && element.type === "radio") return true;
  return Boolean(element.closest("[role='radiogroup'], .ant-radio-group"));
}

function getDialogTabStops(panel: HTMLElement): HTMLElement[] {
  const candidates = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.closest("[hidden], [aria-hidden='true']")) return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  });
  const checkedRadioNames = new Set(
    candidates
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === "radio" && el.checked && Boolean(el.name))
      .map((el) => el.name),
  );
  return candidates.filter((el) => {
    if (el instanceof HTMLInputElement && el.type === "radio" && el.name && checkedRadioNames.has(el.name)) {
      return el.checked;
    }
    return true;
  });
}

/** 在点击坐标旁以命令面板式轻气泡呈现文件打开方式与位置选择，支持键盘上下选择与数字直达。 */
export function TerminalLinkDialog({
  open, kind, value, line, column, anchor, resolution, selectedPath, opening,
  onSelectPath, onConfirm, onCopy, onCancel,
}: TerminalLinkDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const locationsLabelId = useId();
  const actionListId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const actionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dialogFocused, setDialogFocused] = useState(false);
  const [viewportSize, setViewportSize] = useState(readViewportSize);

  const choosingTarget = kind === "file" && Boolean(resolution);
  const actionsDisabled = opening || (choosingTarget && !selectedPath);
  const filename = value.split(/[\\/]/).filter(Boolean).pop() || value;
  const fullTarget = selectedPath || value;
  const lineLabel = line ? (column ? `:${line}:${column}` : `:${line}`) : "";

  const actionItems = useMemo(() => {
    if (kind === "external") {
      return [
        {
          key: "default",
          title: t("terminal.openLinkConfirmOk"),
          subtitle: t("terminal.openLinkActionBrowserSub"),
          shortcut: "↵",
          icon: <ExportOutlined aria-hidden="true" />,
          run: () => onConfirm("default"),
        },
        {
          key: "copy",
          title: t("terminal.openLinkCopyUrl"),
          subtitle: value,
          shortcut: "2",
          icon: <CopyOutlined aria-hidden="true" />,
          run: () => onCopy?.(),
        },
      ];
    }

    return [
      {
        key: "default" as const,
        title: t("terminal.fileLinkActionDefaultTitle"),
        subtitle: line
          ? t("terminal.fileLinkActionDefaultLineSub", { line })
          : t("terminal.fileLinkActionDefaultSub"),
        shortcut: "↵",
        icon: <ThunderboltOutlined aria-hidden="true" />,
        run: () => onConfirm("default"),
      },
      {
        key: "system" as const,
        title: t("terminal.fileLinkActionSystemTitle"),
        subtitle: t("terminal.fileLinkActionSystemSub"),
        shortcut: "2",
        icon: <ExportOutlined aria-hidden="true" />,
        run: () => onConfirm("system"),
      },
      {
        key: "explorer" as const,
        title: t("terminal.fileLinkActionExplorerTitle"),
        subtitle: t("terminal.fileLinkActionExplorerSub"),
        shortcut: "3",
        icon: <FolderOpenOutlined aria-hidden="true" />,
        run: () => onConfirm("explorer"),
      },
      {
        key: "preview" as const,
        title: t("terminal.fileLinkActionPreviewTitle"),
        subtitle: t("terminal.fileLinkActionPreviewSub"),
        shortcut: "4",
        icon: <EyeOutlined aria-hidden="true" />,
        run: () => onConfirm("preview"),
      },
    ];
  }, [kind, line, onConfirm, onCopy, t, value]);

  useEffect(() => {
    if (open) setActiveIndex(0);
  }, [open, value, choosingTarget]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    setViewportSize(readViewportSize());
    const handleResize = () => setViewportSize(readViewportSize());
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [open]);

  const executeItem = useCallback((index: number) => {
    if (actionsDisabled) return;
    actionItems[index]?.run();
  }, [actionItems, actionsDisabled]);

  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const executeItemRef = useRef(executeItem);
  executeItemRef.current = executeItem;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const actionsDisabledRef = useRef(actionsDisabled);
  actionsDisabledRef.current = actionsDisabled;

  const anchorX = clampAnchorCoordinate(anchor?.x ?? viewportSize.width / 2, viewportSize.width);
  const anchorY = clampAnchorCoordinate(anchor?.y ?? viewportSize.height / 2, viewportSize.height);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (opening) return;
      const target = event.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      onCancelRef.current();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (opening) return;
      const panel = panelRef.current;
      const activeEl = document.activeElement;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancelRef.current();
        return;
      }

      if (event.key === "Tab" && panel) {
        const focusables = getDialogTabStops(panel);
        if (focusables.length > 0) {
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          const insidePanel = activeEl instanceof Node && panel.contains(activeEl);
          if (!insidePanel || activeEl === panel) {
            event.preventDefault();
            event.stopPropagation();
            (event.shiftKey ? last : first).focus({ preventScroll: true });
            return;
          }
          if (event.shiftKey && activeEl === first) {
            event.preventDefault();
            event.stopPropagation();
            last.focus({ preventScroll: true });
            return;
          }
          if (!event.shiftKey && activeEl === last) {
            event.preventDefault();
            event.stopPropagation();
            first.focus({ preventScroll: true });
            return;
          }
        }
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (isRadioControl(activeEl)) return;
        event.preventDefault();
        event.stopPropagation();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = (activeIndexRef.current + delta + actionItems.length) % actionItems.length;
        setActiveIndex(nextIndex);
        if (activeEl instanceof HTMLElement && actionRefs.current.includes(activeEl as HTMLButtonElement)) {
          actionRefs.current[nextIndex]?.focus({ preventScroll: true });
        }
        return;
      }

      if (event.key === "Enter") {
        if (isRadioControl(activeEl)) return;
        if (activeEl instanceof HTMLButtonElement && panel?.contains(activeEl)) {
          // 焦点位于复制、关闭或具体菜单项按钮时，交由按钮自身的原生 Enter 激活处理。
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        executeItemRef.current(activeIndexRef.current);
        return;
      }

      if (!event.ctrlKey && !event.metaKey && !event.altKey && /^[1-9]$/.test(event.key)) {
        const index = Number(event.key) - 1;
        if (index < actionItems.length) {
          event.preventDefault();
          event.stopPropagation();
          if (!actionsDisabledRef.current) {
            setActiveIndex(index);
            executeItemRef.current(index);
          }
        }
      }
    };

    // 捕获阶段监听点击外部与快捷键，避免被 xterm 画布或内部交互吞掉。
    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [actionItems.length, open, opening]);

  const titleText = choosingTarget
    ? t("terminal.fileLinkChooseTitle")
    : kind === "file" ? filename : t("terminal.openLinkConfirmTitle");
  const showHeaderPath = !choosingTarget && Boolean(fullTarget) && fullTarget !== titleText;
  const describedById = choosingTarget ? locationsLabelId : descriptionId;
  const activeItemId = actionItems[activeIndex] ? `${actionListId}-${actionItems[activeIndex].key}` : undefined;

  const content = (
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={describedById}
      aria-activedescendant={dialogFocused ? activeItemId : undefined}
      tabIndex={-1}
      className="app-terminal-link-dialog"
      onFocus={(event) => setDialogFocused(event.target === panelRef.current)}
      onBlur={(event) => {
        if (!panelRef.current?.contains(event.relatedTarget)) {
          setDialogFocused(false);
        }
      }}
    >
      <div className="app-terminal-link-dialog__header">
        <div className="app-terminal-link-dialog__identity">
          <div className="app-terminal-link-dialog__title-row">
            <h2 id={titleId} className="app-terminal-link-dialog__filename">
              {titleText}
            </h2>
            {kind === "file" && lineLabel ? (
              <span className="app-terminal-link-dialog__line-badge">{lineLabel}</span>
            ) : null}
          </div>
          <span
            id={descriptionId}
            className={showHeaderPath ? "app-terminal-link-dialog__header-path" : "app-terminal-link-dialog__sr-only"}
          >
            {fullTarget}
          </span>
        </div>
        {kind === "file" && onCopy ? (
          <Tooltip title={t("terminal.fileLinkCopyPath")}>
            <button
              type="button"
              className="app-terminal-link-dialog__copy-btn"
              aria-label={t("terminal.fileLinkCopyPath")}
              disabled={opening}
              onClick={onCopy}
            >
              <CopyOutlined aria-hidden="true" />
            </button>
          </Tooltip>
        ) : null}
      </div>

      {choosingTarget && resolution ? (
        <div className="app-terminal-link-dialog__locations">
          <p className="app-terminal-link-dialog__summary" id={locationsLabelId}>
            {t(resolution.targets.length ? "terminal.fileLinkMatches" : "terminal.fileLinkNoMatches", { count: resolution.targets.length })}
          </p>
          <Radio.Group
            name={locationsLabelId}
            aria-labelledby={locationsLabelId}
            disabled={opening}
            value={selectedPath}
            onChange={(event) => onSelectPath(String(event.target.value))}
            className="app-terminal-link-dialog__options"
          >
            {resolution.targets.map((target) => {
              const relativePath = target.projectRelativePath ?? target.path;
              const directory = target.kind === "directory" ? relativePath
                : relativePath.replace(/[\\/][^\\/]+$/, "");
              const label = directory === relativePath && target.kind === "file"
                ? t("terminal.fileLinkProjectRoot") : directory || t("terminal.fileLinkProjectRoot");
              return (
                <Radio key={target.path} value={target.path} className="app-terminal-link-dialog__option">
                  <span className="app-terminal-link-dialog__location">
                    <FolderOpenOutlined aria-hidden="true" />
                    <span className="app-terminal-link-dialog__location-text">
                      <span className="app-terminal-link-dialog__directory">{label}</span>
                      <span className="app-terminal-link-dialog__path">{target.path}</span>
                    </span>
                  </span>
                </Radio>
              );
            })}
          </Radio.Group>
          {resolution.truncated ? (
            <p className="app-terminal-link-dialog__notice" role="status">
              <InfoCircleOutlined aria-hidden="true" />
              <span>{t("terminal.fileLinkSearchIncomplete")}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="app-terminal-link-dialog__actions" role="menu" aria-labelledby={titleId}>
        {actionItems.map((item, index) => {
          const isActive = index === activeIndex;
          return (
            <button
              key={item.key}
              ref={(el) => { actionRefs.current[index] = el; }}
              id={`${actionListId}-${item.key}`}
              type="button"
              role="menuitem"
              disabled={actionsDisabled}
              className={`app-terminal-link-dialog__action-item${isActive ? " is-active" : ""}`}
              onMouseEnter={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onClick={() => executeItem(index)}
            >
              <span className="app-terminal-link-dialog__action-icon">{item.icon}</span>
              <span className="app-terminal-link-dialog__action-body">
                <span className="app-terminal-link-dialog__action-title">{item.title}</span>
                <span className="app-terminal-link-dialog__action-sub">{item.subtitle}</span>
              </span>
              <span className="app-terminal-link-dialog__kbd" aria-hidden="true">
                {item.shortcut}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <Popover
      open={open}
      trigger={[]}
      placement="bottomLeft"
      arrow={false}
      destroyOnHidden
      classNames={{
        root: choosingTarget
          ? "app-terminal-link-popover app-terminal-link-popover--choosing"
          : "app-terminal-link-popover",
      }}
      content={content}
      afterOpenChange={(visible) => {
        if (visible && !panelRef.current?.contains(document.activeElement)) {
          panelRef.current?.focus({ preventScroll: true });
        }
      }}
    >
      <span
        aria-hidden="true"
        className="app-terminal-link-anchor"
        style={{ left: anchorX, top: anchorY }}
      />
    </Popover>
  );
}

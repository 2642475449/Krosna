import { useEffect, useId, useRef } from "react";
import { FileOutlined, FolderOpenOutlined, InfoCircleOutlined, LinkOutlined } from "@ant-design/icons";
import { Button, Popover, Radio } from "antd";
import { useTranslation } from "react-i18next";
import type { TerminalLinkResolution } from "@/lib/api/terminalLinks";
import "./TerminalLinkDialog.css";

export interface TerminalLinkAnchor {
  x: number;
  y: number;
}

interface TerminalLinkDialogProps {
  open: boolean;
  kind: "file" | "external";
  value: string;
  anchor?: TerminalLinkAnchor;
  resolution?: TerminalLinkResolution;
  selectedPath?: string;
  opening: boolean;
  onSelectPath: (path: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const ANCHOR_VIEWPORT_PADDING = 12;

function clampAnchorCoordinate(value: number, limit: number): number {
  if (!Number.isFinite(limit) || limit <= ANCHOR_VIEWPORT_PADDING * 2) return ANCHOR_VIEWPORT_PADDING;
  return Math.max(ANCHOR_VIEWPORT_PADDING, Math.min(value, limit - ANCHOR_VIEWPORT_PADDING));
}

/** 在点击坐标旁以轻气泡呈现链接确认与位置选择，点击空白处即可关闭；状态与打开逻辑由终端统一管理。 */
export function TerminalLinkDialog({
  open, kind, value, anchor, resolution, selectedPath, opening,
  onSelectPath, onConfirm, onCancel,
}: TerminalLinkDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const locationsLabelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const choosingTarget = kind === "file" && Boolean(resolution);
  const filename = value.split(/[\\/]/).filter(Boolean).pop() || value;

  const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  const anchorX = clampAnchorCoordinate(anchor?.x ?? viewportWidth / 2, viewportWidth);
  const anchorY = clampAnchorCoordinate(anchor?.y ?? viewportHeight / 2, viewportHeight);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (opening) return;
      const target = event.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      onCancel();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (opening || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };

    // 捕获阶段监听点击外部，避免被 xterm 画布或内部交互吞掉导致气泡无法关闭。
    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onCancel, open, opening]);

  const titleKey = choosingTarget
    ? "terminal.fileLinkChooseTitle"
    : kind === "file" ? "terminal.fileLinkOpenTitle" : "terminal.openLinkConfirmTitle";
  const describedById = choosingTarget ? locationsLabelId : descriptionId;

  const content = (
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={describedById}
      tabIndex={-1}
      className="app-terminal-link-dialog"
    >
      <div className="app-terminal-link-dialog__header">
        <h2 id={titleId} className="app-terminal-link-dialog__title">
          {t(titleKey)}
        </h2>
      </div>
      <div className="app-terminal-link-dialog__body">
        <div className="app-terminal-link-dialog__reference">
          {kind === "file" ? <FileOutlined aria-hidden="true" /> : <LinkOutlined aria-hidden="true" />}
          <div className="app-terminal-link-dialog__reference-text">
            <p className="app-terminal-link-dialog__filename">{kind === "file" ? filename : value}</p>
            {!choosingTarget && kind === "file" && value !== filename ? (
              <p className="app-terminal-link-dialog__path">{value}</p>
            ) : null}
          </div>
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
                // 同名文件的区别在目录：优先展示相对目录，完整路径保留在次行。
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
        ) : (
          <p id={descriptionId} className="app-terminal-link-dialog__description">
            {t(kind === "file" ? "terminal.fileLinkOpenDescription" : "terminal.openLinkConfirmContent")}
          </p>
        )}
      </div>
      <div className="app-terminal-link-dialog__footer">
        <Button disabled={opening} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          type="primary"
          loading={opening}
          disabled={choosingTarget && !selectedPath}
          onClick={onConfirm}
        >
          {t("terminal.openLinkConfirmOk")}
        </Button>
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

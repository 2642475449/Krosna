import {
  ColumnWidthOutlined,
  FolderOpenOutlined,
  FullscreenOutlined,
  LeftOutlined,
  RightOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from "@ant-design/icons";
import { Button, InputNumber, Tooltip } from "antd";
import { useTranslation } from "react-i18next";
import type { PdfViewerToolbarState } from "@/store/slices/pdfViewerToolbar";

interface PdfToolbarControlsProps extends PdfViewerToolbarState {
  compact?: boolean;
}

export function PdfToolbarControls({
  pageNumber,
  pageCount,
  zoomPercent,
  zoomMode,
  canZoomOut,
  canZoomIn,
  onPrevPage,
  onNextPage,
  onJumpToPage,
  onZoomOut,
  onZoomIn,
  onFitWidth,
  onFitPage,
  onOpenExternal,
  compact = false,
}: PdfToolbarControlsProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-1">
      <Tooltip title={t("fileTabs.pdfPreviousPage")} mouseEnterDelay={0.4}>
        <Button
          size="small"
          type="text"
          icon={<LeftOutlined />}
          aria-label={t("fileTabs.pdfPreviousPage")}
          disabled={pageNumber <= 1}
          onClick={onPrevPage}
        />
      </Tooltip>
      <InputNumber
        size="small"
        className={compact ? "w-11" : "w-14"}
        min={1}
        max={pageCount}
        controls={false}
        value={pageNumber}
        aria-label={t("fileTabs.pdfCurrentPage")}
        onChange={(value) => {
          if (typeof value === "number") {
            onJumpToPage(value);
          }
        }}
      />
      <span className="whitespace-nowrap font-mono text-xs tabular-nums text-[var(--cs-text-secondary)]">
        / {pageCount}
      </span>
      <Tooltip title={t("fileTabs.pdfNextPage")} mouseEnterDelay={0.4}>
        <Button
          size="small"
          type="text"
          icon={<RightOutlined />}
          aria-label={t("fileTabs.pdfNextPage")}
          disabled={pageNumber >= pageCount}
          onClick={onNextPage}
        />
      </Tooltip>
      <span className="mx-1 h-4 w-px bg-[var(--cs-border-sidebar)]" aria-hidden="true" />
      <Tooltip title={t("fileTabs.pdfZoomOut")} mouseEnterDelay={0.4}>
        <Button
          size="small"
          type="text"
          icon={<ZoomOutOutlined />}
          aria-label={t("fileTabs.pdfZoomOut")}
          disabled={!canZoomOut}
          onClick={onZoomOut}
        />
      </Tooltip>
      <span className="min-w-11 text-center font-mono text-xs tabular-nums text-[var(--cs-text-secondary)]">
        {zoomPercent}%
      </span>
      <Tooltip title={t("fileTabs.pdfZoomIn")} mouseEnterDelay={0.4}>
        <Button
          size="small"
          type="text"
          icon={<ZoomInOutlined />}
          aria-label={t("fileTabs.pdfZoomIn")}
          disabled={!canZoomIn}
          onClick={onZoomIn}
        />
      </Tooltip>
      <Tooltip title={t("fileTabs.pdfFitWidth")} mouseEnterDelay={0.4}>
        <Button
          size="small"
          type={zoomMode === "width" ? "default" : "text"}
          icon={<ColumnWidthOutlined />}
          aria-label={t("fileTabs.pdfFitWidth")}
          onClick={onFitWidth}
        />
      </Tooltip>
      <Tooltip title={t("fileTabs.pdfFitPage")} mouseEnterDelay={0.4}>
        <Button
          size="small"
          type={zoomMode === "page" ? "default" : "text"}
          icon={<FullscreenOutlined />}
          aria-label={t("fileTabs.pdfFitPage")}
          onClick={onFitPage}
        />
      </Tooltip>
      <Tooltip title={t("common.openInAssociatedApp")} mouseEnterDelay={0.4}>
        <Button
          size="small"
          type="text"
          icon={<FolderOpenOutlined />}
          aria-label={t("common.openInAssociatedApp")}
          onClick={onOpenExternal}
        />
      </Tooltip>
    </div>
  );
}

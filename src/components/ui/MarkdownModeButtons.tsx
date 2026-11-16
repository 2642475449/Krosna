import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";

export type MarkdownViewMode = "edit" | "preview";

interface MarkdownModeButtonsProps {
  mode: MarkdownViewMode;
  onChange: (mode: MarkdownViewMode) => void;
}

/** 紧凑的 Markdown 编辑/预览切换图标按钮，供主标签栏与辅助栏复用。 */
export function MarkdownModeButtons({ mode, onChange }: MarkdownModeButtonsProps) {
  const { t } = useTranslation();

  return (
    <div
      className="flex items-center gap-0.5"
      role="group"
      aria-label={t("fileTabs.markdownModePreview")}
    >
      <Tooltip title={t("fileTabs.markdownModeEdit")} mouseEnterDelay={0.4}>
        <button
          type="button"
          className="app-tabbar-mode-button"
          data-active={mode === "edit" ? "true" : "false"}
          aria-pressed={mode === "edit"}
          aria-label={t("fileTabs.markdownModeEdit")}
          onClick={() => onChange("edit")}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" focusable="false">
            <path d="M2.5 4h11M2.5 8h7.5M2.5 12h11" />
          </svg>
        </button>
      </Tooltip>
      <Tooltip title={t("fileTabs.markdownModePreview")} mouseEnterDelay={0.4}>
        <button
          type="button"
          className="app-tabbar-mode-button"
          data-active={mode === "preview" ? "true" : "false"}
          aria-pressed={mode === "preview"}
          aria-label={t("fileTabs.markdownModePreview")}
          onClick={() => onChange("preview")}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" focusable="false">
            <rect x="2" y="2.5" width="12" height="11" rx="1.6" />
            <circle cx="5.4" cy="5.8" r="1" fill="currentColor" stroke="none" />
            <path d="M3.2 11.4l3-3.1 2.2 2.1 1.7-1.8 2.7 2.8" />
          </svg>
        </button>
      </Tooltip>
    </div>
  );
}

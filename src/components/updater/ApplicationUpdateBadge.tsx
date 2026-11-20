import { CloudDownloadOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";
import { useApplicationUpdateStore } from "@/store/slices/applicationUpdate";

export function ApplicationUpdateBadge() {
  const { t } = useTranslation();
  const phase = useApplicationUpdateStore((state) => state.phase);
  const percent = useApplicationUpdateStore((state) => state.percent);
  const openModal = useApplicationUpdateStore((state) => state.openModal);

  if (phase === "idle" || phase === "checking" || phase === "installing") return null;

  const label = phase === "downloading"
    ? percent === null
      ? t("updater.badgeDownloading")
      : t("updater.badgeDownloadingPercent", { percent })
    : phase === "ready"
      ? t("updater.badgeReady")
      : phase === "error"
        ? t("updater.badgeError")
        : t("updater.badgeAvailable");

  const statusDotClass = phase === "error"
    ? "bg-[var(--cs-danger)]"
    : phase === "ready"
      ? "bg-[var(--cs-success)]"
      : "bg-[var(--cs-primary)]";

  return (
    <Tooltip title={t("updater.openDetails")}>
      <button
        type="button"
        className="mx-1 flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[var(--cs-border-card)] bg-[var(--cs-bg-card-solid)] px-2.5 text-xs text-[var(--cs-text-secondary)] transition-colors hover:border-[var(--cs-border)] hover:bg-[var(--cs-bg-hover)] hover:text-[var(--cs-text-primary)]"
        onClick={openModal}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass}`} aria-hidden="true" />
        <CloudDownloadOutlined />
        <span>{label}</span>
      </button>
    </Tooltip>
  );
}

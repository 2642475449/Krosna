import {
  CheckCircleFilled,
  CloudDownloadOutlined,
  ExclamationCircleOutlined,
  ExportOutlined,
  GithubOutlined,
  GlobalOutlined,
  LoadingOutlined,
  RightOutlined,
  SyncOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { Button, Modal, Progress, message } from "antd";
import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { CopyFeedbackIcon } from "@/components/ui/CopyFeedbackIcon";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import {
  checkForApplicationUpdate,
  installPendingApplicationUpdate,
  KROSNA_RELEASES_URL,
} from "@/lib/applicationUpdater";
import { openExternalUrl } from "@/lib/api";
import { isSessionTurnRunning } from "@/lib/sessions";
import { openSettingsPage } from "@/lib/settingsNavigation";
import { formatUpdateBytes } from "@/lib/updateProgress";
import {
  parseReleaseNotes,
  type ReleaseNoteInline,
} from "@/lib/updateReleaseNotes";
import { useAppStore } from "@/store";
import { useApplicationUpdateStore } from "@/store/slices/applicationUpdate";
import "./ApplicationUpdateModal.css";

interface InstallWarningCounts {
  runningTurns: number;
  dirtyTabs: number;
}

function renderReleaseNoteInlines(inlines: ReleaseNoteInline[], keyPrefix: string) {
  return inlines.map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    if (token.kind === "code") return <code key={key}>{token.text}</code>;
    if (token.kind === "strong") return <strong key={key}>{token.text}</strong>;
    if (token.kind === "link") {
      return (
        <button
          key={key}
          type="button"
          className="app-update-modal__note-link"
          onClick={() => void openExternalUrl(token.url)}
        >
          {token.label}
        </button>
      );
    }
    return token.text;
  });
}

export function ApplicationUpdateModal() {
  const { t } = useTranslation();
  const modalOpen = useApplicationUpdateStore((state) => state.modalOpen);
  const update = useApplicationUpdateStore();
  const [confirmCounts, setConfirmCounts] = useState<InstallWarningCounts | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { isCopied, markCopied } = useCopyFeedback();
  const errorDetailsId = useId();

  useEffect(() => {
    if (!modalOpen || !update.error) {
      setDetailsOpen(false);
    }
  }, [modalOpen, update.error]);

  const parsedReleaseNotes = useMemo(
    () => (update.releaseNotes ? parseReleaseNotes(update.releaseNotes) : []),
    [update.releaseNotes],
  );

  // 弹窗关闭时不渲染也不随进度事件重渲染。
  if (!modalOpen) return null;

  const isPreparing = update.phase === "checking" || update.phase === "available";
  const isDownloadingOrReady =
    update.phase === "downloading" ||
    update.phase === "ready" ||
    update.phase === "installing";
  const canInstall = update.phase === "ready";
  const canRetry = update.phase === "error";
  const { availableVersion } = update;
  const isConnectivityError =
    update.errorStage === "check" || update.errorStage === "download";
  const errorCopied = isCopied("updater-error");

  const requestInstall = () => {
    // 仅在点击安装时按需读取会话/标签状态，避免常驻订阅导致高频重渲染。
    const appState = useAppStore.getState();
    const runningTurns = appState.sessions.filter(isSessionTurnRunning).length;
    const dirtyTabs = Object.values(appState.tabsById).filter((tab) => tab.dirty).length;
    if (runningTurns > 0 || dirtyTabs > 0) {
      setConfirmCounts({ runningTurns, dirtyTabs });
      return;
    }
    void installPendingApplicationUpdate();
  };

  const handlePrimaryAction = () => {
    if (canInstall) {
      requestInstall();
      return;
    }
    if (!canRetry) return;
    if (update.errorStage === "install") requestInstall();
    else void checkForApplicationUpdate({ manual: true });
  };

  const handleCopyError = async () => {
    if (!update.error) return;
    try {
      await navigator.clipboard.writeText(update.error);
      markCopied("updater-error");
      message.success(t("common.copied"));
    } catch {
      message.error(t("settings.about.copyFailed"));
    }
  };

  const handleOpenNetworkSettings = () => {
    update.closeModal();
    openSettingsPage("network");
  };

  const primaryText = update.phase === "installing"
    ? t("updater.installing")
    : canRetry
      ? t("updater.retry")
      : t("updater.restartAndInstall");

  const showPrimaryAction = canInstall || canRetry || update.phase === "installing";

  const errorTitle = update.errorStage === "check"
    ? t("updater.checkFailed")
    : update.errorStage === "download"
      ? t("updater.downloadFailed")
      : t("updater.installFailed");

  const errorDescription = isConnectivityError
    ? t("updater.recoveryHint")
    : t("updater.installErrorHint");

  return (
    <>
      <Modal
        centered
        width={480}
        className="app-update-modal"
        open={update.modalOpen}
        closable={update.phase !== "installing"}
        mask={{ closable: update.phase !== "installing" }}
        keyboard={update.phase !== "installing"}
        onCancel={update.closeModal}
        title={(
          <div className="app-update-modal__header">
            <img
              src="/logo.png"
              alt=""
              aria-hidden="true"
              className="app-update-modal__logo"
              draggable={false}
            />
            <div className="app-update-modal__header-text">
              <div className="app-update-modal__title-row">
                <span className="app-update-modal__title">
                  {update.availableVersion
                    ? t("updater.updateAvailableTitle")
                    : t("updater.title")}
                </span>
                {update.availableVersion ? (
                  <span className="app-update-modal__version-pill">
                    v{update.availableVersion}
                  </span>
                ) : null}
              </div>
              {update.currentVersion ? (
                <div className="app-update-modal__subtitle">
                  {update.availableVersion
                    ? t("updater.versionTransition", {
                        currentVersion: update.currentVersion,
                        version: update.availableVersion,
                      })
                    : t("updater.currentVersionLabel", {
                        currentVersion: update.currentVersion,
                      })}
                </div>
              ) : null}
            </div>
          </div>
        )}
        footer={(
          <div className="flex items-center justify-end gap-2">
            {update.phase !== "installing" ? (
              <Button onClick={update.closeModal}>
                {t("updater.close")}
              </Button>
            ) : null}
            {showPrimaryAction ? (
              <Button
                type="primary"
                loading={update.phase === "installing"}
                autoFocus={canInstall || canRetry}
                onClick={handlePrimaryAction}
              >
                {primaryText}
              </Button>
            ) : null}
          </div>
        )}
      >
        <div className="app-update-modal__body">
          {isPreparing ? (
            <div className="app-update-modal__surface" role="status" aria-live="polite">
              <div className="app-update-modal__status-row">
                <span
                  className="app-update-modal__status-badge app-update-modal__status-badge--info"
                  aria-hidden="true"
                >
                  <SyncOutlined spin />
                </span>
                <div className="app-update-modal__status-content">
                  <h3 className="app-update-modal__status-title">
                    {update.phase === "checking"
                      ? t("updater.checkingTitle")
                      : t("updater.preparingDownload")}
                  </h3>
                  <p className="app-update-modal__status-desc">
                    {update.phase === "checking"
                      ? t("updater.checkingHint")
                      : t("updater.preparingDownloadHint")}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {isDownloadingOrReady ? (
            <div className="app-update-modal__surface" role="status" aria-live="polite">
              <div className="app-update-modal__status-row">
                <span
                  className={`app-update-modal__status-badge ${
                    update.phase === "ready"
                      ? "app-update-modal__status-badge--success"
                      : "app-update-modal__status-badge--info"
                  }`}
                  aria-hidden="true"
                >
                  {update.phase === "ready" ? (
                    <CheckCircleFilled />
                  ) : update.phase === "installing" ? (
                    <LoadingOutlined spin />
                  ) : (
                    <CloudDownloadOutlined />
                  )}
                </span>
                <div className="app-update-modal__status-content">
                  <div className="app-update-modal__status-head">
                    <h3 className="app-update-modal__status-title">
                      {update.phase === "downloading"
                        ? t("updater.downloadPhase")
                        : update.phase === "ready"
                          ? t("updater.readyPhase")
                          : t("updater.installPhase")}
                    </h3>
                    {update.percent !== null ? (
                      <span className="app-update-modal__percent">{update.percent}%</span>
                    ) : null}
                  </div>
                  <div className="app-update-modal__progress">
                    <Progress
                      size={{ height: 6 }}
                      percent={update.percent ?? 0}
                      status={update.phase === "ready" ? "success" : "active"}
                      showInfo={false}
                      strokeColor={update.phase === "ready" ? "var(--cs-success)" : "var(--cs-primary)"}
                    />
                  </div>
                  <div className="app-update-modal__meta">
                    {update.totalBytes === null
                      ? t("updater.downloadedSize", {
                          downloaded: formatUpdateBytes(update.downloadedBytes, i18n.language),
                        })
                      : t("updater.downloadedSizeOfTotal", {
                          downloaded: formatUpdateBytes(update.downloadedBytes, i18n.language),
                          total: formatUpdateBytes(update.totalBytes, i18n.language),
                        })}
                  </div>
                  <p className="app-update-modal__hint">
                    {update.phase === "downloading"
                      ? t("updater.backgroundDownloadHint")
                      : update.phase === "ready"
                        ? t("updater.readyHint")
                        : t("updater.installingHint")}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {update.error ? (
            <div className="app-update-modal__surface" role="alert">
              <div className="app-update-modal__status-row">
                <span
                  className="app-update-modal__status-badge app-update-modal__status-badge--danger"
                  aria-hidden="true"
                >
                  <ExclamationCircleOutlined />
                </span>
                <div className="app-update-modal__status-content">
                  <h3 className="app-update-modal__status-title">{errorTitle}</h3>
                  <p className="app-update-modal__status-desc">{errorDescription}</p>
                </div>
              </div>

              <div className="app-update-modal__disclosure" data-open={detailsOpen ? "true" : "false"}>
                <div className="app-update-modal__disclosure-bar">
                  <button
                    type="button"
                    className="app-update-modal__disclosure-toggle"
                    aria-expanded={detailsOpen}
                    aria-controls={errorDetailsId}
                    onClick={() => setDetailsOpen((open) => !open)}
                  >
                    <RightOutlined className="app-update-modal__disclosure-chevron" aria-hidden="true" />
                    <span>
                      {detailsOpen ? t("updater.hideErrorDetails") : t("updater.showErrorDetails")}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="app-update-modal__copy-btn"
                    onClick={() => void handleCopyError()}
                  >
                    <CopyFeedbackIcon copied={errorCopied} />
                    <span>{errorCopied ? t("common.copied") : t("updater.copyErrorDetails")}</span>
                  </button>
                </div>
                {detailsOpen ? (
                  <pre id={errorDetailsId} className="app-update-modal__error-code">
                    {update.error}
                  </pre>
                ) : null}
              </div>
            </div>
          ) : null}

          {isConnectivityError ? (
            <div className="app-update-modal__actions">
              <button
                type="button"
                className="app-update-modal__action-row"
                onClick={handleOpenNetworkSettings}
              >
                <span className="app-update-modal__action-icon" aria-hidden="true">
                  <GlobalOutlined />
                </span>
                <span className="app-update-modal__action-text">
                  <span className="block app-update-modal__action-title">
                    {t("updater.openNetworkSettings")}
                  </span>
                  <span className="block app-update-modal__action-desc">
                    {t("updater.openNetworkSettingsDesc")}
                  </span>
                </span>
                <RightOutlined className="app-update-modal__action-arrow" aria-hidden="true" />
              </button>
              {update.errorStage === "download" && availableVersion ? (
                <button
                  type="button"
                  className="app-update-modal__action-row"
                  onClick={() => void openExternalUrl(
                    `https://termflow.jianglan.online/releases/Termflow_${encodeURIComponent(availableVersion)}_x64-setup.exe`,
                  )}
                >
                  <span className="app-update-modal__action-icon" aria-hidden="true"><CloudDownloadOutlined /></span>
                  <span className="app-update-modal__action-text">
                    <span className="block app-update-modal__action-title">
                      {t("updater.downloadFromMirror")}
                    </span>
                    <span className="block app-update-modal__action-desc">
                      {t("updater.downloadFromMirrorDesc")}
                    </span>
                  </span>
                  <ExportOutlined className="app-update-modal__action-arrow" aria-hidden="true" />
                </button>
              ) : null}
              <button
                type="button"
                className="app-update-modal__action-row"
                onClick={() => void openExternalUrl(KROSNA_RELEASES_URL)}
              >
                <span className="app-update-modal__action-icon" aria-hidden="true">
                  <GithubOutlined />
                </span>
                <span className="app-update-modal__action-text">
                  <span className="block app-update-modal__action-title">
                    {t("updater.manualDownload")}
                  </span>
                  <span className="block app-update-modal__action-desc">
                    {t("updater.manualDownloadDesc")}
                  </span>
                </span>
                <ExportOutlined className="app-update-modal__action-arrow" aria-hidden="true" />
              </button>
            </div>
          ) : null}

          {update.availableVersion ? (
            <div className="app-update-modal__notes-wrap">
              <div className="app-update-modal__notes-label">{t("updater.releaseNotes")}</div>
              <div className="app-update-modal__notes">
                {parsedReleaseNotes.length > 0 ? (
                  parsedReleaseNotes.map((block, index) => {
                    if (block.kind === "heading") {
                      const HeadingTag = block.level === 1 ? "h1" : block.level === 2 ? "h2" : "h3";
                      return (
                        <HeadingTag key={`block-${index}`}>
                          {renderReleaseNoteInlines(block.inlines, `h-${index}`)}
                        </HeadingTag>
                      );
                    }
                    if (block.kind === "list") {
                      return (
                        <ul key={`block-${index}`}>
                          {block.items.map((item, itemIndex) => (
                            <li key={`item-${index}-${itemIndex}`}>
                              {renderReleaseNoteInlines(item, `li-${index}-${itemIndex}`)}
                            </li>
                          ))}
                        </ul>
                      );
                    }
                    return (
                      <p key={`block-${index}`}>
                        {renderReleaseNoteInlines(block.inlines, `p-${index}`)}
                      </p>
                    );
                  })
                ) : (
                  <p>{t("updater.noReleaseNotes")}</p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        centered
        width={440}
        className="app-update-modal"
        open={confirmCounts !== null}
        title={t("updater.confirmInstallTitle")}
        onCancel={() => setConfirmCounts(null)}
        footer={(
          <div className="flex items-center justify-end gap-2">
            <Button onClick={() => setConfirmCounts(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="primary"
              onClick={() => {
                setConfirmCounts(null);
                void installPendingApplicationUpdate();
              }}
            >
              {t("updater.installAnyway")}
            </Button>
          </div>
        )}
      >
        <div>
          <p className="m-0 text-sm leading-6 text-[var(--cs-text-secondary)]">
            {t("updater.confirmInstallDescription")}
          </p>
          {confirmCounts && (confirmCounts.runningTurns > 0 || confirmCounts.dirtyTabs > 0) ? (
            <div className="app-update-modal__warning-list">
              {confirmCounts.runningTurns > 0 ? (
                <div className="app-update-modal__warning-row" role="status">
                  <span className="app-update-modal__warning-icon" aria-hidden="true">
                    <WarningOutlined />
                  </span>
                  <span>
                    {t("updater.runningTurnsWarning", { count: confirmCounts.runningTurns })}
                  </span>
                </div>
              ) : null}
              {confirmCounts.dirtyTabs > 0 ? (
                <div className="app-update-modal__warning-row" role="status">
                  <span className="app-update-modal__warning-icon" aria-hidden="true">
                    <WarningOutlined />
                  </span>
                  <span>
                    {t("updater.dirtyTabsWarning", { count: confirmCounts.dirtyTabs })}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}

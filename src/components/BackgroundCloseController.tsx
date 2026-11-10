import { useCallback, useEffect } from "react";
import { Button, Checkbox, Modal, Spin, message } from "antd";
import { useTranslation } from "react-i18next";
import { onBackgroundSettingsChanged, onWorkspaceCloseRequested,
  onWorkspaceExitPreparationCancelled, onWorkspaceExitPreparationRequested } from "@/lib/api";
import {
  chooseWorkspaceClose, refreshBackgroundSettings, requestWorkspaceClose, useBackgroundStore,
  cancelWorkspaceDocumentClose, resolveWorkspaceDocumentClose, prepareWorkspaceExit, cancelPreparedWorkspaceExit,
} from "@/store/slices/background";

export function BackgroundCloseController() {
  const { t } = useTranslation();
  const { promptOpen, busy, remember, setRemember, setPromptOpen,
    documentPromptOpen, documentCloseIntent, unsavedPaths, exitPreparing, closePreparing } = useBackgroundStore();

  const reportError = useCallback((error: unknown) => {
    if (String(error).includes("workspace-exit-")) {
      message.error(t("background.exitSaveFailed"));
      return;
    }
    message.error(error instanceof Error && error.message === "application-update-in-progress"
      ? t("updater.keepOpenDuringDownload") : t("background.actionFailed", { error: String(error) }));
  }, [t]);

  useEffect(() => {
    let disposed = false;
    const cleanups: (() => void)[] = [];
    function register(cleanup: () => void) {
      if (disposed) cleanup();
      else cleanups.push(cleanup);
    }
    void onWorkspaceCloseRequested((exit) => {
      void requestWorkspaceClose(exit).catch(reportError);
    }).then(register).catch(reportError);
    void onBackgroundSettingsChanged((settings) => {
      useBackgroundStore.getState().setSettings(settings);
    }).then(register).catch(reportError);
    void onWorkspaceExitPreparationRequested((nonce) => {
      void prepareWorkspaceExit(nonce).catch(reportError);
    }).then(register).catch(reportError);
    void onWorkspaceExitPreparationCancelled(cancelPreparedWorkspaceExit).then(register).catch(reportError);
    void refreshBackgroundSettings().catch(reportError);
    return () => { disposed = true; cleanups.forEach((cleanup) => cleanup()); };
  }, [reportError]);

  return (
    <>
      <Modal open={promptOpen && !exitPreparing && !closePreparing} title={t("background.closeTitle")} onCancel={() => setPromptOpen(false)}
        closable={!busy} mask={{ closable: !busy }} keyboard={!busy}
        footer={[
          <Button key="cancel" disabled={busy} onClick={() => setPromptOpen(false)}>{t("common.cancel")}</Button>,
          <Button key="close" disabled={busy} onClick={() => void chooseWorkspaceClose(false).catch(reportError)}>{t("background.closeNow")}</Button>,
          <Button key="background" type="primary" loading={busy} onClick={() => void chooseWorkspaceClose(true).catch(reportError)}>{t("background.keepRunning")}</Button>,
        ]}>
        <p className="mb-4">{t("background.closeDescription")}</p>
        <Checkbox checked={remember} disabled={busy} onChange={(event) => setRemember(event.target.checked)}>{t("background.remember")}</Checkbox>
      </Modal>
      <Modal open={documentPromptOpen && !exitPreparing && !closePreparing} title={t("background.unsavedTitle")}
        onCancel={cancelWorkspaceDocumentClose} closable={!busy} mask={{ closable: !busy }} keyboard={!busy}
        footer={[
          <Button key="cancel" disabled={busy} onClick={cancelWorkspaceDocumentClose}>{t("common.cancel")}</Button>,
          <Button key="discard" danger disabled={busy} onClick={() => void resolveWorkspaceDocumentClose(true).catch(reportError)}>
            {t(documentCloseIntent === "close" ? "background.discardAndClose" : "background.discardChanges")}
          </Button>,
          <Button key="save" type="primary" loading={busy} onClick={() => void resolveWorkspaceDocumentClose().catch(reportError)}>
            {t(documentCloseIntent === "close" ? "background.saveAndClose" : "background.saveDocuments")}
          </Button>,
        ]}>
        <p>{t("background.unsavedDescription")}</p>
        <ul className="max-h-48 overflow-auto break-all pl-5">
          {unsavedPaths.map((path) => <li key={path}>{path}</li>)}
        </ul>
      </Modal>
      <Modal open={exitPreparing || closePreparing} title={t(exitPreparing ? "background.preparingExit" : "background.preparingClose")} closable={false}
        mask={{ closable: false }} keyboard={false} footer={null}>
        <div className="flex items-center gap-3"><Spin /><span>{t(exitPreparing ? "background.preparingExitDescription" : "background.preparingCloseDescription")}</span></div>
      </Modal>
    </>
  );
}

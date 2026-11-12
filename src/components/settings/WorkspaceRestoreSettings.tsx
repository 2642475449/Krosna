import { useEffect } from "react";
import { Switch, message } from "antd";
import { useTranslation } from "react-i18next";
import { refreshWorkspaceRecoverySettings, useWorkspaceRecoveryStore } from "@/store/slices/workspaceRecovery";
import { SettingRow } from "./SettingRow";

export function WorkspaceRestoreSettings() {
  const { t } = useTranslation();
  const { enabled, settingsReady, savingSetting, setEnabled } = useWorkspaceRecoveryStore();
  useEffect(() => {
    void refreshWorkspaceRecoverySettings().catch(() => message.error(t("settings.general.workspaceRestoreLoadFailed")));
  }, [t]);
  return (
    <SettingRow label={t("settings.general.restoreWorkspace")} description={t("settings.general.restoreWorkspaceDesc")}>
      <Switch checked={enabled} loading={savingSetting} disabled={!settingsReady || savingSetting}
        aria-label={t("settings.general.restoreWorkspace")}
        onChange={(value) => void setEnabled(value).catch(() => message.error(t("settings.general.workspaceRestoreSaveFailed")))} />
    </SettingRow>
  );
}

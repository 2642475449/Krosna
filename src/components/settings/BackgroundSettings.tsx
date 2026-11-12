import { Select, message } from "antd";
import { useTranslation } from "react-i18next";
import { getWorkspaceCloseBehavior, saveWorkspaceCloseBehavior, useBackgroundStore, type WorkspaceCloseBehavior } from "@/store/slices/background";
import { SettingRow } from "./SettingRow";

export function BackgroundSettings() {
  const { t } = useTranslation();
  const { settings, ready, busy } = useBackgroundStore();
  const behavior = getWorkspaceCloseBehavior(settings);
  return (
    <SettingRow label={t("background.closeBehavior")} description={t(`background.closeBehaviorDescription.${behavior}`)}>
      <Select<WorkspaceCloseBehavior>
        className="w-[280px] max-w-full"
        value={behavior}
        disabled={!ready || busy}
        loading={busy || !ready}
        aria-label={t("background.closeBehavior")}
        options={(["ask", "background", "close"] as const).map((value) => ({ value, label: t(`background.closeBehaviorOption.${value}`) }))}
        onChange={(value) => {
          void saveWorkspaceCloseBehavior(value).catch((error: unknown) => message.error(t("background.actionFailed", { error: String(error) })));
        }}
      />
    </SettingRow>
  );
}

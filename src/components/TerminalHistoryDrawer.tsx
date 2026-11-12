import { Drawer } from "antd";
import { useTranslation } from "react-i18next";
import { useTerminalRecoveryStore } from "@/store/slices/terminalRecovery";
import { TerminalHistoryView } from "./TerminalHistoryView";

/** 主工作区稳定挂载，打开历史不会卸载活动 Terminal 或中断其输出订阅。 */
export function TerminalHistoryDrawer() {
  const { t } = useTranslation();
  const session = useTerminalRecoveryStore((state) => state.historySession);
  const close = () => useTerminalRecoveryStore.getState().setHistorySession(null);
  return (
    <Drawer open={Boolean(session)} onClose={close} title={t("terminal.historyPreview")} size="min(1180px, 92vw)"
      destroyOnHidden push={false} classNames={{ body: "!p-0" }}>
      {session && <TerminalHistoryView session={session} onReturn={close} />}
    </Drawer>
  );
}

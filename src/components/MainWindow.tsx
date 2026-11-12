import { useEffect } from "react";
import { onQuickCommandsUpdated } from "@/lib/api";
import { useRecentProjectSync } from "@/hooks/useRecentProjectSync";
import { startClipboardSessionSync } from "@/store/slices/clipboardCache";
import { startSessionTitleGeneration } from "@/store/slices/sessionTitleSlice";
import { loadProjectQuickCommands } from "@/store/slices/projectQuickCommands";
import { message } from "@/lib/toast";
import i18n from "@/i18n";
import { useAppStore } from "@/store";
import AppLayout from "./layout/AppLayout";
import { BackgroundCloseController } from "./BackgroundCloseController";
import { startWorkspaceRecoverySync } from "@/store/slices/workspaceRecovery";
import { TerminalHistoryDrawer } from "./TerminalHistoryDrawer";

/** 主窗口专用入口；语音窗口不加载工作区组件和项目后台任务。 */
export default function MainWindow({ persistentSettingsReady }: { persistentSettingsReady: boolean }) {
  const projectPath = useAppStore((state) => state.currentProject?.path ?? null);
  useRecentProjectSync();

  useEffect(() => {
    if (!persistentSettingsReady) return;
    return startWorkspaceRecoverySync();
  }, [persistentSettingsReady]);

  useEffect(() => {
    if (!persistentSettingsReady) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const reload = () => {
      if (disposed) return;
      void loadProjectQuickCommands(projectPath).catch((error) => {
        if (!disposed) message.error({
          key: "quick-commands-load-error",
          content: i18n.t("quickCommands.loadFailed", { error: String(error) }),
        });
      });
    };
    // 先订阅，再读取，避免漏掉其他窗口在初始化期间的修改。
    void onQuickCommandsUpdated(reload).then((stop) => {
      if (disposed) { stop(); return; }
      unlisten = stop;
      reload();
    }).catch((error) => {
      console.error("Failed to subscribe to quick commands:", error);
      reload();
    });
    window.addEventListener("focus", reload);
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("focus", reload);
    };
  }, [projectPath, persistentSettingsReady]);

  useEffect(() => {
    if (!persistentSettingsReady) return;
    return startSessionTitleGeneration();
  }, [persistentSettingsReady]);

  useEffect(() => {
    if (!persistentSettingsReady) return;
    return startClipboardSessionSync();
  }, [persistentSettingsReady]);

  return <><BackgroundCloseController /><TerminalHistoryDrawer /><AppLayout /></>;
}

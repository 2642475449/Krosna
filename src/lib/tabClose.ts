import { Modal, message } from "antd";
import type { TFunction } from "i18next";
import type { TabEntity } from "@/store";
import { closePty } from "@/lib/api";
import { useAppStore } from "@/store";
import { findFileDocument } from "@/lib/fileDocument";

export async function closeTabRuntime(
  tab: TabEntity | undefined,
  closeSession: (sessionId: string) => Promise<void> = closePty,
): Promise<void> {
  if (tab?.kind === "session") {
    await closeSession(tab.resourceId);
    useAppStore.getState().clearTerminalExitCode(tab.resourceId);
  }
}

export async function archiveSessionRuntime(
  sessionId: string,
  archiveSession: (sessionId: string) => void,
  closeSession: (sessionId: string) => Promise<void> = closePty,
): Promise<void> {
  await closeSession(sessionId);
  archiveSession(sessionId);
}

export async function confirmCloseTab(tab: TabEntity | undefined, t: TFunction): Promise<boolean> {
  if (!tab || tab.kind !== "file") {
    return true;
  }
  const projectPath = useAppStore.getState().currentProject?.path;
  const document = projectPath ? findFileDocument(projectPath, tab.resourceId) : undefined;
  const state = document?.store.getState();
  if (state ? state.content === state.savedContent : !tab.dirty) return true;
  // Keep the decision meaningful while the confirmation is open: idle/blur
  // auto-save from any host of this shared document must wait for the result.
  const releaseAutoSave = document?.pauseAutoSave();

  return await new Promise<boolean>((resolve) => {
    let finished = false;
    let instance: ReturnType<typeof Modal.confirm> | undefined;
    const finish = (canClose: boolean) => {
      if (finished) return;
      finished = true;
      releaseAutoSave?.();
      resolve(canClose);
      instance?.destroy();
    };
    try {
      instance = Modal.confirm({
        title: t("fileTabs.closeDirtyTitle"),
        content: t("fileTabs.closeDirtyDescription", { name: tab.title }),
        okText: t("fileTabs.closeWithoutSaving"),
        cancelText: t("common.cancel"),
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await document?.discardChanges();
            finish(true);
          } catch (error) {
            void message.error(String(error));
            finish(false);
          }
        },
        onCancel: () => finish(false),
        afterClose: () => finish(false),
      });
    } catch (error) {
      void message.error(String(error));
      finish(false);
    }
  });
}

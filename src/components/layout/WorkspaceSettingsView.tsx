import { lazy, Suspense, useEffect, useRef, type ReactNode } from "react";
import { ArrowLeftOutlined, CloseOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SettingsPanelSkeleton } from "@/components/settings/SettingsPanelSkeleton";
import { isSettingsTab, isWorkspaceSettingsVisible } from "@/lib/workspaceSettings";
import { useAppStore } from "@/store";

const SettingsPanel = lazy(() => import("@/components/SettingsPanel"));

/** Settings belongs to the whole workspace; keep the split tree mounted behind it. */
export function WorkspaceSettingsView({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const visible = useAppStore(isWorkspaceSettingsVisible);
  const settingsTabId = useAppStore((state) =>
    Object.keys(state.tabsById).find((id) => isSettingsTab(id, state.tabsById)),
  );
  const closeTab = useAppStore((state) => state.closeTab);
  const backButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (visible) backButtonRef.current?.focus({ preventScroll: true });
  }, [visible]);

  return (
    <>
      <div
        className="flex min-h-0 flex-1 flex-col"
        data-workspace-splits
        style={{ display: visible ? "none" : undefined }}
      >
        {children}
      </div>
      {settingsTabId ? (
        <div
          className="app-main-stage min-h-0 flex-1 flex-col"
          data-workspace-settings
          style={{ display: visible ? "flex" : "none" }}
        >
          <div className="app-shell-chrome app-glass-tabbar app-settings-topbar">
            <div className="app-settings-topbar__left">
              <button
                ref={backButtonRef}
                type="button"
                className="app-settings-topbar__back"
                onClick={() => closeTab(settingsTabId)}
              >
                <ArrowLeftOutlined className="app-settings-topbar__back-icon" aria-hidden="true" />
                <span>{t("common.back")}</span>
              </button>
              <span className="app-settings-topbar__divider" aria-hidden="true" />
              <span className="app-settings-topbar__title">{t("common.settings")}</span>
            </div>
            <button
              type="button"
              className="app-settings-topbar__close"
              aria-label={t("common.close")}
              title={t("common.close")}
              onClick={() => closeTab(settingsTabId)}
            >
              <CloseOutlined aria-hidden="true" />
            </button>
          </div>
          <div className="relative min-h-0 flex-1">
            <ErrorBoundary scope="workspace:settings" onClose={() => closeTab(settingsTabId)}>
              <Suspense fallback={<SettingsPanelSkeleton />}>
                <SettingsPanel />
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      ) : null}
    </>
  );
}

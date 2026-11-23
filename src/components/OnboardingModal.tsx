import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckOutlined,
  CloseOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Button, Modal, Segmented, Spin, Switch, message } from "antd";
import { useTranslation } from "react-i18next";
import { AgentIcon } from "@/components/AgentIcon";
import { CopyFeedbackIcon } from "@/components/ui/CopyFeedbackIcon";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import { useProjectLauncher } from "@/hooks/useProjectLauncher";
import { AGENT_DEFINITIONS, AI_AGENT_ORDER } from "@/lib/agents";
import { inspectAgentClis, setExplorerContextMenuEnabled } from "@/lib/api";
import {
  useAppStore,
  type Language,
  type TerminalShell,
  type ThemeCategory,
  type ThemeMode,
} from "@/store";
import {
  ONBOARDING_STEPS,
  useOnboardingStore,
  type OnboardingStepId,
} from "@/store/slices/onboardingSlice";
import type { AgentCliInfo, AiAgentId } from "@/types";
import "@/styles/onboarding.css";

interface ThemeOption {
  id: ThemeMode;
  category: "light" | "dark";
  labelKey: string;
  modeKey: string;
}

const THEME_OPTIONS: readonly ThemeOption[] = [
  {
    id: "light-glass",
    category: "light",
    labelKey: "onboarding.appearance.themes.lightGlass",
    modeKey: "onboarding.appearance.lightMode",
  },
  {
    id: "light-warm",
    category: "light",
    labelKey: "onboarding.appearance.themes.lightWarm",
    modeKey: "onboarding.appearance.lightMode",
  },
  {
    id: "dark-starry",
    category: "dark",
    labelKey: "onboarding.appearance.themes.darkStarry",
    modeKey: "onboarding.appearance.darkMode",
  },
  {
    id: "dark-mocha",
    category: "dark",
    labelKey: "onboarding.appearance.themes.darkMocha",
    modeKey: "onboarding.appearance.darkMode",
  },
];

const STEP_LABEL_KEYS: Record<OnboardingStepId, string> = {
  appearance: "onboarding.steps.appearance",
  agents: "onboarding.steps.agents",
  project: "onboarding.steps.project",
  preferences: "onboarding.steps.preferences",
};

const STEP_HEADER_KEYS: Record<
  OnboardingStepId,
  { title: string; subtitle: string }
> = {
  appearance: {
    title: "onboarding.appearance.title",
    subtitle: "onboarding.appearance.subtitle",
  },
  agents: {
    title: "onboarding.agents.title",
    subtitle: "onboarding.agents.subtitle",
  },
  project: {
    title: "onboarding.project.title",
    subtitle: "onboarding.project.subtitle",
  },
  preferences: {
    title: "onboarding.preferences.title",
    subtitle: "onboarding.preferences.subtitle",
  },
};

export function OnboardingModal() {
  const { t } = useTranslation();
  const modalOpen = useOnboardingStore((s) => s.modalOpen);
  const activeStep = useOnboardingStore((s) => s.activeStep);
  const completedSteps = useOnboardingStore((s) => s.completedSteps);
  const setActiveStep = useOnboardingStore((s) => s.setActiveStep);
  const nextStep = useOnboardingStore((s) => s.nextStep);
  const prevStep = useOnboardingStore((s) => s.prevStep);
  const skipOnboarding = useOnboardingStore((s) => s.skipOnboarding);

  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const themeCategory = useAppStore((s) => s.themeCategory);
  const setThemeCategory = useAppStore((s) => s.setThemeCategory);
  const lightTheme = useAppStore((s) => s.lightTheme);
  const setLightTheme = useAppStore((s) => s.setLightTheme);
  const darkTheme = useAppStore((s) => s.darkTheme);
  const setDarkTheme = useAppStore((s) => s.setDarkTheme);
  const systemPrefersDark = useAppStore((s) => s.systemPrefersDark);

  const defaultAgentId = useAppStore((s) => s.defaultAgentId);
  const setDefaultAgentId = useAppStore((s) => s.setDefaultAgentId);
  const currentProject = useAppStore((s) => s.currentProject);

  const explorerContextMenuEnabled = useAppStore(
    (s) => s.explorerContextMenuEnabled,
  );
  const setExplorerContextMenu = useAppStore(
    (s) => s.setExplorerContextMenuEnabled,
  );
  const notificationEnabled = useAppStore((s) => s.notificationEnabled);
  const setNotificationEnabled = useAppStore((s) => s.setNotificationEnabled);
  const startupRestoreLastProject = useAppStore(
    (s) => s.startupRestoreLastProject,
  );
  const setStartupRestoreLastProject = useAppStore(
    (s) => s.setStartupRestoreLastProject,
  );
  const defaultTerminalShell = useAppStore((s) => s.defaultTerminalShell);
  const setDefaultTerminalShell = useAppStore((s) => s.setDefaultTerminalShell);

  const { recentProjects, selectProjectFolder, openProject } =
    useProjectLauncher();
  const { isCopied, markCopied } = useCopyFeedback();

  const [agentInfos, setAgentInfos] = useState<AgentCliInfo[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsScanned, setAgentsScanned] = useState(false);
  const [selectedProjectPath, setSelectedProjectPath] = useState<string | null>(
    null,
  );
  const [openingProject, setOpeningProject] = useState(false);
  const [updatingContextMenu, setUpdatingContextMenu] = useState(false);

  const scanAgents = useCallback(async () => {
    setAgentsLoading(true);
    try {
      const results = await inspectAgentClis();
      setAgentInfos(results);
      setAgentsScanned(true);
      // 若尚未设置默认智能体，自动选中首个已安装的智能体
      if (!useAppStore.getState().defaultAgentId) {
        const firstInstalled = AI_AGENT_ORDER.find((id) =>
          results.some((item) => item.id === id && item.installed),
        );
        if (firstInstalled) {
          setDefaultAgentId(firstInstalled);
        }
      }
    } catch (error) {
      console.error("Failed to inspect agent CLIs during onboarding:", error);
      setAgentsScanned(true);
    } finally {
      setAgentsLoading(false);
    }
  }, [setDefaultAgentId]);

  useEffect(() => {
    if (!modalOpen || agentsScanned || agentsLoading) return;
    if (activeStep === "agents") {
      void scanAgents();
    }
  }, [modalOpen, activeStep, agentsScanned, agentsLoading, scanAgents]);

  const isDarkEffective =
    themeCategory === "dark" ||
    (themeCategory === "system" && systemPrefersDark);
  const activeThemeId: ThemeMode = isDarkEffective ? darkTheme : lightTheme;

  const handleSelectThemeCard = (option: ThemeOption) => {
    if (option.category === "light") {
      setLightTheme(option.id);
      if (isDarkEffective) {
        setThemeCategory("light");
      }
    } else {
      setDarkTheme(option.id);
      if (!isDarkEffective) {
        setThemeCategory("dark");
      }
    }
  };

  const agentInfoMap = useMemo(() => {
    const map = new Map<AiAgentId, AgentCliInfo>();
    for (const info of agentInfos) {
      map.set(info.id as AiAgentId, info);
    }
    return map;
  }, [agentInfos]);

  const installedCount = useMemo(
    () =>
      AI_AGENT_ORDER.filter((id) => agentInfoMap.get(id)?.installed).length,
    [agentInfoMap],
  );

  const handleCopyInstallCommand = async (agentId: AiAgentId, cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      markCopied(`install-${agentId}`);
      message.success(t("common.copied"));
    } catch {
      message.error(t("onboarding.agents.copyFailed"));
    }
  };

  const handlePickProject = async () => {
    const picked = await selectProjectFolder();
    if (!picked) return;
    setOpeningProject(true);
    try {
      await openProject(picked, "current_window");
      setSelectedProjectPath(picked);
    } catch (error) {
      console.error("Failed to open project from onboarding:", error);
      message.error(t("sidebar.projectWindowOpenFailed"));
    } finally {
      setOpeningProject(false);
    }
  };

  const handleOpenRecentProject = async (path: string) => {
    setOpeningProject(true);
    try {
      await openProject(path, "current_window");
      setSelectedProjectPath(path);
    } catch (error) {
      console.error("Failed to open recent project from onboarding:", error);
      message.error(t("sidebar.projectWindowOpenFailed"));
    } finally {
      setOpeningProject(false);
    }
  };

  const handleToggleContextMenu = async (checked: boolean) => {
    setUpdatingContextMenu(true);
    try {
      await setExplorerContextMenuEnabled(checked);
      setExplorerContextMenu(checked);
    } catch (error) {
      console.error("Failed to toggle explorer context menu:", error);
      message.error(t("onboarding.preferences.contextMenuFailed"));
    } finally {
      setUpdatingContextMenu(false);
    }
  };

  const activeStepIndex = ONBOARDING_STEPS.indexOf(activeStep);
  const isFirstStep = activeStepIndex === 0;
  const isLastStep = activeStepIndex === ONBOARDING_STEPS.length - 1;
  const effectiveProjectPath = selectedProjectPath ?? currentProject?.path ?? null;

  return (
    <Modal
      open={modalOpen}
      centered
      closable={false}
      footer={null}
      width={760}
      mask={{ closable: false }}
      keyboard
      onCancel={skipOnboarding}
      className="app-onboarding-modal"
      destroyOnHidden
    >
      <div className="app-onboarding-shell">
        <aside
          className="app-onboarding-rail"
          aria-label={t("onboarding.railAriaLabel")}
        >
          <div className="app-onboarding-brand">
            <img
              src="/logo.png"
              alt="Krosna"
              className="app-onboarding-brand-logo"
            />
            <span className="app-onboarding-brand-name">Krosna</span>
          </div>

          <ol className="app-onboarding-steps">
            {ONBOARDING_STEPS.map((stepId, index) => {
              const isActive = stepId === activeStep;
              const isDone = !isActive && completedSteps.includes(stepId);
              return (
                <li key={stepId}>
                  <button
                    type="button"
                    className={`app-onboarding-step-btn ${isActive ? "app-onboarding-step-btn--active" : ""}`}
                    aria-current={isActive ? "step" : undefined}
                    onClick={() => setActiveStep(stepId)}
                  >
                    <span
                      className={`app-onboarding-step-badge ${
                        isActive
                          ? "app-onboarding-step-badge--active"
                          : isDone
                            ? "app-onboarding-step-badge--done"
                            : ""
                      }`}
                      aria-hidden="true"
                    >
                      {isDone ? <CheckOutlined /> : index + 1}
                    </span>
                    <span>{t(STEP_LABEL_KEYS[stepId])}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        <section className="app-onboarding-main">
          <header className="app-onboarding-header">
            <div className="min-w-0">
              <h2 className="app-onboarding-title">
                {t(STEP_HEADER_KEYS[activeStep].title)}
              </h2>
              <p className="app-onboarding-subtitle">
                {t(STEP_HEADER_KEYS[activeStep].subtitle)}
              </p>
            </div>
            <button
              type="button"
              className="app-onboarding-close"
              aria-label={t("onboarding.close")}
              onClick={skipOnboarding}
            >
              <CloseOutlined />
            </button>
          </header>

          <div className="app-onboarding-body app-thin-scrollbar">
            {activeStep === "appearance" && (
              <div>
                <div className="app-onboarding-group">
                  <div className="app-onboarding-row">
                    <div className="app-onboarding-row-meta">
                      <div className="app-onboarding-row-title">
                        {t("onboarding.appearance.languageLabel")}
                      </div>
                      <div className="app-onboarding-row-desc">
                        {t("onboarding.appearance.languageDesc")}
                      </div>
                    </div>
                    <div className="app-onboarding-row-control">
                      <Segmented<Language>
                        size="small"
                        value={language}
                        onChange={(value) => setLanguage(value)}
                        options={[
                          { label: "简体中文", value: "zh_CN" },
                          { label: "English", value: "en" },
                          { label: "日本語", value: "ja" },
                        ]}
                      />
                    </div>
                  </div>

                  <div className="app-onboarding-row">
                    <div className="app-onboarding-row-meta">
                      <div className="app-onboarding-row-title">
                        {t("onboarding.appearance.modeLabel")}
                      </div>
                      <div className="app-onboarding-row-desc">
                        {t("onboarding.appearance.modeDesc")}
                      </div>
                    </div>
                    <div className="app-onboarding-row-control">
                      <Segmented<ThemeCategory>
                        size="small"
                        value={themeCategory}
                        onChange={(value) => setThemeCategory(value)}
                        options={[
                          {
                            label: t("onboarding.appearance.systemMode"),
                            value: "system",
                          },
                          {
                            label: t("onboarding.appearance.lightMode"),
                            value: "light",
                          },
                          {
                            label: t("onboarding.appearance.darkMode"),
                            value: "dark",
                          },
                        ]}
                      />
                    </div>
                  </div>
                </div>

                <div className="app-onboarding-section-label">
                  {t("onboarding.appearance.themeStyleLabel")}
                </div>
                <div className="app-onboarding-theme-grid">
                  {THEME_OPTIONS.map((option) => {
                    const selected = activeThemeId === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={`app-onboarding-theme-card ${
                          selected ? "app-onboarding-theme-card--selected" : ""
                        }`}
                        aria-pressed={selected}
                        onClick={() => handleSelectThemeCard(option)}
                      >
                        <div
                          className="app-onboarding-theme-preview"
                          data-theme={option.id}
                          aria-hidden="true"
                        >
                          <div className="app-onboarding-theme-preview-sidebar">
                            <span className="app-onboarding-theme-preview-bar" />
                            <span className="app-onboarding-theme-preview-bar" />
                          </div>
                          <div className="app-onboarding-theme-preview-main">
                            <span className="app-onboarding-theme-preview-accent" />
                            <span className="app-onboarding-theme-preview-bar" />
                          </div>
                        </div>
                        <div className="app-onboarding-theme-meta">
                          <span className="app-onboarding-theme-name">
                            {t(option.labelKey)}
                          </span>
                          <span className="app-onboarding-theme-tag">
                            {t(option.modeKey)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {activeStep === "agents" && (
              <div>
                <div className="app-onboarding-agents-toolbar">
                  <span className="app-onboarding-agents-summary">
                    {agentsLoading
                      ? t("onboarding.agents.scanning")
                      : t("onboarding.agents.detectedSummary", {
                          installed: installedCount,
                          total: AI_AGENT_ORDER.length,
                        })}
                  </span>
                  <Button
                    size="small"
                    icon={<ReloadOutlined spin={agentsLoading} />}
                    onClick={() => void scanAgents()}
                    disabled={agentsLoading}
                  >
                    {t("onboarding.agents.rescan")}
                  </Button>
                </div>

                {agentsLoading && !agentsScanned ? (
                  <div className="flex items-center justify-center py-12">
                    <Spin />
                  </div>
                ) : (
                  <div className="app-onboarding-group">
                    {AI_AGENT_ORDER.map((agentId) => {
                      const def = AGENT_DEFINITIONS[agentId];
                      const info = agentInfoMap.get(agentId);
                      const installed = Boolean(info?.installed);
                      const isDefault = defaultAgentId === agentId;
                      const installCmd = def.installCommands[0]?.command;

                      return (
                        <div key={agentId} className="app-onboarding-row">
                          <div className="app-onboarding-row-meta">
                            <div className="app-onboarding-row-title">
                              <AgentIcon agentId={agentId} size={16} />
                              <span>{def.displayName}</span>
                              <span
                                className={`app-onboarding-agent-status ${
                                  installed
                                    ? "app-onboarding-agent-status--installed"
                                    : "app-onboarding-agent-status--missing"
                                }`}
                              >
                                {installed
                                  ? info?.version
                                    ? `${t("onboarding.agents.installed")} ${info.version}`
                                    : t("onboarding.agents.installed")
                                  : t("onboarding.agents.notInstalled")}
                              </span>
                            </div>
                            {!installed && installCmd && (
                              <div
                                className="app-onboarding-install-cmd"
                                title={installCmd}
                              >
                                {installCmd}
                              </div>
                            )}
                          </div>

                          <div className="app-onboarding-row-control">
                            {installed ? (
                              <Button
                                size="small"
                                type={isDefault ? "primary" : "default"}
                                onClick={() => setDefaultAgentId(agentId)}
                              >
                                {isDefault
                                  ? t("onboarding.agents.defaultBadge")
                                  : t("onboarding.agents.setDefault")}
                              </Button>
                            ) : installCmd ? (
                              <Button
                                size="small"
                                icon={
                                  <CopyFeedbackIcon
                                    copied={isCopied(`install-${agentId}`)}
                                  />
                                }
                                onClick={() =>
                                  void handleCopyInstallCommand(
                                    agentId,
                                    installCmd,
                                  )
                                }
                              >
                                {t(
                                  isCopied(`install-${agentId}`)
                                    ? "common.copied"
                                    : "onboarding.agents.copyInstall",
                                )}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeStep === "project" && (
              <div>
                <div className="app-onboarding-project-card">
                  <div className="app-onboarding-row-meta">
                    <div className="app-onboarding-row-title">
                      {effectiveProjectPath
                        ? t("onboarding.project.selectedTitle")
                        : t("onboarding.project.emptyTitle")}
                    </div>
                    {effectiveProjectPath ? (
                      <div className="app-onboarding-project-path">
                        {effectiveProjectPath}
                      </div>
                    ) : (
                      <div className="app-onboarding-row-desc">
                        {t("onboarding.project.emptyDesc")}
                      </div>
                    )}
                  </div>
                  <div className="app-onboarding-row-control">
                    <Button
                      type={effectiveProjectPath ? "default" : "primary"}
                      icon={<FolderOpenOutlined />}
                      loading={openingProject}
                      onClick={() => void handlePickProject()}
                    >
                      {effectiveProjectPath
                        ? t("onboarding.project.changeFolder")
                        : t("onboarding.project.chooseFolder")}
                    </Button>
                  </div>
                </div>

                {recentProjects.length > 0 && (
                  <>
                    <div className="app-onboarding-section-label">
                      {t("onboarding.project.recentTitle")}
                    </div>
                    <div className="app-onboarding-group">
                      {recentProjects.slice(0, 3).map((project) => (
                        <div key={project.path} className="app-onboarding-row">
                          <div className="app-onboarding-row-meta">
                            <div className="app-onboarding-row-title">
                              {project.name}
                            </div>
                            <div className="app-onboarding-install-cmd">
                              {project.path}
                            </div>
                          </div>
                          <div className="app-onboarding-row-control">
                            <Button
                              size="small"
                              loading={openingProject}
                              onClick={() =>
                                void handleOpenRecentProject(project.path)
                              }
                            >
                              {t("onboarding.project.openRecent")}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <p className="app-onboarding-project-hint">
                  {t("onboarding.project.skipHint")}
                </p>
              </div>
            )}

            {activeStep === "preferences" && (
              <div className="app-onboarding-group">
                <div className="app-onboarding-row">
                  <div className="app-onboarding-row-meta">
                    <div className="app-onboarding-row-title">
                      {t("onboarding.preferences.contextMenuTitle")}
                    </div>
                    <div className="app-onboarding-row-desc">
                      {t("onboarding.preferences.contextMenuDesc")}
                    </div>
                  </div>
                  <div className="app-onboarding-row-control">
                    <Switch
                      checked={explorerContextMenuEnabled}
                      loading={updatingContextMenu}
                      aria-label={t("onboarding.preferences.contextMenuTitle")}
                      onChange={(checked) =>
                        void handleToggleContextMenu(checked)
                      }
                    />
                  </div>
                </div>

                <div className="app-onboarding-row">
                  <div className="app-onboarding-row-meta">
                    <div className="app-onboarding-row-title">
                      {t("onboarding.preferences.notificationsTitle")}
                    </div>
                    <div className="app-onboarding-row-desc">
                      {t("onboarding.preferences.notificationsDesc")}
                    </div>
                  </div>
                  <div className="app-onboarding-row-control">
                    <Switch
                      checked={notificationEnabled}
                      aria-label={t(
                        "onboarding.preferences.notificationsTitle",
                      )}
                      onChange={(checked) => setNotificationEnabled(checked)}
                    />
                  </div>
                </div>

                <div className="app-onboarding-row">
                  <div className="app-onboarding-row-meta">
                    <div className="app-onboarding-row-title">
                      {t("onboarding.preferences.restoreProjectTitle")}
                    </div>
                    <div className="app-onboarding-row-desc">
                      {t("onboarding.preferences.restoreProjectDesc")}
                    </div>
                  </div>
                  <div className="app-onboarding-row-control">
                    <Switch
                      checked={startupRestoreLastProject}
                      aria-label={t(
                        "onboarding.preferences.restoreProjectTitle",
                      )}
                      onChange={(checked) =>
                        setStartupRestoreLastProject(checked)
                      }
                    />
                  </div>
                </div>

                <div className="app-onboarding-row">
                  <div className="app-onboarding-row-meta">
                    <div className="app-onboarding-row-title">
                      {t("onboarding.preferences.shellTitle")}
                    </div>
                    <div className="app-onboarding-row-desc">
                      {t("onboarding.preferences.shellDesc")}
                    </div>
                  </div>
                  <div className="app-onboarding-row-control">
                    <Segmented<TerminalShell>
                      size="small"
                      value={defaultTerminalShell}
                      onChange={(value) => setDefaultTerminalShell(value)}
                      options={[
                        { label: "PowerShell", value: "powershell" },
                        { label: "CMD", value: "cmd" },
                      ]}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <footer className="app-onboarding-footer">
            <Button type="default" onClick={skipOnboarding}>
              {t("onboarding.skip")}
            </Button>
            <div className="app-onboarding-footer-actions">
              {!isFirstStep && (
                <Button onClick={prevStep}>{t("onboarding.back")}</Button>
              )}
              <Button type="primary" onClick={nextStep}>
                {isLastStep ? t("onboarding.finish") : t("onboarding.continue")}
              </Button>
            </div>
          </footer>
        </section>
      </div>
    </Modal>
  );
}

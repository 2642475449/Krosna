import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Button, Modal, Segmented, Spin, Switch, message } from "antd";
import { useTranslation } from "react-i18next";
import { AgentIcon } from "@/components/AgentIcon";
import { CopyFeedbackIcon } from "@/components/ui/CopyFeedbackIcon";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import { useProjectLauncher } from "@/hooks/useProjectLauncher";
import { formatShortAgentVersion } from "@/lib/agentSettingsView";
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
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [selectedProjectPath, setSelectedProjectPath] = useState<string | null>(
    null,
  );
  const [openingProject, setOpeningProject] = useState(false);
  const [updatingContextMenu, setUpdatingContextMenu] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const prevStepRef = useRef<OnboardingStepId>(activeStep);

  useEffect(() => {
    if (!modalOpen) {
      prevStepRef.current = activeStep;
      return;
    }
    if (prevStepRef.current !== activeStep) {
      prevStepRef.current = activeStep;
      titleRef.current?.focus();
    }
  }, [modalOpen, activeStep]);

  const scanAgents = useCallback(async () => {
    setAgentsLoading(true);
    setAgentsError(null);
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
      setAgentsError(t("onboarding.agents.scanFailed"));
      setAgentsScanned(true);
    } finally {
      setAgentsLoading(false);
    }
  }, [setDefaultAgentId, t]);

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
      if (themeCategory !== "system" && isDarkEffective) {
        setThemeCategory("light");
      }
    } else {
      setDarkTheme(option.id);
      if (themeCategory !== "system" && !isDarkEffective) {
        setThemeCategory("dark");
      }
    }
  };

  const handleSkipOnboarding = () => {
    skipOnboarding();
    message.info(t("onboarding.skipToast"));
  };

  const agentInfoMap = useMemo(() => {
    const map = new Map<AiAgentId, AgentCliInfo>();
    for (const info of agentInfos) {
      map.set(info.id as AiAgentId, info);
    }
    return map;
  }, [agentInfos]);

  const { installedAgents, missingAgents } = useMemo(() => {
    const installed: AiAgentId[] = [];
    const missing: AiAgentId[] = [];
    for (const id of AI_AGENT_ORDER) {
      if (agentInfoMap.get(id)?.installed) {
        installed.push(id);
      } else {
        missing.push(id);
      }
    }
    return { installedAgents: installed, missingAgents: missing };
  }, [agentInfoMap]);

  const installedCount = installedAgents.length;

  const activeThemeOption = THEME_OPTIONS.find((o) => o.id === activeThemeId);
  const defaultAgentDisplayName = defaultAgentId
    ? AGENT_DEFINITIONS[defaultAgentId]?.displayName
    : null;

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
      onCancel={handleSkipOnboarding}
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

          <p className="app-onboarding-rail-note">
            {t("onboarding.localFirstNote")}
          </p>
        </aside>

        <section className="app-onboarding-main">
          <header className="app-onboarding-header">
            <div className="min-w-0">
              <h2
                ref={titleRef}
                tabIndex={-1}
                className="app-onboarding-title"
              >
                {t(STEP_HEADER_KEYS[activeStep].title)}
              </h2>
              <p className="app-onboarding-subtitle">
                {t(STEP_HEADER_KEYS[activeStep].subtitle)}
              </p>
            </div>
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
                <div
                  className="app-onboarding-theme-grid"
                  role="radiogroup"
                  aria-label={t("onboarding.appearance.themeStyleLabel")}
                >
                  {THEME_OPTIONS.map((option) => {
                    const selected = activeThemeId === option.id;
                    const isPairedSystemTheme =
                      themeCategory === "system" &&
                      !selected &&
                      ((option.category === "light" && option.id === lightTheme) ||
                        (option.category === "dark" && option.id === darkTheme));
                    const pairedTag =
                      option.category === "light"
                        ? t("onboarding.appearance.systemLightPaired")
                        : t("onboarding.appearance.systemDarkPaired");

                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={`app-onboarding-theme-card ${
                          selected
                            ? "app-onboarding-theme-card--selected"
                            : isPairedSystemTheme
                              ? "app-onboarding-theme-card--paired"
                              : ""
                        }`}
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
                          <span className="app-onboarding-theme-name-wrap">
                            {selected && (
                              <CheckOutlined
                                className="app-onboarding-theme-check"
                                aria-hidden="true"
                              />
                            )}
                            <span className="app-onboarding-theme-name">
                              {t(option.labelKey)}
                            </span>
                          </span>
                          <span
                            className={`app-onboarding-theme-tag ${
                              isPairedSystemTheme
                                ? "app-onboarding-theme-tag--paired"
                                : ""
                            }`}
                          >
                            {isPairedSystemTheme ? pairedTag : t(option.modeKey)}
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
                  <span
                    className="app-onboarding-agents-summary"
                    aria-live="polite"
                  >
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

                {agentsError && (
                  <div
                    className="app-onboarding-agents-notice app-onboarding-agents-notice--error"
                    role="alert"
                  >
                    <span>{agentsError}</span>
                    <Button
                      size="small"
                      onClick={() => void scanAgents()}
                      disabled={agentsLoading}
                    >
                      {t("onboarding.agents.rescan")}
                    </Button>
                  </div>
                )}

                {!agentsError && agentsScanned && installedCount === 0 && (
                  <div className="app-onboarding-agents-notice">
                    <span>{t("onboarding.agents.noneInstalledHint")}</span>
                  </div>
                )}

                {agentsLoading && !agentsScanned ? (
                  <div className="flex items-center justify-center py-12">
                    <Spin />
                  </div>
                ) : (
                  <>
                    {installedAgents.length > 0 && (
                      <div className="app-onboarding-group">
                        {installedAgents.map((agentId) => {
                          const def = AGENT_DEFINITIONS[agentId];
                          const info = agentInfoMap.get(agentId);
                          const shortVersion = formatShortAgentVersion(info?.version, def.displayName);
                          const isDefault = defaultAgentId === agentId;

                          return (
                            <div key={agentId} className="app-onboarding-row">
                              <div className="app-onboarding-row-meta">
                                <div className="app-onboarding-row-title">
                                  <AgentIcon agentId={agentId} size={16} />
                                  <span>{def.displayName}</span>
                                  <span className="app-onboarding-agent-status app-onboarding-agent-status--installed">
                                    {shortVersion
                                      ? `${t("onboarding.agents.installed")} ${shortVersion}`
                                      : t("onboarding.agents.installed")}
                                  </span>
                                </div>
                              </div>
                              <div className="app-onboarding-row-control">
                                <Button
                                  size="small"
                                  type={isDefault ? "primary" : "default"}
                                  onClick={() => setDefaultAgentId(agentId)}
                                >
                                  {isDefault
                                    ? t("onboarding.agents.defaultBadge")
                                    : t("onboarding.agents.setDefault")}
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {missingAgents.length > 0 && (() => {
                      const missingGroup = (
                        <div className="app-onboarding-group">
                          {missingAgents.map((agentId) => {
                            const def = AGENT_DEFINITIONS[agentId];
                            const installCmd = def.installCommands[0]?.command;

                            return (
                              <div key={agentId} className="app-onboarding-row">
                                <div className="app-onboarding-row-meta">
                                  <div className="app-onboarding-row-title">
                                    <AgentIcon agentId={agentId} size={16} />
                                    <span>{def.displayName}</span>
                                    <span className="app-onboarding-agent-status app-onboarding-agent-status--missing">
                                      {t("onboarding.agents.notInstalled")}
                                    </span>
                                  </div>
                                  {installCmd && (
                                    <div className="app-onboarding-install-cmd">
                                      {installCmd}
                                    </div>
                                  )}
                                </div>
                                <div className="app-onboarding-row-control">
                                  {installCmd && (
                                    <Button
                                      size="small"
                                      icon={
                                        <CopyFeedbackIcon
                                          copied={isCopied(
                                            `install-${agentId}`,
                                          )}
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
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );

                      return installedAgents.length > 0 ? (
                        <details className="app-onboarding-agents-disclosure">
                          <summary className="app-onboarding-agents-disclosure-summary">
                            {t("onboarding.agents.availableOthers", {
                              count: missingAgents.length,
                            })}
                          </summary>
                          {missingGroup}
                        </details>
                      ) : (
                        missingGroup
                      );
                    })()}
                  </>
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
              <div>
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

                <div className="app-onboarding-summary-bar">
                  <span className="app-onboarding-summary-label">
                    {t("onboarding.preferences.summaryLabel")}
                  </span>
                  <span>
                    {activeThemeOption ? t(activeThemeOption.labelKey) : ""}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {defaultAgentDisplayName ??
                      t("onboarding.preferences.plainTerminalFallback")}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {defaultTerminalShell === "cmd" ? "CMD" : "PowerShell"}
                  </span>
                </div>
              </div>
            )}
          </div>

          <footer className="app-onboarding-footer">
            <Button type="default" onClick={handleSkipOnboarding}>
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpOutlined,
  CheckOutlined,
  CloseOutlined,
  CodeOutlined,
  CopyOutlined,
  ReloadOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Button, Popover, Select, Spin, Switch, message } from "antd";
import { useTranslation } from "react-i18next";
import { TASK_CHOICES, useLaunchChoiceLabel } from "@/hooks/useLaunchChoiceLabel";
import { AgentIcon } from "@/components/AgentIcon";
import { QuotaUsageRing } from "@/components/layout/QuotaUsageRing";
import { AgentQuotaCard } from "@/components/settings/AgentQuotaCard";
import { LedgerRowPopover } from "@/components/settings/LedgerRowPopover";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { getAntigravityUsage, getClaudeRateLimits, getCodexRateLimits, getQoderUsage, inspectAgentClis } from "@/lib/api";
import {
  AGENT_DEFINITIONS,
  AI_AGENT_ORDER,
  applyGlobalPermissionPreset,
  getAgentCommandPreview,
  getDefaultAgentLaunchOptions,
  getGlobalPermissionPreset,
} from "@/lib/agents";
import {
  getAgentQuotaPresentation,
  getAgentVersionPresentation,
  mergeAgentQuotaResult,
  shouldReuseInFlightQuotaRequest,
  type AgentQuotaPayload,
} from "@/lib/agentSettingsView";
import { useAppStore } from "@/store";
import { useAgentVersionsStore } from "@/store/slices/agentVersions";
import type {
  AgentCliInfo,
  AiAgentId,
  AntigravityUsage,
  ClaudeRateLimits,
  CodexRateLimits,
  QoderUsage,
  SessionLaunchOptions,
} from "@/types";
import { CodexHookStatus } from "./CodexHookStatus";

type Quotas = {
  claude: ClaudeRateLimits | null;
  codex: CodexRateLimits | null;
  antigravity: AntigravityUsage | null;
  qoder: QoderUsage | null;
};

const EMPTY_QUOTAS: Quotas = { claude: null, codex: null, antigravity: null, qoder: null };
const CONFIGURABLE_AGENTS: readonly AiAgentId[] = ["claude", "codex", "antigravity", "qoder"];
const QUOTA_REFRESH_INTERVAL_MS = 3 * 60 * 1000;
const QUOTA_RESUME_MAX_AGE_MS = 60 * 1000;

function quotaForAgent(agentId: AiAgentId, quotas: Quotas): AgentQuotaPayload {
  switch (agentId) {
    case "claude":
      return quotas.claude;
    case "codex":
      return quotas.codex;
    case "antigravity":
      return quotas.antigravity;
    case "qoder":
      return quotas.qoder;
    default:
      return null;
  }
}

export function AgentsPage() {
  const { t, i18n } = useTranslation();
  const versionChecks = useAgentVersionsStore((state) => state.versions);
  const setVersionChecks = useAgentVersionsStore((state) => state.setVersionChecks);
  const versionLoading = useMemo(
    () => Object.values(versionChecks).some((version) => version?.status === "checking"),
    [versionChecks],
  );
  const defaultAgentId = useAppStore((state) => state.defaultAgentId);
  const setDefaultAgentId = useAppStore((state) => state.setDefaultAgentId);
  const permissionDefaults = useAppStore((state) => state.agentPermissionDefaults);
  const setAllDefaults = useAppStore((state) => state.setAllAgentPermissionDefaults);
  const sessions = useAppStore((state) => state.sessions);
  const activeSessionId = useAppStore((state) => state.activeSessionId);

  const [agents, setAgents] = useState<AgentCliInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [quotaRefreshFailed, setQuotaRefreshFailed] = useState(false);
  const [quotas, setQuotas] = useState<Quotas>(EMPTY_QUOTAS);
  const [editingId, setEditingId] = useState<AiAgentId | null>(null);
  const [showCommand, setShowCommand] = useState(false);
  const quotaRequestRef = useRef<{ promise: Promise<void>; forceRefresh: boolean; seq: number } | null>(null);
  const quotaRequestSeqRef = useRef(0);
  const lastQuotaRefreshAtRef = useRef(0);
  const rowRefs = useRef<Map<AiAgentId, HTMLDivElement>>(new Map());
  const actionButtonRefs = useRef<Map<AiAgentId, HTMLButtonElement>>(new Map());
  const triggerElRef = useRef<HTMLElement | null>(null);

  const claudeSessionId = useMemo(() => {
    const active = sessions.find((session) => session.id === activeSessionId);
    if (active?.agentId === "claude") return active.id;
    return sessions.find((session) => session.agentId === "claude")?.id ?? null;
  }, [activeSessionId, sessions]);

  const loadQuotas = useCallback((detected: AgentCliInfo[], forceRefresh = false): Promise<void> => {
    if (shouldReuseInFlightQuotaRequest(quotaRequestRef.current, forceRefresh)) {
      return quotaRequestRef.current!.promise;
    }

    const seq = ++quotaRequestSeqRef.current;
    const installed = new Set(detected.filter((agent) => agent.installed).map((agent) => agent.id));
    setQuotaLoading(true);
    const request = (async () => {
      const [claude, codex, antigravity, qoder] = await Promise.allSettled([
        installed.has("claude") && claudeSessionId ? getClaudeRateLimits(claudeSessionId) : Promise.resolve(null),
        installed.has("codex") ? getCodexRateLimits({ forceRefresh }) : Promise.resolve(null),
        installed.has("antigravity") ? getAntigravityUsage({ forceRefresh }) : Promise.resolve(null),
        installed.has("qoder") ? getQoderUsage({ forceRefresh }) : Promise.resolve(null),
      ]);
      if (seq !== quotaRequestSeqRef.current) return;
      setQuotas((current) => ({
        claude: mergeAgentQuotaResult(current.claude, claude),
        codex: mergeAgentQuotaResult(current.codex, codex),
        antigravity: mergeAgentQuotaResult(current.antigravity, antigravity),
        qoder: mergeAgentQuotaResult(current.qoder, qoder),
      }));
      setQuotaRefreshFailed(
        claude.status === "rejected" || codex.status === "rejected" || antigravity.status === "rejected" || qoder.status === "rejected",
      );
    })().finally(() => {
      if (seq === quotaRequestSeqRef.current) {
        lastQuotaRefreshAtRef.current = Date.now();
        setQuotaLoading(false);
        quotaRequestRef.current = null;
      }
    });
    quotaRequestRef.current = { promise: request, forceRefresh, seq };
    return request;
  }, [claudeSessionId]);

  const refresh = useCallback(async (showSuccess = false) => {
    void setVersionChecks(showSuccess);
    setLoading(true);
    try {
      const result = [...await inspectAgentClis({ forceRefresh: showSuccess })].sort(
        (left, right) => AI_AGENT_ORDER.indexOf(left.id) - AI_AGENT_ORDER.indexOf(right.id),
      );
      setAgents(result);
      await loadQuotas(result, showSuccess);
      if (showSuccess) message.success(t("settings.agents.refreshSuccess"));
    } catch (error) {
      console.error("Failed to inspect agent CLIs:", error);
      message.error(t("settings.agents.refreshFailed"));
    } finally {
      setLoading(false);
    }
  }, [loadQuotas, setVersionChecks, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (agents.length === 0) return;

    const refreshVisibleQuotas = () => {
      if (document.visibilityState !== "visible") return;
      void loadQuotas(agents, true);
    };
    const interval = window.setInterval(refreshVisibleQuotas, QUOTA_REFRESH_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastQuotaRefreshAtRef.current < QUOTA_RESUME_MAX_AGE_MS) return;
      refreshVisibleQuotas();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [agents, loadQuotas]);

  const installedIds = useMemo(
    () => agents.filter((agent) => agent.installed).map((agent) => agent.id),
    [agents],
  );
  const globalPreset = useMemo(
    () => getGlobalPermissionPreset(permissionDefaults, installedIds),
    [installedIds, permissionDefaults],
  );

  const selectDefaultById = useCallback((agentId: AiAgentId) => {
    const target = agents.find((agent) => agent.id === agentId);
    if (agents.length > 0 && !target?.installed) return;
    setDefaultAgentId(agentId);
    message.success(t("settings.agents.defaultChanged", { name: AGENT_DEFINITIONS[agentId].displayName }));
  }, [agents, setDefaultAgentId, t]);

  const copyText = useCallback(async (value: string, successText: string, failedText: string) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success(successText);
    } catch (error) {
      console.error("Failed to copy agent text:", error);
      message.error(failedText);
    }
  }, []);

  const togglePopover = useCallback((id: AiAgentId, triggerEl?: HTMLElement | null) => {
    if (editingId === id) {
      setEditingId(null);
      return;
    }
    triggerElRef.current = triggerEl ?? null;
    setShowCommand(false);
    setEditingId(id);
  }, [editingId]);

  const checkedAt = agents[0]?.checkedAt;
  const checkedAtText = checkedAt
    ? t("settings.agents.checkedAt", {
        time: new Intl.DateTimeFormat(i18n.resolvedLanguage, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }).format(checkedAt),
      })
    : null;

  const selectorEntries = useMemo(
    () => (agents.length > 0
      ? agents.map((agent) => ({ id: agent.id, installed: agent.installed }))
      : AI_AGENT_ORDER.map((id) => ({ id, installed: true }))),
    [agents],
  );

  const installedCount = installedIds.length;

  return (
    <div className="app-settings-page app-agent-page">
      <SettingsPageHeader
        title={(
          <span className="inline-flex flex-wrap items-baseline gap-2.5">
            <span>{t("settings.agents.title")}</span>
            {checkedAtText ? (
              <span className="text-xs font-normal tracking-normal tabular-nums text-[var(--cs-text-tertiary)]">
                {checkedAtText}
              </span>
            ) : null}
          </span>
        )}
        description={quotaRefreshFailed ? (
          <span className="text-[var(--cs-warning)]">{t("settings.agents.quota.refreshFailed")}</span>
        ) : undefined}
        actions={(
          <Button
            icon={<ReloadOutlined />}
            loading={loading || quotaLoading || versionLoading}
            onClick={() => void refresh(true)}
          >
            {t("settings.agents.refresh")}
          </Button>
        )}
      />

      <section className="app-ledger-prefs app-agent-prefs" aria-label={t("settings.agents.defaultTitle")}>
        <div className="app-ledger-pref-item">
          <span className="app-ledger-pref-label" id="app-agent-default-label">
            {t("settings.agents.defaultTitle")}
          </span>
          <Select
            className="app-agent-default-select"
            aria-labelledby="app-agent-default-label"
            aria-label={t("settings.agents.defaultTitle")}
            value={defaultAgentId}
            popupMatchSelectWidth={false}
            virtual={false}
            listHeight={360}
            onChange={(value) => selectDefaultById(value as AiAgentId)}
            options={selectorEntries.map((entry) => {
              const name = AGENT_DEFINITIONS[entry.id].displayName;
              return {
                value: entry.id,
                disabled: agents.length > 0 && !entry.installed,
                label: (
                  <span className={`app-agent-option ${!entry.installed ? "is-uninstalled" : ""}`}>
                    <AgentIcon agentId={entry.id} size={16} />
                    <span className="app-agent-option-name">{name}</span>
                    {!entry.installed && (
                      <span className="app-agent-option-tag">{t("settings.agents.notInstalled")}</span>
                    )}
                  </span>
                ),
              };
            })}
          />
        </div>

        <span className="app-ledger-pref-sep" aria-hidden="true" />

        <div className="app-ledger-pref-item">
          <span className="app-ledger-pref-label">{t("settings.agents.permissions.globalLabel")}</span>
          <div className="app-agent-segment" role="group" aria-label={t("settings.agents.permissions.groupAria")}>
            <button
              type="button"
              aria-pressed={globalPreset === "manual"}
              onClick={() => setAllDefaults(applyGlobalPermissionPreset(permissionDefaults, "manual"))}
            >
              {t("settings.agents.permissions.manual")}
            </button>
            <button
              type="button"
              aria-pressed={globalPreset === "yolo"}
              onClick={() => setAllDefaults(applyGlobalPermissionPreset(permissionDefaults, "yolo"))}
            >
              {t("settings.agents.permissions.yolo")}
            </button>
          </div>
          {globalPreset === "custom" && (
            <span className="app-agent-custom-tag">{t("settings.agents.permissions.custom")}</span>
          )}
        </div>
      </section>

      {loading && agents.length === 0 ? (
        <div className="flex min-h-64 items-center justify-center">
          <Spin />
        </div>
      ) : (
        <div className="app-agent-ledger" role="region" aria-label={t("settings.agents.title")}>
          <div className="app-agent-ledger-head" aria-hidden="true">
            <span>{t("settings.agents.columns.tool")}</span>
            <span>{t("settings.agents.columns.version")}</span>
            <span>{t("settings.agents.details.quota")}</span>
            <span>{t("settings.agents.columns.actions")}</span>
          </div>

          <div>
            {agents.map((agent) => {
              const definition = AGENT_DEFINITIONS[agent.id];
              const isDefault = defaultAgentId === agent.id;
              const configurable = agent.installed && CONFIGURABLE_AGENTS.includes(agent.id);
              const isOpen = editingId === agent.id;
              const versionInfo = getAgentVersionPresentation(agent, definition.displayName, versionChecks[agent.id]);
              const agentQuota = quotaForAgent(agent.id, quotas);
              const quotaInfo = getAgentQuotaPresentation(agent, agentQuota, quotaLoading, t);
              const launchCommand = getAgentCommandPreview(agent.id, getDefaultAgentLaunchOptions(agent.id, permissionDefaults));

              const versionTitle = versionInfo.status === "checking"
                ? t("settings.agents.updates.checking")
                : versionInfo.status === "error"
                  ? t("settings.agents.updates.failed")
                  : versionInfo.latestVersion
                    ? t(`settings.agents.updates.${versionInfo.status}`, { version: versionInfo.latestVersion })
                    : (agent.version ?? t("settings.agents.unknown"));

              return (
                <div
                  key={agent.id}
                  ref={(node) => {
                    if (node) rowRefs.current.set(agent.id, node);
                    else rowRefs.current.delete(agent.id);
                  }}
                  className={`app-agent-row ${isOpen ? "is-active" : ""} ${!agent.installed ? "is-uninstalled" : ""}`}
                >
                  <div className="app-agent-cell-id">
                    <AgentIcon agentId={agent.id} size={20} />
                    <button
                      type="button"
                      data-agent-trigger="true"
                      className="app-agent-name-btn"
                      title={definition.displayName}
                      aria-expanded={isOpen}
                      aria-controls={`app-agent-popover-${agent.id}`}
                      onClick={(event) => togglePopover(agent.id, event.currentTarget)}
                    >
                      {definition.displayName}
                    </button>
                    {isDefault && (
                      <span className="app-ledger-default-pill">
                        <CheckOutlined />
                        {t("settings.agents.defaultBadge")}
                      </span>
                    )}
                  </div>

                  <div className="app-agent-cell-ver">
                    {agent.installed ? (
                      <>
                        <span
                          className={`app-agent-ver-num ${!versionInfo.shortVersion ? "is-muted" : ""}`}
                          title={versionTitle}
                        >
                          {versionInfo.shortVersion ?? t("settings.agents.unknown")}
                        </span>
                        {versionInfo.updatable && versionInfo.latestVersion && (
                          <span
                            className="app-agent-update-badge"
                            title={t("settings.agents.updates.updateAvailable", {
                              version: versionInfo.latestVersion,
                            })}
                            aria-label={t("settings.agents.updates.updateAvailable", {
                              version: versionInfo.latestVersion,
                            })}
                          >
                            <ArrowUpOutlined />
                            <span>{versionInfo.latestVersion}</span>
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="app-agent-ver-missing">{t("settings.agents.notInstalled")}</span>
                        {versionInfo.latestVersion && (
                          <span
                            className="app-agent-ver-state"
                            title={t("settings.agents.updates.unknown", { version: versionInfo.latestVersion })}
                          >
                            {versionInfo.latestVersion}
                          </span>
                        )}
                      </>
                    )}
                  </div>

                  <div className="app-agent-cell-quota">
                    {quotaInfo.rings.length > 0 ? (
                      <Popover
                        trigger={["click"]}
                        placement="bottomLeft"
                        arrow={false}
                        styles={{ container: { padding: 0, background: "transparent", boxShadow: "none", border: 0 } }}
                        getPopupContainer={() => document.body}
                        content={(
                          <AgentQuotaCard
                            agentId={agent.id}
                            quota={agentQuota}
                            loading={quotaLoading}
                            onRefresh={() => void loadQuotas(agents, true)}
                          />
                        )}
                      >
                        <button
                          type="button"
                          className="app-agent-quota-trigger"
                          aria-label={`${definition.displayName} · ${quotaInfo.summaryText}`}
                        >
                          <div className="app-agent-quota-rings">
                            {quotaInfo.rings.map((ring) => (
                              <QuotaUsageRing
                                key={ring.key}
                                label={ring.label}
                                descriptionLabel={ring.descriptionLabel}
                                remaining={ring.remaining}
                              />
                            ))}
                          </div>
                        </button>
                      </Popover>
                    ) : (
                      <span
                        className="app-agent-quota-muted"
                        title={quotaInfo.summaryText}
                        aria-label={quotaInfo.summaryText}
                      >
                        <span aria-hidden="true">—</span>
                      </span>
                    )}
                  </div>

                  <div className="app-agent-cell-actions">
                    {!agent.installed ? (
                      <button
                        ref={(node) => {
                          if (node) actionButtonRefs.current.set(agent.id, node);
                          else actionButtonRefs.current.delete(agent.id);
                        }}
                        type="button"
                        data-agent-trigger="true"
                        className={`app-agent-action-primary ${isOpen ? "is-open" : ""}`}
                        aria-label={`${t("settings.agents.actions.install")} ${definition.displayName}`}
                        aria-expanded={isOpen}
                        aria-controls={`app-agent-popover-${agent.id}`}
                        onClick={(event) => togglePopover(agent.id, event.currentTarget)}
                      >
                        {t("settings.agents.actions.install")}
                      </button>
                    ) : (
                      <button
                        ref={(node) => {
                          if (node) actionButtonRefs.current.set(agent.id, node);
                          else actionButtonRefs.current.delete(agent.id);
                        }}
                        type="button"
                        data-agent-trigger="true"
                        className={`app-agent-action-config ${isOpen ? "is-open" : ""}`}
                        aria-label={`${t(configurable ? "settings.agents.actions.configure" : "settings.agents.actions.commands")} ${definition.displayName}`}
                        aria-expanded={isOpen}
                        aria-controls={`app-agent-popover-${agent.id}`}
                        onClick={(event) => togglePopover(agent.id, event.currentTarget)}
                      >
                        {configurable ? <SettingOutlined /> : <CodeOutlined />}
                        <span>{t(configurable ? "settings.agents.actions.configure" : "settings.agents.actions.commands")}</span>
                      </button>
                    )}
                  </div>

                  <LedgerRowPopover
                    open={isOpen}
                    id={`app-agent-popover-${agent.id}`}
                    ariaLabel={t("settings.agents.popover.ariaLabel", { name: definition.displayName })}
                    className="app-ledger-popover app-agent-popover"
                    popoverSelector=".app-agent-popover"
                    triggerSelector="[data-agent-trigger]"
                    getAnchorEl={() => rowRefs.current.get(agent.id) ?? null}
                    getRestoreFocusEl={() => triggerElRef.current ?? actionButtonRefs.current.get(agent.id) ?? null}
                    maxWidth={468}
                    onClose={() => setEditingId(null)}
                  >
                      <header className="app-agent-popover-head">
                        <div className="app-agent-popover-title">
                          <AgentIcon agentId={agent.id} size={20} />
                          <div>
                            <strong>{definition.displayName}</strong>
                            <span>
                              {agent.installed
                                ? `${versionInfo.shortVersion ?? t("settings.agents.unknown")} · ${t(configurable ? "settings.agents.popover.configSubtitle" : "settings.agents.popover.cliSubtitle")}`
                                : versionInfo.latestVersion
                                  ? t("settings.agents.popover.uninstalledLatestSubtitle", { version: versionInfo.latestVersion })
                                  : t("settings.agents.popover.uninstalledSubtitle")}
                            </span>
                          </div>
                        </div>
                        <div className="app-agent-popover-head-actions">
                          {agent.installed && (
                            <button
                              type="button"
                              className="app-ledger-default-toggle"
                              disabled={isDefault}
                              onClick={() => selectDefaultById(agent.id)}
                            >
                              {t(isDefault ? "settings.agents.actions.currentDefaultShort" : "settings.agents.actions.setDefaultShort")}
                            </button>
                          )}
                          <button
                            type="button"
                            className="app-ledger-close-btn"
                            aria-label={t("common.close")}
                            onClick={() => setEditingId(null)}
                          >
                            <CloseOutlined />
                          </button>
                        </div>
                      </header>

                      <div className="app-agent-popover-facts">
                        <div className="app-agent-popover-fact">
                          <span>{t("settings.agents.popover.pathLabel")}</span>
                          <div className="app-agent-popover-path-row">
                            <code title={agent.executablePath ?? t("settings.agents.notFoundInPath")}>
                              {agent.executablePath ?? t("settings.agents.notFoundInPath")}
                            </code>
                            {agent.executablePath && (
                              <button
                                type="button"
                                className="app-agent-icon-copy"
                                aria-label={t("settings.agents.details.copyPath")}
                                title={t("settings.agents.details.copyPath")}
                                onClick={() => void copyText(
                                  agent.executablePath!,
                                  t("settings.agents.details.pathCopied"),
                                  t("settings.agents.details.pathCopyFailed"),
                                )}
                              >
                                <CopyOutlined />
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="app-agent-popover-fact">
                          <span>{t("settings.agents.popover.quotaLabel")}</span>
                          <span className="app-agent-popover-fact-val">
                            <span className="truncate" title={quotaInfo.summaryText}>{quotaInfo.summaryText}</span>
                            {versionInfo.updatable && versionInfo.latestVersion && (
                              <span className="app-agent-pop-update">
                                {t("settings.agents.updates.updateAvailable", { version: versionInfo.latestVersion })}
                              </span>
                            )}
                          </span>
                        </div>
                        {agent.error && (
                          <div className="app-agent-popover-fact">
                            <span>{t("settings.agents.versionError")}</span>
                            <span className="text-xs break-words text-[var(--cs-danger)]">{agent.error}</span>
                          </div>
                        )}
                      </div>

                      {agent.installed ? (
                        <div className="app-agent-popover-body">
                          <PopoverLaunchConfig agentId={agent.id} />
                          {agent.id === "codex" && (
                            <div className="app-agent-hook-wrap">
                              <CodexHookStatus />
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="app-agent-install-commands">
                          {definition.installCommands.map((item) => (
                            <div className="app-agent-cmd-drawer" key={item.shell}>
                              <div>
                                <span className="app-agent-cmd-label">
                                  {t("settings.agents.popover.installCommandLabel", { shell: item.shell })}
                                </span>
                                <code>{item.command}</code>
                              </div>
                              <button
                                type="button"
                                onClick={() => void copyText(
                                  item.command,
                                  t("settings.agents.installCommandCopied", {
                                    name: definition.displayName,
                                    shell: item.shell,
                                  }),
                                  t("settings.agents.installCommandCopyFailed"),
                                )}
                              >
                                <CopyOutlined /> {t("common.copy")}
                              </button>
                            </div>
                          ))}
                          <p className="app-agent-muted-note">{t("settings.agents.details.commandHint")}</p>
                        </div>
                      )}

                      {agent.installed && (
                        <footer className="app-agent-popover-foot">
                          <button
                            type="button"
                            className="app-agent-cmd-toggle"
                            aria-expanded={showCommand}
                            onClick={() => setShowCommand((value) => !value)}
                          >
                            <CodeOutlined />
                            <span>
                              {t(showCommand ? "settings.agents.popover.hideCommands" : "settings.agents.popover.showCommands")}
                            </span>
                          </button>
                        </footer>
                      )}

                      {agent.installed && showCommand && (
                        <div className="app-agent-cmd-stack">
                          <div className="app-agent-cmd-drawer">
                            <div>
                              <span className="app-agent-cmd-label">{t("settings.agents.popover.launchCommandLabel")}</span>
                              <code>{launchCommand}</code>
                            </div>
                            <button
                              type="button"
                              onClick={() => void copyText(
                                launchCommand,
                                t("settings.agents.launchCommandCopied"),
                                t("settings.agents.installCommandCopyFailed"),
                              )}
                            >
                              <CopyOutlined /> {t("common.copy")}
                            </button>
                          </div>
                          {definition.installCommands.map((item) => (
                            <div className="app-agent-cmd-drawer" key={item.shell}>
                              <div>
                                <span className="app-agent-cmd-label">
                                  {t("settings.agents.popover.installCommandLabel", { shell: item.shell })}
                                </span>
                                <code>{item.command}</code>
                              </div>
                              <button
                                type="button"
                                onClick={() => void copyText(
                                  item.command,
                                  t("settings.agents.installCommandCopied", {
                                    name: definition.displayName,
                                    shell: item.shell,
                                  }),
                                  t("settings.agents.installCommandCopyFailed"),
                                )}
                              >
                                <CopyOutlined /> {t("common.copy")}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                  </LedgerRowPopover>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {agents.length > 0 && (
        <p className="app-ledger-footnote">
          {t("settings.agents.summary", { installed: installedCount, total: agents.length })} · {t("settings.agents.pathHint")}
        </p>
      )}
    </div>
  );
}

function PopoverLaunchConfig({ agentId }: { agentId: AiAgentId }) {
  const { t } = useTranslation();
  const choiceLabel = useLaunchChoiceLabel();
  const defaults = useAppStore((state) => state.agentPermissionDefaults);
  const save = useAppStore((state) => state.setAgentPermissionDefaults);
  const options = getDefaultAgentLaunchOptions(agentId, defaults);

  if (!options) {
    return <p className="app-agent-muted-note">{t("settings.agents.popover.cliOnlyNote")}</p>;
  }

  const update = (patch: Partial<SessionLaunchOptions>) => {
    save(agentId, { ...options, ...patch } as SessionLaunchOptions);
  };

  if (agentId === "claude") {
    const claudeOptions = options as { skipPermissions: boolean; effort?: string };
    return (
      <div className="app-agent-launch-config">
        <label className="app-agent-launch-row">
          <span>{t("newSession.skipPermissions")}</span>
          <Switch
            size="small"
            checked={claudeOptions.skipPermissions}
            onChange={(value) => update({ skipPermissions: value })}
          />
        </label>
        <label className="app-agent-launch-row">
          <span>{t("newSession.effort")}</span>
          <Select
            size="small"
            value={claudeOptions.effort ?? "inherit"}
            options={TASK_CHOICES.claude.map((value) => ({ value, label: choiceLabel("claude", value) }))}
            onChange={(value) => update({ effort: value as "inherit" | "low" | "medium" | "high" | "xhigh" | "max" })}
          />
        </label>
      </div>
    );
  }

  if (agentId === "codex") {
    const codexOptions = options as {
      yolo: boolean;
      approvalMode?: "on-request" | "never";
      sandboxMode?: "workspace-write" | "read-only";
      effort?: string;
    };
    return (
      <div className="app-agent-launch-config">
        <label className="app-agent-launch-row">
          <span>{t("newSession.codexYolo")}</span>
          <Switch
            size="small"
            checked={codexOptions.yolo}
            onChange={(value) => update({ yolo: value })}
          />
        </label>
        <label className="app-agent-launch-row">
          <span>{t("newSession.approvalMode")}</span>
          <Select
            size="small"
            disabled={codexOptions.yolo}
            value={codexOptions.approvalMode ?? "on-request"}
            options={[
              { value: "on-request", label: t("newSession.codexApprovalOnRequest") },
              { value: "never", label: t("newSession.codexApprovalNever") },
            ]}
            onChange={(value) => update({ approvalMode: value })}
          />
        </label>
        <label className="app-agent-launch-row">
          <span>{t("newSession.sandboxMode")}</span>
          <Select
            size="small"
            disabled={codexOptions.yolo}
            value={codexOptions.sandboxMode ?? "workspace-write"}
            options={[
              { value: "workspace-write", label: t("newSession.workspaceWrite") },
              { value: "read-only", label: t("newSession.readOnly") },
            ]}
            onChange={(value) => update({ sandboxMode: value })}
          />
        </label>
        {codexOptions.yolo && (
          <p className="app-agent-muted-note">{t("settings.agents.popover.codexYoloNote")}</p>
        )}
        <label className="app-agent-launch-row">
          <span>{t("newSession.effort")}</span>
          <Select
            size="small"
            value={codexOptions.effort ?? "inherit"}
            options={TASK_CHOICES.codex.map((value) => ({ value, label: choiceLabel("codex", value) }))}
            onChange={(value) => update({ effort: value as "inherit" | "low" | "medium" | "high" })}
          />
        </label>
      </div>
    );
  }

  if (agentId === "antigravity") {
    const antigravityOptions = options as {
      dangerouslySkipPermissions: boolean;
      sandbox: boolean;
      mode?: "inherit" | "accept-edits" | "plan";
    };
    return (
      <div className="app-agent-launch-config">
        <label className="app-agent-launch-row">
          <span>{t("newSession.antigravitySkipPermissions")}</span>
          <Switch
            size="small"
            checked={antigravityOptions.dangerouslySkipPermissions}
            onChange={(value) => update({ dangerouslySkipPermissions: value })}
          />
        </label>
        <label className="app-agent-launch-row">
          <span>{t("newSession.antigravitySandbox")}</span>
          <Switch
            size="small"
            checked={antigravityOptions.sandbox}
            onChange={(value) => update({ sandbox: value })}
          />
        </label>
        <label className="app-agent-launch-row">
          <span>{t("newSession.antigravityMode")}</span>
          <Select
            size="small"
            value={antigravityOptions.mode ?? "inherit"}
            options={TASK_CHOICES.antigravity.map((value) => ({ value, label: choiceLabel("antigravity", value) }))}
            onChange={(value) => update({ mode: value })}
          />
        </label>
      </div>
    );
  }

  const qoderOptions = options as {
    permissionMode?: "inherit" | "default" | "accept_edits" | "plan" | "auto" | "dont_ask" | "bypass_permissions";
  };
  return (
    <div className="app-agent-launch-config">
      <label className="app-agent-launch-row">
        <span>{t("newSession.qoderPermissionMode")}</span>
        <Select
          size="small"
          value={qoderOptions.permissionMode ?? "inherit"}
          options={TASK_CHOICES.qoder.map((value) => ({ value, label: choiceLabel("qoder", value) }))}
          onChange={(value) => update({ permissionMode: value })}
        />
      </label>
    </div>
  );
}

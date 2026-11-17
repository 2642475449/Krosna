import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Input, Select, Spin, Tooltip, message } from "antd";
import {
  CloseOutlined,
  CloudServerOutlined,
  CodeOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { AgentIcon } from "@/components/AgentIcon";
import { TabSelectionIndicator } from "@/components/ui/TabSelectionIndicator";
import { openExternalUrl } from "@/lib/api";
import {
  isRemoteConnectionBusy,
  isSameRemoteTab,
  REMOTE_AGENT_SETUP,
  remoteErrorText,
  remoteTabKey,
  type RemoteAgentId,
  type RemoteHost,
} from "@/lib/remote";
import {
  connectRemoteWorkspace,
  disconnectRemoteWorkspace,
  refreshRemoteHosts,
  refreshRemoteRuntime,
  removeRemoteHost,
  sendRemoteAuthentication,
  startRemoteSession,
  useRemoteWorkspaceStore,
} from "@/store/slices/remoteWorkspace";
import { RemoteAuthenticationTerminal, RemoteTerminal } from "./RemoteTerminal";
import { RemoteErrorMessage } from "./RemoteWorkspaceModals";

const OVERVIEW_TAB_ID = "__overview__";

/** 远程工作台主工作区：顶部多标签终端栏 + 主机概览/认证/会话终端舞台。 */
export function RemoteWorkbenchMain({ visible }: { visible: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const hosts = useRemoteWorkspaceStore((state) => state.hosts);
  const selectedHostId = useRemoteWorkspaceStore((state) => state.selectedHostId);
  const connections = useRemoteWorkspaceStore((state) => state.connections);
  const inspections = useRemoteWorkspaceStore((state) => state.inspections);
  const sessionsByHost = useRemoteWorkspaceStore((state) => state.sessionsByHost);
  const openTabs = useRemoteWorkspaceStore((state) => state.openTabs);
  const activeTab = useRemoteWorkspaceStore((state) => state.activeTab);
  const errors = useRemoteWorkspaceStore((state) => state.errors);
  const pending = useRemoteWorkspaceStore((state) => state.pendingActions);
  const reconnectAttempts = useRemoteWorkspaceStore((state) => state.reconnectAttempts);
  const [authInputValue, setAuthInputValue] = useState("");
  const [sendingAuth, setSendingAuth] = useState(false);

  const cwd = useRemoteWorkspaceStore((state) => state.cwd);
  const agentId = useRemoteWorkspaceStore((state) => state.agentId);

  const host = hosts.find((item) => item.id === selectedHostId) ?? null;
  const connection = host ? connections[host.id] : undefined;

  useEffect(() => {
    setAuthInputValue("");
  }, [host?.id, connection?.state]);
  const inspection = host ? inspections[host.id] : undefined;
  const sessions = host ? sessionsByHost[host.id] ?? [] : [];
  const connected = connection?.state === "connected";
  const busy = isRemoteConnectionBusy(connection);
  const reconnecting = host ? (reconnectAttempts[host.id] ?? 0) > 0 : false;
  const error = (host && errors[host.id]) || connection?.error || errors.global;
  const chosenAgent = inspection?.agents.find((agent) => agent.id === agentId);

  const distinctOpenHostCount = useMemo(
    () => new Set(openTabs.map((item) => item.hostId)).size,
    [openTabs],
  );

  const activeTabKey = activeTab
    ? remoteTabKey(activeTab.hostId, activeTab.sessionId)
    : OVERVIEW_TAB_ID;
  const allTabKeys = useMemo(
    () => [OVERVIEW_TAB_ID, ...openTabs.map((tab) => remoteTabKey(tab.hostId, tab.sessionId))],
    [openTabs],
  );

  const connectionLabel = (hostId: string) => {
    const attempt = reconnectAttempts[hostId] ?? 0;
    const state = connections[hostId]?.state ?? "disconnected";
    if (attempt > 0 && !isRemoteConnectionBusy(connections[hostId]) && state !== "connected") {
      return t("remote.connection.reconnecting", { attempt });
    }
    return t(`remote.connection.${state}`);
  };

  const runOperation = async (operation: () => Promise<unknown>, hostId = host?.id ?? "global") => {
    useRemoteWorkspaceStore.getState().setError(hostId, null);
    try {
      await operation();
    } catch (failure) {
      useRemoteWorkspaceStore.getState().setError(hostId, remoteErrorText(failure));
    }
  };

  const editHost = (value: RemoteHost | null) => {
    useRemoteWorkspaceStore.getState().setError("editor", null);
    useRemoteWorkspaceStore.getState().setHostEditor(value);
  };

  const openGuide = (agent: "codex" | "claude") => runOperation(() => openExternalUrl(REMOTE_AGENT_SETUP[agent].url));

  const copySetup = (agent: "codex" | "claude", command: "install" | "login") =>
    runOperation(async () => {
      await navigator.clipboard.writeText(REMOTE_AGENT_SETUP[agent][command]);
      message.success(t("remote.environment.commandCopied"));
    });

  const handleTabBarNew = () => {
    const hasConnected = hosts.some((item) => connections[item.id]?.state === "connected");
    if (hasConnected) {
      useRemoteWorkspaceStore.getState().setNewSessionModalOpen(true);
      return;
    }
    useRemoteWorkspaceStore.getState().openHostOverview(host?.id);
    if (!host) editHost(null);
  };

  const handleSendAuthReply = async () => {
    if (!host || connection?.state !== "authenticating" || sendingAuth) return;
    const payload = authInputValue;
    setSendingAuth(true);
    try {
      await runOperation(() => sendRemoteAuthentication(host.id, `${payload}\r`), host.id);
      setAuthInputValue("");
    } finally {
      setSendingAuth(false);
    }
  };

  return (
    <div className="app-main-stage flex min-h-0 flex-1 flex-col">
      <div className="app-shell-chrome app-glass-tabbar app-tabbar flex items-end shrink-0">
        <div className="flex min-w-0 flex-1 items-end">
          <div ref={tabListRef} className="app-tabbar-tabs" role="tablist" aria-label={t("remote.title")}>
            <TabSelectionIndicator
              listRef={tabListRef}
              tabRefs={tabRefs}
              activeTabId={activeTabKey}
              tabIds={allTabKeys}
            />
            <div
              ref={(element) => {
                tabRefs.current[OVERVIEW_TAB_ID] = element;
              }}
              className="app-tabbar-tab app-remote-overview-tab relative"
            >
              <div
                role="tab"
                tabIndex={0}
                aria-selected={activeTab === null}
                data-active={activeTab === null ? "true" : "false"}
                className={`tab-item app-tab-chrome app-marker-host app-glass-tab ${activeTab === null ? "app-glass-tab-active" : ""} flex items-center gap-1.5 px-3 cursor-pointer`}
                onClick={() => useRemoteWorkspaceStore.getState().openHostOverview()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    useRemoteWorkspaceStore.getState().openHostOverview();
                  }
                }}
              >
                <CloudServerOutlined className="text-[13px] shrink-0" />
                <span className="app-tabbar-title text-xs">
                  {host ? host.name : t("remote.overview")}
                </span>
              </div>
            </div>

            {openTabs.map((tab) => {
              const key = remoteTabKey(tab.hostId, tab.sessionId);
              const tabHost = hosts.find((item) => item.id === tab.hostId);
              const tabSession = (sessionsByHost[tab.hostId] ?? []).find((item) => item.id === tab.sessionId);
              const tabConnected = connections[tab.hostId]?.state === "connected";
              const isTabActive = isSameRemoteTab(activeTab, tab);
              const baseTitle = tabSession?.title
                || (tabSession?.agentId === "shell"
                  ? t("remote.sessions.shell")
                  : tabSession?.agentId === "codex"
                    ? "Codex"
                    : tabSession?.agentId === "claude"
                      ? "Claude Code"
                      : tab.sessionId);
              const title = distinctOpenHostCount > 1 && tabHost
                ? `${tabHost.name} · ${baseTitle}`
                : baseTitle;

              return (
                <div
                  key={key}
                  ref={(element) => {
                    tabRefs.current[key] = element;
                  }}
                  className="app-tabbar-tab relative"
                >
                  <div
                    role="tab"
                    tabIndex={0}
                    aria-selected={isTabActive}
                    data-active={isTabActive ? "true" : "false"}
                    className={`tab-item app-tab-chrome app-marker-host app-glass-tab ${isTabActive ? "app-glass-tab-active" : ""} flex items-center gap-1.5 px-3 cursor-pointer`}
                    onClick={() => useRemoteWorkspaceStore.getState().openRemoteTab(tab.hostId, tab.sessionId)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        useRemoteWorkspaceStore.getState().openRemoteTab(tab.hostId, tab.sessionId);
                      }
                    }}
                  >
                    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
                      {!tabSession || tabSession.agentId === "shell" ? (
                        <CodeOutlined className="text-[13px]" />
                      ) : (
                        <AgentIcon agentId={tabSession.agentId} size={14} />
                      )}
                    </span>
                    <Tooltip title={tabSession ? `${title} · ${tabSession.cwd}` : title} mouseEnterDelay={0.5}>
                      <span className="app-tabbar-title text-xs">{title}</span>
                    </Tooltip>
                    <span className="app-tabbar-action">
                      <span className="app-tabbar-action-status">
                        <span
                          className="app-remote-tab-dot"
                          data-state={!tabConnected ? "disconnected" : (tabSession?.taskState ?? "unknown")}
                        />
                      </span>
                      <Tooltip title={t("remote.sessions.closeTabHint")} mouseEnterDelay={0.5}>
                        <button
                          type="button"
                          aria-label={t("common.close")}
                          className="tab-close-btn flex h-5 w-5 items-center justify-center rounded-sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            useRemoteWorkspaceStore.getState().closeRemoteTab(tab.hostId, tab.sessionId);
                          }}
                        >
                          <CloseOutlined className="text-[10px]" />
                        </button>
                      </Tooltip>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex shrink-0 items-center self-center px-1.5">
            <Tooltip title={t("remote.sessions.newTitle")} mouseEnterDelay={0.4}>
              <button
                type="button"
                className="app-tabbar-new-button"
                aria-label={t("remote.sessions.newTitle")}
                onClick={handleTabBarNew}
              >
                <PlusOutlined className="text-xs" />
              </button>
            </Tooltip>
          </div>
        </div>

        {host && (
          <div className="app-remote-tabbar-meta">
            <span className="app-remote-state" data-state={connection?.state ?? "disconnected"}>
              {connectionLabel(host.id)}
            </span>
            {connected && (
              <Tooltip title={t("remote.environment.openShell")} mouseEnterDelay={0.4}>
                <Button
                  size="small"
                  type="text"
                  icon={<CodeOutlined />}
                  loading={!!pending[`${host.id}:launch`]}
                  onClick={() => void runOperation(() => startRemoteSession(host.id, "shell"))}
                >
                  {t("remote.sessions.shell")}
                </Button>
              </Tooltip>
            )}
            {connected || busy || reconnecting ? (
              <Button
                size="small"
                onClick={() => void runOperation(() => disconnectRemoteWorkspace(host.id))}
              >
                {t(busy ? "remote.cancelConnection" : reconnecting ? "remote.cancelReconnect" : "remote.disconnect")}
              </Button>
            ) : (
              <Button
                size="small"
                type="primary"
                disabled={!!pending[`${host.id}:disconnect`]}
                loading={!!pending[`${host.id}:connect`]}
                onClick={() => void runOperation(() => connectRemoteWorkspace(host.id))}
              >
                {t("remote.connect")}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="app-main-stage-body relative min-h-0 flex-1">
        <div
          className="app-workspace-tab-content"
          data-active={activeTab === null ? "true" : "false"}
        >
          <div className="app-remote-overview-scroll">
            {!host ? (
              <div className="app-remote-welcome">
                <CloudServerOutlined />
                <h1>{t("remote.welcome.title")}</h1>
                <p>{t("remote.welcome.description")}</p>
                {errors.global && (
                  <div className="app-remote-error" role="alert">
                    <RemoteErrorMessage error={errors.global} />
                    <Button type="link" onClick={() => void runOperation(refreshRemoteHosts, "global")}>
                      {t("remote.refresh")}
                    </Button>
                  </div>
                )}
                <Button type="primary" icon={<PlusOutlined />} onClick={() => editHost(null)}>
                  {t("remote.host.add")}
                </Button>
              </div>
            ) : (
              <div className="app-remote-overview-body">
                <header className="app-remote-connection-header">
                  <div className="app-remote-connection-header__identity">
                    <h1>{host.name}</h1>
                    <span className="app-remote-monospace">
                      {host.target}{host.port ? `:${host.port}` : ""}
                    </span>
                    {host.sshConfigFile && (
                      <span className="app-remote-inline-tag" title={host.sshConfigFile}>
                        {t("remote.host.configSource")}
                      </span>
                    )}
                    <span className="app-remote-state" data-state={connection?.state ?? "disconnected"}>
                      {connectionLabel(host.id)}
                    </span>
                  </div>
                  <div className="app-remote-actions">
                    <Button
                      size="small"
                      type="text"
                      icon={<EditOutlined />}
                      disabled={!!host.sshConfigFile || connected || busy || reconnecting}
                      title={host.sshConfigFile ? t("remote.host.configManaged") : undefined}
                      aria-label={t("remote.host.edit")}
                      onClick={() => editHost(host)}
                    />
                    <Button
                      size="small"
                      type="text"
                      icon={<DeleteOutlined />}
                      disabled={!!host.sshConfigFile || connected || busy || reconnecting || !!pending[`${host.id}:delete`]}
                      title={host.sshConfigFile ? t("remote.host.configManaged") : undefined}
                      aria-label={t("remote.host.remove")}
                      onClick={() => void runOperation(() => removeRemoteHost(host.id))}
                    />
                    {connected || busy || reconnecting ? (
                      <Button size="small" onClick={() => void runOperation(() => disconnectRemoteWorkspace(host.id))}>
                        {t(busy ? "remote.cancelConnection" : reconnecting ? "remote.cancelReconnect" : "remote.disconnect")}
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        type="primary"
                        disabled={!!pending[`${host.id}:disconnect`]}
                        loading={!!pending[`${host.id}:connect`]}
                        onClick={() => void runOperation(() => connectRemoteWorkspace(host.id))}
                      >
                        {t("remote.connect")}
                      </Button>
                    )}
                  </div>
                </header>

                {error && (
                  <div role="alert" className="app-remote-error">
                    <RemoteErrorMessage error={error} />
                  </div>
                )}

                {(busy || (connection?.state === "error" && connection.authOutput)) && (
                  <section className="app-remote-card" aria-label={t("remote.authentication.title")}>
                    <div className="app-remote-section-heading">
                      <h2>{t("remote.authentication.title")}</h2>
                      {busy && <Spin size="small" />}
                    </div>
                    <p className="app-remote-muted">{t("remote.authentication.help")}</p>
                    <RemoteAuthenticationTerminal hostId={host.id} active={visible && activeTab === null} />
                    {connection?.state === "authenticating" && (
                      <div className="app-remote-auth-reply">
                        <Input.Password
                          value={authInputValue}
                          placeholder={t("remote.authentication.quickInputPlaceholder")}
                          disabled={sendingAuth}
                          onChange={(event) => setAuthInputValue(event.target.value)}
                          onPressEnter={() => void handleSendAuthReply()}
                        />
                        <Button
                          type="primary"
                          loading={sendingAuth}
                          onClick={() => void handleSendAuthReply()}
                        >
                          {t("remote.authentication.send")}
                        </Button>
                      </div>
                    )}
                    <p className="app-remote-field-help">{t("remote.authentication.install")}</p>
                  </section>
                )}

                {connected && (
                  <section className="app-remote-card" aria-label={t("remote.sessions.newTitle")}>
                    <div className="app-remote-section-heading">
                      <h2>{t("remote.sessions.newTitle")}</h2>
                      <Button
                        size="small"
                        icon={<CodeOutlined />}
                        loading={!!pending[`${host.id}:launch`]}
                        onClick={() => void runOperation(() => startRemoteSession(host.id, "shell"))}
                      >
                        {t("remote.environment.openShell")}
                      </Button>
                    </div>
                    <div className="app-remote-launch">
                      <label className="app-remote-sr-only" htmlFor={`${id}-cwd`}>{t("remote.sessions.directory")}</label>
                      <Input
                        id={`${id}-cwd`}
                        value={cwd}
                        prefix={<CodeOutlined />}
                        aria-label={t("remote.sessions.directory")}
                        placeholder={t("remote.sessions.directoryPlaceholder")}
                        onChange={(event) => useRemoteWorkspaceStore.getState().setLaunchDirectory(event.target.value)}
                      />
                      <Select<RemoteAgentId>
                        value={agentId}
                        aria-label={t("remote.sessions.agent")}
                        onChange={(value) => useRemoteWorkspaceStore.getState().setLaunchAgent(value)}
                        options={[
                          { value: "codex", label: "Codex" },
                          { value: "claude", label: "Claude Code" },
                        ]}
                      />
                      <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        loading={!!pending[`${host.id}:launch`]}
                        disabled={!chosenAgent?.installed}
                        onClick={() => void runOperation(() => startRemoteSession(host.id))}
                      >
                        {t("remote.sessions.start")}
                      </Button>
                    </div>
                  </section>
                )}

                {connected && (
                  <section className="app-remote-card" aria-label={t("remote.environment.title")}>
                    <div className="app-remote-section-heading">
                      <h2>{t("remote.environment.title")}</h2>
                      <div className="app-remote-actions">
                        <span className="app-remote-muted" title={connection.server?.root}>
                          {t("remote.environment.serverVersion", {
                            version: connection.server?.version ?? inspection?.helperVersion ?? "—",
                          })}
                        </span>
                        <Button
                          size="small"
                          icon={<ReloadOutlined />}
                          onClick={() => void runOperation(() => refreshRemoteRuntime(host.id))}
                        >
                          {t("remote.refresh")}
                        </Button>
                        <Button
                          size="small"
                          type="text"
                          onClick={() => useRemoteWorkspaceStore.getState().setPendingServerAction({ hostId: host.id, action: "stop" })}
                        >
                          {t("remote.server.stop")}
                        </Button>
                        <Button
                          size="small"
                          type="text"
                          onClick={() => useRemoteWorkspaceStore.getState().setPendingServerAction({ hostId: host.id, action: "uninstall" })}
                        >
                          {t("remote.server.uninstall")}
                        </Button>
                      </div>
                    </div>
                    <p className="app-remote-muted">{t("remote.environment.intro")}</p>
                    {inspection ? (
                      <div className="app-remote-agent-list">
                        {inspection.agents.map((agent) => (
                          <div key={agent.id} className="app-remote-agent-setup">
                            <div className="app-remote-agent-row">
                              <span className="app-remote-agent-row__name">
                                <AgentIcon agentId={agent.id} size={18} />
                                {agent.id === "codex" ? "Codex" : "Claude Code"}
                              </span>
                              <span>{agent.installed ? agent.version || t("remote.environment.installed") : t("remote.environment.notInstalled")}</span>
                              <span className="app-remote-muted">{t(`remote.auth.${agent.authStatus}`)}</span>
                              <Button size="small" type="link" icon={<LinkOutlined />} onClick={() => void openGuide(agent.id)}>
                                {t("remote.environment.guide")}
                              </Button>
                            </div>
                            <div className="app-remote-agent-setup__actions">
                              {!agent.installed && (
                                <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => void copySetup(agent.id, "install")}>
                                  {t("remote.environment.copyInstall")}
                                </Button>
                              )}
                              <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => void copySetup(agent.id, "login")}>
                                {t("remote.environment.copyLogin")}
                              </Button>
                              <span className="app-remote-muted">{t(`remote.hook.${agent.hookStatus}`)}</span>
                            </div>
                            {agent.id === "codex" && agent.installed && agent.hookStatus === "pending" && (
                              <p className="app-remote-field-help">{t("remote.hook.codexPending")}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="app-remote-loading"><Spin size="small" /></div>
                    )}
                    {connection.server?.root && (
                      <p className="app-remote-install-root" title={connection.server.root}>
                        {connection.server.root}
                      </p>
                    )}
                  </section>
                )}

                {sessions.length > 0 && (
                  <section className="app-remote-card" aria-label={t("remote.sessions.title")}>
                    <div className="app-remote-section-heading">
                      <h2>{t("remote.sessions.title")}</h2>
                      <span className="app-remote-muted">{t("remote.sessions.reattachHint")}</span>
                    </div>
                    <div className="app-remote-overview-sessions">
                      {sessions.map((session) => {
                        const title = session.title
                          || (session.agentId === "shell"
                            ? t("remote.sessions.shell")
                            : session.agentId === "codex"
                              ? "Codex"
                              : "Claude Code");
                        return (
                          <button
                            key={session.id}
                            type="button"
                            className="app-remote-overview-session-item"
                            onClick={() => useRemoteWorkspaceStore.getState().openRemoteTab(host.id, session.id)}
                          >
                            {session.agentId === "shell" ? <CodeOutlined /> : <AgentIcon agentId={session.agentId} size={15} />}
                            <span className="app-remote-overview-session-item__title">{title}</span>
                            <span className="app-remote-monospace">{session.cwd}</span>
                            <span className="app-remote-muted">
                              {connected ? t(`remote.task.${session.taskState}`) : t("remote.task.disconnected")}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}

                <footer className="app-remote-status-footer">{t("remote.sessions.survive")}</footer>
              </div>
            )}
          </div>
        </div>

        {openTabs.map((tab) => {
          const key = remoteTabKey(tab.hostId, tab.sessionId);
          const isTabActive = isSameRemoteTab(activeTab, tab);
          const tabHost = hosts.find((item) => item.id === tab.hostId);
          const tabConnection = connections[tab.hostId];
          const tabConnected = tabConnection?.state === "connected";
          const tabBusy = isRemoteConnectionBusy(tabConnection);
          const tabSession = (sessionsByHost[tab.hostId] ?? []).find((item) => item.id === tab.sessionId);
          const tabError = errors[tab.hostId] || tabConnection?.error;

          return (
            <div
              key={key}
              className="app-workspace-tab-content"
              data-active={isTabActive ? "true" : "false"}
            >
              {tabSession ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="app-remote-session-toolbar">
                    {tabHost && <span className="app-remote-inline-tag">{tabHost.name}</span>}
                    <span className="app-remote-monospace" title={tabSession.cwd}>{tabSession.cwd}</span>
                    <span className="app-remote-muted">
                      {tabConnected ? t(`remote.task.${tabSession.taskState}`) : t("remote.task.disconnected")}
                    </span>
                    {!tabSession.hookObserved && tabSession.agentId !== "shell" && tabSession.processState === "running" && tabConnected && (
                      <span className="app-remote-muted">{t("remote.sessions.awaitingHook")}</span>
                    )}
                    <div className="app-remote-actions ml-auto">
                      {!tabConnected && !tabBusy && (
                        <Button
                          size="small"
                          type="primary"
                          onClick={() => void runOperation(() => connectRemoteWorkspace(tab.hostId), tab.hostId)}
                        >
                          {t("remote.connect")}
                        </Button>
                      )}
                      {tabSession.processState === "exited" ? (
                        <Button
                          size="small"
                          type="text"
                          icon={<DeleteOutlined />}
                          disabled={!tabConnected}
                          onClick={() => useRemoteWorkspaceStore.getState().setPendingStop({ hostId: tab.hostId, session: tabSession, action: "forget" })}
                        >
                          {t("remote.sessions.forget")}
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          type="text"
                          danger
                          icon={<StopOutlined />}
                          disabled={!tabConnected}
                          onClick={() => useRemoteWorkspaceStore.getState().setPendingStop({ hostId: tab.hostId, session: tabSession })}
                        >
                          {t("remote.sessions.stop")}
                        </Button>
                      )}
                    </div>
                  </div>
                  {tabError && (
                    <div role="alert" className="app-remote-error app-remote-error--banner">
                      <RemoteErrorMessage error={tabError} />
                    </div>
                  )}
                  <div className="app-remote-terminal-frame">
                    <RemoteTerminal
                      key={`${tab.hostId}:${tabSession.id}:${tabSession.instanceId}`}
                      hostId={tab.hostId}
                      session={tabSession}
                      active={visible && isTabActive}
                    />
                  </div>
                </div>
              ) : (
                <div className="app-remote-terminal-empty">
                  <CodeOutlined />
                  <p>{t("remote.sessions.connectFirst")}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

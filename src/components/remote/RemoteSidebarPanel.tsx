import {
  ApiOutlined,
  ArrowLeftOutlined,
  CloudServerOutlined,
  CodeOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  DownOutlined,
  EditOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  PlusOutlined,
  ReloadOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Empty, Spin, Tooltip } from "antd";
import type { MenuProps } from "antd";
import { useTranslation } from "react-i18next";
import { AgentIcon } from "@/components/AgentIcon";
import { WorkbenchEmptyArtwork } from "@/components/ui/WorkbenchGlyph";
import { isRemoteConnectionBusy, remoteErrorText, type RemoteHost, type RemoteSession } from "@/lib/remote";
import {
  connectRemoteWorkspace,
  disconnectRemoteWorkspace,
  refreshRemoteHosts,
  removeRemoteHost,
  startRemoteSession,
  useRemoteWorkspaceStore,
} from "@/store/slices/remoteWorkspace";

/** 远程工作台侧边栏面板：展示 Linux 主机列表与当前主机的远程会话。 */
export function RemoteSidebarPanel() {
  const { t } = useTranslation();
  const loading = useRemoteWorkspaceStore((state) => state.loading);
  const hosts = useRemoteWorkspaceStore((state) => state.hosts);
  const selectedHostId = useRemoteWorkspaceStore((state) => state.selectedHostId);
  const connections = useRemoteWorkspaceStore((state) => state.connections);
  const sessionsByHost = useRemoteWorkspaceStore((state) => state.sessionsByHost);
  const activeTab = useRemoteWorkspaceStore((state) => state.activeTab);
  const hostsCollapsed = useRemoteWorkspaceStore((state) => state.hostsCollapsed);
  const sessionsCollapsed = useRemoteWorkspaceStore((state) => state.sessionsCollapsed);
  const reconnectAttempts = useRemoteWorkspaceStore((state) => state.reconnectAttempts);
  const pending = useRemoteWorkspaceStore((state) => state.pendingActions);

  const selectedHost = hosts.find((item) => item.id === selectedHostId) ?? null;
  const selectedConnection = selectedHost ? connections[selectedHost.id] : undefined;
  const selectedConnected = selectedConnection?.state === "connected";
  const selectedSessions = selectedHost ? sessionsByHost[selectedHost.id] ?? [] : [];
  const hasAnyConnectedHost = hosts.some((item) => connections[item.id]?.state === "connected");

  const runOperation = async (operation: () => Promise<unknown>, hostId: string) => {
    useRemoteWorkspaceStore.getState().setError(hostId, null);
    try {
      await operation();
    } catch (failure) {
      useRemoteWorkspaceStore.getState().setError(hostId, remoteErrorText(failure));
    }
  };

  const openEditor = (host: RemoteHost | null) => {
    useRemoteWorkspaceStore.getState().setError("editor", null);
    useRemoteWorkspaceStore.getState().setHostEditor(host);
  };

  const connectionStateLabel = (hostId: string) => {
    const attempt = reconnectAttempts[hostId] ?? 0;
    const state = connections[hostId]?.state ?? "disconnected";
    if (attempt > 0 && !isRemoteConnectionBusy(connections[hostId]) && state !== "connected") {
      return t("remote.connection.reconnecting", { attempt });
    }
    return t(`remote.connection.${state}`);
  };

  const handleNewRemoteSession = () => {
    if (hasAnyConnectedHost) {
      useRemoteWorkspaceStore.getState().setNewSessionModalOpen(true);
      return;
    }
    if (selectedHost) {
      useRemoteWorkspaceStore.getState().openHostOverview(selectedHost.id);
    } else {
      openEditor(null);
    }
  };

  const getHostMenuItems = (item: RemoteHost): MenuProps["items"] => {
    const connection = connections[item.id];
    const connected = connection?.state === "connected";
    const busy = isRemoteConnectionBusy(connection);
    const reconnecting = (reconnectAttempts[item.id] ?? 0) > 0;
    const locked = connected || busy || reconnecting;

    return [
      connected || busy || reconnecting
        ? {
            key: "disconnect",
            label: t(busy ? "remote.cancelConnection" : reconnecting ? "remote.cancelReconnect" : "remote.disconnect"),
            icon: <DisconnectOutlined />,
            onClick: () => void runOperation(() => disconnectRemoteWorkspace(item.id), item.id),
          }
        : {
            key: "connect",
            label: t("remote.connect"),
            icon: <ApiOutlined />,
            onClick: () => {
              useRemoteWorkspaceStore.getState().openHostOverview(item.id);
              void runOperation(() => connectRemoteWorkspace(item.id), item.id);
            },
          },
      {
        key: "overview",
        label: t("remote.overview"),
        icon: <InfoCircleOutlined />,
        onClick: () => useRemoteWorkspaceStore.getState().openHostOverview(item.id),
      },
      ...(connected
        ? [
            {
              key: "new-session",
              label: t("remote.sessions.start"),
              icon: <PlusOutlined />,
              onClick: () => {
                useRemoteWorkspaceStore.getState().setSelectedHost(item.id);
                useRemoteWorkspaceStore.getState().setNewSessionModalOpen(true);
              },
            },
            {
              key: "open-shell",
              label: t("remote.environment.openShell"),
              icon: <CodeOutlined />,
              onClick: () => void runOperation(() => startRemoteSession(item.id, "shell"), item.id),
            },
          ]
        : []),
      { type: "divider" as const },
      {
        key: "edit",
        label: t("remote.host.edit"),
        icon: <EditOutlined />,
        disabled: !!item.sshConfigFile || locked,
        onClick: () => openEditor(item),
      },
      {
        key: "remove",
        label: t("remote.host.remove"),
        icon: <DeleteOutlined />,
        danger: true,
        disabled: !!item.sshConfigFile || locked || !!pending[`${item.id}:delete`],
        onClick: () => void runOperation(() => removeRemoteHost(item.id), item.id),
      },
    ];
  };

  const getSessionMenuItems = (hostId: string, session: RemoteSession, connected: boolean): MenuProps["items"] => [
    {
      key: "open",
      label: t("remote.sessions.openTab"),
      icon: <CodeOutlined />,
      onClick: () => useRemoteWorkspaceStore.getState().openRemoteTab(hostId, session.id),
    },
    { type: "divider" as const },
    session.processState === "exited"
      ? {
          key: "forget",
          label: t("remote.sessions.forget"),
          icon: <DeleteOutlined />,
          danger: true,
          disabled: !connected,
          onClick: () => useRemoteWorkspaceStore.getState().setPendingStop({ hostId, session, action: "forget" }),
        }
      : {
          key: "stop",
          label: t("remote.sessions.stop"),
          icon: <StopOutlined />,
          danger: true,
          disabled: !connected,
          onClick: () => useRemoteWorkspaceStore.getState().setPendingStop({ hostId, session }),
        },
  ];

  return (
    <div className="app-remote-sidebar">
      <div className="app-remote-sidebar__header">
        <button
          type="button"
          className="app-sidebar-new-session-button flex h-7 w-full items-center justify-start gap-2 rounded-[7px] px-3 text-sm font-medium text-[var(--cs-text-secondary)] hover:bg-[var(--cs-bg-hover)]"
          onClick={handleNewRemoteSession}
        >
          <PlusOutlined />
          <span>{t("remote.sessions.newTitle")}</span>
        </button>
        <div className="app-remote-sidebar__toolbar">
          <Button
            size="small"
            type="text"
            icon={<ArrowLeftOutlined />}
            className="app-remote-sidebar__back"
            onClick={() => useRemoteWorkspaceStore.getState().setVisible(false)}
          >
            {t("remote.backToLocal")}
          </Button>
          <div className="app-remote-actions">
            <Tooltip title={t("remote.host.refreshConfig")} mouseEnterDelay={0.4}>
              <Button
                size="small"
                type="text"
                icon={<ReloadOutlined spin={loading} />}
                aria-label={t("remote.host.refreshConfig")}
                onClick={() => void runOperation(refreshRemoteHosts, "global")}
              />
            </Tooltip>
            <Tooltip title={t("remote.host.add")} mouseEnterDelay={0.4}>
              <Button
                size="small"
                type="text"
                icon={<PlusOutlined />}
                aria-label={t("remote.host.add")}
                onClick={() => openEditor(null)}
              />
            </Tooltip>
          </div>
        </div>
      </div>

      <div className="app-sidebar-section-content flex-1 min-h-0 overflow-y-auto app-project-tree-scroll p-2.5">
        <div className="app-sidebar-panel space-y-1">
          <div
            className="app-sidebar-section-header flex items-center gap-1.5 px-2.5 pt-1 pb-1 cursor-pointer select-none rounded-lg"
            style={{ color: "var(--cs-text-secondary)" }}
            onClick={() => useRemoteWorkspaceStore.getState().toggleHostsCollapsed()}
          >
            <CloudServerOutlined className="text-[11px]" />
            <span className="text-[10px] font-medium uppercase tracking-wider flex-1">
              {t("remote.host.list")}
            </span>
            <span className="app-remote-count-pill">{hosts.length}</span>
            <DownOutlined className="app-disclosure-chevron text-[9px]" data-open={!hostsCollapsed} />
          </div>

          <div className="app-accordion" data-open={!hostsCollapsed ? "true" : "false"} aria-hidden={hostsCollapsed}>
            <div className="app-accordion__inner">
              {loading && hosts.length === 0 ? (
                <div className="app-remote-loading"><Spin size="small" /></div>
              ) : hosts.length === 0 ? (
                <div className="app-remote-sidebar-empty">
                  <p>{t("remote.host.empty")}</p>
                  <Button size="small" icon={<PlusOutlined />} onClick={() => openEditor(null)}>
                    {t("remote.host.add")}
                  </Button>
                </div>
              ) : (
                hosts.map((item) => {
                  const connection = connections[item.id];
                  const state = connection?.state ?? "disconnected";
                  const connected = state === "connected";
                  const busy = isRemoteConnectionBusy(connection);
                  const reconnecting = (reconnectAttempts[item.id] ?? 0) > 0;
                  const isActiveHost = item.id === selectedHostId;
                  return (
                    <Dropdown key={item.id} menu={{ items: getHostMenuItems(item) }} trigger={["contextMenu"]}>
                      <div
                        data-active={isActiveHost ? "true" : "false"}
                        className="app-sidebar-list-item app-session-list-item group flex items-center gap-2 cursor-pointer"
                        onClick={() => useRemoteWorkspaceStore.getState().setSelectedHost(item.id)}
                      >
                        <span className="app-remote-host-dot" data-state={state} title={connectionStateLabel(item.id)} />
                        <div className="flex-1 min-w-0">
                          <div className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-[var(--cs-text-primary)]">
                            <Tooltip title={`${item.name} · ${item.target} (${connectionStateLabel(item.id)})`} mouseEnterDelay={0.5}>
                              <span className="min-w-0 flex-1 truncate">{item.name}</span>
                            </Tooltip>
                            {item.sshConfigFile && (
                              <span className="app-remote-inline-tag">SSH</span>
                            )}
                          </div>
                          <div className="app-remote-sidebar-subtext truncate">{item.target}</div>
                        </div>

                        <div className="app-session-trailing ml-auto grid shrink-0 items-center">
                          <div className="app-session-summary flex items-center justify-end">
                            <span className="app-session-time whitespace-nowrap text-[11px]">
                              {connectionStateLabel(item.id)}
                            </span>
                          </div>
                          <div className="app-session-actions flex items-center justify-end gap-0.5">
                            <Tooltip title={t("remote.overview")} mouseEnterDelay={0.5}>
                              <button
                                type="button"
                                aria-label={t("remote.overview")}
                                className="app-remote-icon-btn"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  useRemoteWorkspaceStore.getState().openHostOverview(item.id);
                                }}
                              >
                                <InfoCircleOutlined className="text-xs" />
                              </button>
                            </Tooltip>
                            <Tooltip
                              title={t(connected || busy || reconnecting ? (busy ? "remote.cancelConnection" : "remote.disconnect") : "remote.connect")}
                              mouseEnterDelay={0.5}
                            >
                              <button
                                type="button"
                                aria-label={t(connected || busy || reconnecting ? "remote.disconnect" : "remote.connect")}
                                className="app-remote-icon-btn"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (connected || busy || reconnecting) {
                                    void runOperation(() => disconnectRemoteWorkspace(item.id), item.id);
                                  } else {
                                    useRemoteWorkspaceStore.getState().openHostOverview(item.id);
                                    void runOperation(() => connectRemoteWorkspace(item.id), item.id);
                                  }
                                }}
                              >
                                {busy ? (
                                  <LoadingOutlined className="text-xs" />
                                ) : connected || reconnecting ? (
                                  <DisconnectOutlined className="text-xs" />
                                ) : (
                                  <ApiOutlined className="text-xs" />
                                )}
                              </button>
                            </Tooltip>
                          </div>
                        </div>
                      </div>
                    </Dropdown>
                  );
                })
              )}
            </div>
          </div>

          <div className="app-remote-sidebar-divider" />

          <div className="app-remote-section-row">
            <div
              className="app-sidebar-section-header flex flex-1 items-center gap-1.5 px-2.5 pt-1 pb-1 cursor-pointer select-none rounded-lg"
              style={{ color: "var(--cs-text-secondary)" }}
              onClick={() => useRemoteWorkspaceStore.getState().toggleSessionsCollapsed()}
            >
              <CodeOutlined className="text-[11px]" />
              <span className="text-[10px] font-medium uppercase tracking-wider flex-1 truncate">
                {selectedHost ? `${selectedHost.name} · ${t("remote.sessions.title")}` : t("remote.sessions.title")}
              </span>
              <span className="app-remote-count-pill">{selectedSessions.length}</span>
              <DownOutlined className="app-disclosure-chevron text-[9px]" data-open={!sessionsCollapsed} />
            </div>
            {selectedHost && selectedConnected && (
              <Tooltip title={t("remote.environment.openShell")} mouseEnterDelay={0.4}>
                <Button
                  size="small"
                  type="text"
                  icon={<CodeOutlined />}
                  loading={!!pending[`${selectedHost.id}:launch`]}
                  aria-label={t("remote.environment.openShell")}
                  onClick={() => void runOperation(() => startRemoteSession(selectedHost.id, "shell"), selectedHost.id)}
                />
              </Tooltip>
            )}
          </div>

          <div className="app-accordion" data-open={!sessionsCollapsed ? "true" : "false"} aria-hidden={sessionsCollapsed}>
            <div className="app-accordion__inner">
              {!selectedHost ? (
                <Empty
                  description={t("remote.host.empty")}
                  className="mt-8"
                  image={<WorkbenchEmptyArtwork kind="terminal" />}
                />
              ) : selectedSessions.length === 0 ? (
                <div className="app-remote-sidebar-empty">
                  <p>{t(selectedConnected ? "remote.sessions.empty" : "remote.sessions.connectFirst")}</p>
                </div>
              ) : (
                selectedSessions.map((session) => {
                  const isActiveSession = activeTab?.hostId === selectedHost.id && activeTab?.sessionId === session.id;
                  const stateLabel = t(!selectedConnected ? "remote.task.disconnected" : `remote.task.${session.taskState}`);
                  const title = session.title
                    || (session.agentId === "shell"
                      ? t("remote.sessions.shell")
                      : session.agentId === "codex"
                        ? "Codex"
                        : "Claude Code");

                  return (
                    <Dropdown
                      key={session.id}
                      menu={{ items: getSessionMenuItems(selectedHost.id, session, selectedConnected) }}
                      trigger={["contextMenu"]}
                    >
                      <div
                        data-active={isActiveSession ? "true" : "false"}
                        className="app-sidebar-list-item app-session-list-item group flex items-center gap-2 cursor-pointer"
                        onClick={() => useRemoteWorkspaceStore.getState().openRemoteTab(selectedHost.id, session.id)}
                      >
                        <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center">
                          {session.agentId === "shell" ? (
                            <CodeOutlined className="text-[14px]" />
                          ) : (
                            <AgentIcon agentId={session.agentId} size={16} />
                          )}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex min-w-0 items-center text-[13px] font-medium text-[var(--cs-text-primary)]">
                            <Tooltip title={`${title} · ${session.cwd}`} mouseEnterDelay={0.5}>
                              <span className="min-w-0 flex-1 truncate">{title}</span>
                            </Tooltip>
                          </div>
                          <div className="app-remote-sidebar-subtext truncate">{session.cwd}</div>
                        </div>

                        <div className="app-session-trailing ml-auto grid shrink-0 items-center">
                          <div className="app-session-summary flex items-center justify-end">
                            <span className="app-session-time whitespace-nowrap text-[11px]">{stateLabel}</span>
                          </div>
                          <div className="app-session-actions flex items-center justify-end">
                            {session.processState === "exited" ? (
                              <Tooltip title={t("remote.sessions.forget")} mouseEnterDelay={0.5}>
                                <button
                                  type="button"
                                  disabled={!selectedConnected}
                                  aria-label={t("remote.sessions.forget")}
                                  className="app-remote-icon-btn"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    useRemoteWorkspaceStore.getState().setPendingStop({ hostId: selectedHost.id, session, action: "forget" });
                                  }}
                                >
                                  <DeleteOutlined className="text-xs" />
                                </button>
                              </Tooltip>
                            ) : (
                              <Tooltip title={t("remote.sessions.stop")} mouseEnterDelay={0.5}>
                                <button
                                  type="button"
                                  disabled={!selectedConnected}
                                  aria-label={t("remote.sessions.stop")}
                                  className="app-remote-icon-btn app-remote-icon-btn--danger"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    useRemoteWorkspaceStore.getState().setPendingStop({ hostId: selectedHost.id, session });
                                  }}
                                >
                                  <StopOutlined className="text-xs" />
                                </button>
                              </Tooltip>
                            )}
                          </div>
                        </div>
                      </div>
                    </Dropdown>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="app-remote-sidebar__footer">
        <p className="app-remote-hosts__note">{t("remote.host.scope")}</p>
      </div>
    </div>
  );
}

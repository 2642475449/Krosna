import { useEffect, useId, useState } from "react";
import { Input, Modal, Select } from "antd";
import { CodeOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { remoteErrorText, type RemoteAgentId } from "@/lib/remote";
import {
  forgetRemoteSession,
  manageRemoteServer,
  refreshRemoteHosts,
  saveRemoteHostDraft,
  startRemoteSession,
  startRemoteWorkspacePolling,
  stopRemoteSession,
  useRemoteWorkspaceStore,
} from "@/store/slices/remoteWorkspace";
import "./remoteWorkspace.css";

/** 统一格式化并渲染远端错误消息，支持 i18n 键与可折叠诊断详情。 */
export function RemoteErrorMessage({ error }: { error: string }) {
  const { t } = useTranslation();
  const readable = remoteErrorText(error);
  return (
    <>
      <span>{readable.startsWith("remote.") ? t(readable) : readable}</span>
      {readable !== error && !error.startsWith("remote.errors.") && (
        <details className="app-remote-diagnostic">
          <summary>{t("remote.errors.diagnostic")}</summary>
          <pre>{error}</pre>
        </details>
      )}
    </>
  );
}

function RemoteHostEditorModal() {
  const { t } = useTranslation();
  const id = useId();
  const open = useRemoteWorkspaceStore((state) => state.editorOpen);
  const draft = useRemoteWorkspaceStore((state) => state.hostDraft);
  const pending = useRemoteWorkspaceStore((state) => state.pendingActions.save);
  const error = useRemoteWorkspaceStore((state) => state.errors.editor);
  const setDraft = useRemoteWorkspaceStore((state) => state.setHostDraft);
  const setEditor = useRemoteWorkspaceStore((state) => state.setHostEditor);

  const save = async () => {
    useRemoteWorkspaceStore.getState().setError("editor", null);
    try {
      await saveRemoteHostDraft();
    } catch (failure) {
      useRemoteWorkspaceStore.getState().setError("editor", remoteErrorText(failure));
    }
  };

  return (
    <Modal
      centered
      open={open}
      title={t(draft.id ? "remote.host.edit" : "remote.host.add")}
      onCancel={() => {
        if (!pending) setEditor(false);
      }}
      onOk={() => void save()}
      confirmLoading={pending}
      okText={t("common.save")}
      cancelText={t("common.cancel")}
      mask={{ closable: false }}
      className="app-remote-host-modal"
    >
      <div className="app-remote-host-form">
        <p className="app-remote-muted">{t("remote.host.intro")}</p>
        <label htmlFor={`${id}-name`}>{t("remote.host.name")}</label>
        <Input
          id={`${id}-name`}
          autoFocus
          value={draft.name}
          maxLength={120}
          onChange={(event) => setDraft({ name: event.target.value })}
        />
        <label htmlFor={`${id}-target`}>{t("remote.host.target")}</label>
        <Input
          id={`${id}-target`}
          value={draft.target}
          placeholder={t("remote.host.targetPlaceholder")}
          onChange={(event) => setDraft({ target: event.target.value })}
        />
        <p className="app-remote-field-help">{t("remote.host.targetHelp")}</p>
        <div className="app-remote-host-form__advanced">
          <div>
            <label htmlFor={`${id}-port`}>{t("remote.host.port")}</label>
            <Input
              id={`${id}-port`}
              value={draft.port}
              inputMode="numeric"
              placeholder={t("remote.host.configDefault")}
              onChange={(event) => setDraft({ port: event.target.value })}
            />
          </div>
          <div>
            <label htmlFor={`${id}-identity`}>{t("remote.host.identity")}</label>
            <Input
              id={`${id}-identity`}
              value={draft.identityFile}
              placeholder={t("remote.host.identityPlaceholder")}
              onChange={(event) => setDraft({ identityFile: event.target.value })}
            />
          </div>
        </div>
        {error && (
          <div role="alert" className="app-remote-error">
            <RemoteErrorMessage error={error} />
          </div>
        )}
      </div>
    </Modal>
  );
}

function NewRemoteSessionModal() {
  const { t } = useTranslation();
  const id = useId();
  const open = useRemoteWorkspaceStore((state) => state.newSessionModalOpen);
  const hosts = useRemoteWorkspaceStore((state) => state.hosts);
  const selectedHostId = useRemoteWorkspaceStore((state) => state.selectedHostId);
  const connections = useRemoteWorkspaceStore((state) => state.connections);
  const inspections = useRemoteWorkspaceStore((state) => state.inspections);
  const pending = useRemoteWorkspaceStore((state) => state.pendingActions);
  const errors = useRemoteWorkspaceStore((state) => state.errors);
  const storeCwd = useRemoteWorkspaceStore((state) => state.cwd);
  const storeAgent = useRemoteWorkspaceStore((state) => state.agentId);

  const connectedHosts = hosts.filter((item) => connections[item.id]?.state === "connected");
  const defaultHostId = connectedHosts.some((item) => item.id === selectedHostId)
    ? selectedHostId
    : connectedHosts[0]?.id ?? null;

  const [targetHostId, setTargetHostId] = useState<string | null>(defaultHostId);
  const [cwd, setCwd] = useState(storeCwd);
  const [agentId, setAgentId] = useState<RemoteAgentId>(storeAgent);

  useEffect(() => {
    if (!open) return;
    setTargetHostId(defaultHostId);
    setCwd(useRemoteWorkspaceStore.getState().cwd);
    setAgentId(useRemoteWorkspaceStore.getState().agentId);
  }, [defaultHostId, open]);

  const activeHostId = targetHostId && connectedHosts.some((item) => item.id === targetHostId)
    ? targetHostId
    : defaultHostId;
  const inspection = activeHostId ? inspections[activeHostId] : undefined;
  const launching = activeHostId ? !!pending[`${activeHostId}:launch`] : false;
  const chosenAgentInstalled = agentId === "shell"
    || !!inspection?.agents.find((agent) => agent.id === agentId)?.installed;
  const error = activeHostId ? errors[activeHostId] : null;

  const handleCreate = async () => {
    if (!activeHostId) return;
    useRemoteWorkspaceStore.getState().setLaunchDirectory(cwd);
    if (agentId !== "shell") {
      useRemoteWorkspaceStore.getState().setLaunchAgent(agentId);
    }
    useRemoteWorkspaceStore.getState().setError(activeHostId, null);
    try {
      await startRemoteSession(activeHostId, agentId, cwd);
    } catch (failure) {
      useRemoteWorkspaceStore.getState().setError(activeHostId, remoteErrorText(failure));
    }
  };

  return (
    <Modal
      centered
      open={open}
      title={t("remote.sessions.newTitle")}
      onCancel={() => {
        if (!launching) useRemoteWorkspaceStore.getState().setNewSessionModalOpen(false);
      }}
      onOk={() => void handleCreate()}
      confirmLoading={launching}
      okButtonProps={{ disabled: !activeHostId || !chosenAgentInstalled }}
      cancelButtonProps={{ disabled: launching }}
      okText={t("remote.sessions.start")}
      cancelText={t("common.cancel")}
      mask={{ closable: false }}
      className="app-remote-host-modal"
    >
      <div className="app-remote-host-form">
        {connectedHosts.length === 0 ? (
          <p className="app-remote-muted">{t("remote.sessions.connectHostFirst")}</p>
        ) : (
          <>
            <label htmlFor={`${id}-host`}>{t("remote.sessions.hostLabel")}</label>
            <Select
              id={`${id}-host`}
              value={activeHostId ?? undefined}
              onChange={(value) => setTargetHostId(value)}
              options={connectedHosts.map((item) => ({
                value: item.id,
                label: `${item.name} (${item.target})`,
              }))}
            />
            <label htmlFor={`${id}-agent`}>{t("remote.sessions.agent")}</label>
            <Select<RemoteAgentId>
              id={`${id}-agent`}
              value={agentId}
              onChange={(value) => setAgentId(value)}
              options={[
                { value: "codex", label: "Codex" },
                { value: "claude", label: "Claude Code" },
                { value: "shell", label: t("remote.sessions.shell") },
              ]}
            />
            <label htmlFor={`${id}-cwd`}>{t("remote.sessions.directory")}</label>
            <Input
              id={`${id}-cwd`}
              prefix={<CodeOutlined />}
              value={cwd}
              placeholder={t("remote.sessions.directoryPlaceholder")}
              onChange={(event) => setCwd(event.target.value)}
              onPressEnter={() => {
                if (activeHostId && chosenAgentInstalled && !launching) {
                  void handleCreate();
                }
              }}
            />
            {!chosenAgentInstalled && (
              <p className="app-remote-field-help">{t("remote.environment.notInstalled")}</p>
            )}
          </>
        )}
        {error && (
          <div role="alert" className="app-remote-error">
            <RemoteErrorMessage error={error} />
          </div>
        )}
      </div>
    </Modal>
  );
}

/** 远程工作台生命周期轮询与共享浮层（主机编辑、新建会话、停止/移除确认）。 */
export function RemoteWorkspaceModals() {
  const { t } = useTranslation();
  const visible = useRemoteWorkspaceStore((state) => state.visible);
  const errors = useRemoteWorkspaceStore((state) => state.errors);
  const pending = useRemoteWorkspaceStore((state) => state.pendingActions);
  const pendingStop = useRemoteWorkspaceStore((state) => state.pendingStop);
  const pendingServerAction = useRemoteWorkspaceStore((state) => state.pendingServerAction);
  const pendingSessionAction = pendingStop?.action ?? "stop";

  useEffect(() => {
    if (visible) {
      void refreshRemoteHosts().catch(() => undefined);
    }
  }, [visible]);

  useEffect(() => startRemoteWorkspacePolling(), []);

  const runOperation = async (operation: () => Promise<unknown>, hostId: string) => {
    useRemoteWorkspaceStore.getState().setError(hostId, null);
    try {
      await operation();
    } catch (failure) {
      useRemoteWorkspaceStore.getState().setError(hostId, remoteErrorText(failure));
    }
  };

  return (
    <>
      <RemoteHostEditorModal />
      <NewRemoteSessionModal />
      <Modal
        centered
        open={!!pendingStop}
        className="app-remote-stop-modal"
        title={t(`remote.sessions.${pendingSessionAction}Title`)}
        okText={t(`remote.sessions.${pendingSessionAction}`)}
        cancelText={t("common.cancel")}
        okButtonProps={{ danger: true }}
        confirmLoading={pendingStop ? pending[`${pendingStop.hostId}:${pendingSessionAction}`] : false}
        cancelButtonProps={{ disabled: pendingStop ? pending[`${pendingStop.hostId}:${pendingSessionAction}`] : false }}
        mask={{ closable: false }}
        onCancel={() => {
          if (!pendingStop || !pending[`${pendingStop.hostId}:${pendingSessionAction}`]) {
            useRemoteWorkspaceStore.getState().setPendingStop(null);
          }
        }}
        onOk={() => {
          if (!pendingStop) return;
          void runOperation(
            () => (pendingSessionAction === "forget"
              ? forgetRemoteSession(pendingStop.hostId, pendingStop.session)
              : stopRemoteSession(pendingStop.hostId, pendingStop.session)),
            pendingStop.hostId,
          );
        }}
      >
        <p>{t(`remote.sessions.${pendingSessionAction}Description`, { name: pendingStop?.session.title, pid: pendingStop?.session.pid })}</p>
        {pendingStop && errors[pendingStop.hostId] && (
          <div className="app-remote-error" role="alert">
            <RemoteErrorMessage error={errors[pendingStop.hostId]!} />
          </div>
        )}
      </Modal>
      <Modal
        centered
        open={!!pendingServerAction}
        className="app-remote-server-modal"
        title={t(`remote.server.${pendingServerAction?.action ?? "stop"}`)}
        okText={t(`remote.server.${pendingServerAction?.action ?? "stop"}`)}
        cancelText={t("common.cancel")}
        okButtonProps={{ danger: true }}
        confirmLoading={pendingServerAction ? pending[`${pendingServerAction.hostId}:server`] : false}
        cancelButtonProps={{ disabled: pendingServerAction ? pending[`${pendingServerAction.hostId}:server`] : false }}
        mask={{ closable: false }}
        onCancel={() => {
          if (!pendingServerAction || !pending[`${pendingServerAction.hostId}:server`]) {
            useRemoteWorkspaceStore.getState().setPendingServerAction(null);
          }
        }}
        onOk={() => {
          if (!pendingServerAction) return;
          void runOperation(
            () => manageRemoteServer(pendingServerAction.hostId, pendingServerAction.action),
            pendingServerAction.hostId,
          );
        }}
      >
        <p>{t("remote.server.manageDescription")}</p>
        {pendingServerAction && errors[pendingServerAction.hostId] && (
          <div className="app-remote-error" role="alert">
            <RemoteErrorMessage error={errors[pendingServerAction.hostId]!} />
          </div>
        )}
      </Modal>
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Input, Modal, Select, message } from "antd";
import { useTranslation } from "react-i18next";
import { gitRepoInfo, gitStatus, inspectAgentClis } from "@/lib/api";
import { supportsAgentCapability } from "@/lib/agents";
import { openAuxiliaryQuestion } from "@/lib/auxiliaryDock";
import { getGitOperationLabelKey } from "@/lib/gitOperationState";
import { useAppStore } from "@/store";
import { useGitRemoteStore } from "@/store/slices/gitRemote";
import { useGitConflictDraftStore } from "@/store/slices/gitConflictDraft";
import type { AgentCliInfo } from "@/types";

/** 复用辅助任务的 Agent 启动链路，发送前展示完整指令并重新核对仓库状态。 */
export function GitConflictAgentAction({ projectPath, disabled }: { projectPath: string; disabled: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [agents, setAgents] = useState<AgentCliInfo[]>([]);
  const [agentId, setAgentId] = useState<string>();
  const [prompt, setPrompt] = useState("");
  const snapshot = useRef("");
  const launching = useRef(false);
  const admission = useRef({ disabled, dirty: false, open });
  const conflictBusy = useGitConflictDraftStore(state => Boolean(state.busy[projectPath]));
  const busy = useGitRemoteStore(state => Boolean(state.busy[projectPath]));
  const dirty = useGitConflictDraftStore(state => Object.entries(state.drafts).some(([key, draft]) =>
    JSON.parse(key)[0] === projectPath && draft.result !== draft.initialResult));

  admission.current = { disabled: disabled || conflictBusy, dirty, open };

  const readContext = async () => {
    const info = await gitRepoInfo(projectPath);
    const files = await gitStatus(projectPath);
    const operation = info.branchInfo?.operationState ?? "clean";
    const paths = files.filter(file => file.statusType === "conflicted").map(file => file.path).sort();
    return { operation, paths, fingerprint: JSON.stringify([operation, paths]) };
  };
  const makePrompt = (context: Awaited<ReturnType<typeof readContext>>) => t("sidebar.gitConflictAgentPrompt", {
    project: JSON.stringify(projectPath),
    operation: t(getGitOperationLabelKey(context.operation)),
    files: JSON.stringify(context.paths, null, 2),
    interpolation: { escapeValue: false },
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void Promise.all([inspectAgentClis(), readContext()]).then(([available, context]) => {
      if (cancelled) return;
      const installed = available.filter(agent => agent.installed && supportsAgentCapability(agent.id, "initialPrompt") && supportsAgentCapability(agent.id, "interactiveTerminal"));
      setAgents(installed);
      setAgentId(installed[0]?.id);
      setPrompt(makePrompt(context));
      snapshot.current = context.fingerprint;
    }).catch(error => { if (!cancelled) { message.error(String(error)); setOpen(false); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // 弹窗每次打开时读取实际仓库，不随翻译函数重建用户编辑过的指令。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectPath]);

  const launch = async () => {
    const agent = agents.find(item => item.id === agentId);
    if (!agent || launching.current || disabled || conflictBusy || busy || dirty || !prompt.trim()) return;
    launching.current = true;
    setLoading(true);
    try {
      const context = await readContext();
      if (context.fingerprint !== snapshot.current) {
        snapshot.current = context.fingerprint;
        setPrompt(makePrompt(context));
        message.info(t("sidebar.gitConflictAgentChanged"));
        return;
      }
      // 项目切换或弹窗读取期间开始的 Git 写操作不可沿用旧的准入状态。
      if (!admission.current.open || admission.current.disabled || admission.current.dirty
        || useAppStore.getState().currentProject?.path !== projectPath
        || useGitRemoteStore.getState().busy[projectPath]
        || useGitConflictDraftStore.getState().busy[projectPath]) {
        message.info(t("sidebar.gitConflictBusy"));
        return;
      }
      openAuxiliaryQuestion({ projectPath, agent, prompt, question: t("sidebar.gitConflictAgentTitle") });
      setOpen(false);
    } catch (error) { message.error(String(error)); }
    finally { launching.current = false; setLoading(false); }
  };

  return <>
    <Button size="small" disabled={disabled || conflictBusy || busy} onClick={() => setOpen(true)}>{t("sidebar.gitConflictAgentTitle")}</Button>
    <Modal open={open} title={t("sidebar.gitConflictAgentTitle")} width={720}
      onCancel={() => { if (!launching.current) setOpen(false); }} onOk={() => void launch()}
      confirmLoading={loading} okText={t("sidebar.gitConflictAgentSend")} cancelText={t("common.cancel")}
      okButtonProps={{ disabled: loading || disabled || conflictBusy || busy || dirty || !agentId || !prompt.trim() }}>
      <div className="flex flex-col gap-3 py-2">
        <p className="m-0 text-sm text-[var(--cs-text-secondary)]">{t("sidebar.gitConflictAgentDescription")}</p>
        {dirty ? <Alert type="warning" showIcon title={t("sidebar.gitConflictAgentDirty")} /> : null}
        <Select aria-label={t("newSession.agent")} value={agentId} onChange={setAgentId} loading={loading}
          options={agents.map(agent => ({ value: agent.id, label: agent.name }))} />
        {!loading && !agents.length ? <Alert type="info" title={t("sidebar.gitConflictAgentUnavailable")} /> : null}
        <Input.TextArea aria-label={t("sidebar.gitConflictAgentInstructions")} value={prompt} onChange={event => setPrompt(event.target.value)}
          disabled={loading} autoSize={{ minRows: 12, maxRows: 20 }} />
      </div>
    </Modal>
  </>;
}

import { useEffect, useRef, useState } from "react";
import { Button, Input, Modal, Select, Spin, Tooltip, message } from "antd";
import type { InputRef } from "antd";
import { EnterOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { getCachedAgentClis, getClaudeEffortInfo, inspectAgentClis, getClaudeRateLimits, getCodexRateLimits, getAntigravityUsage, getQoderUsage } from "@/lib/api";
import { formatAgentVersion, getAgentCommandPreview, getDefaultAgentLaunchOptions, isAgentYoloEnabled, supportsAgentCapability } from "@/lib/agents";
import { quotaWindows } from "@/lib/usageQuota";
import { getAntigravityGeminiQuotaWindows } from "@/lib/antigravityQuota";
import type { AgentCliInfo, AiAgentId, ClaudeEffortInfo, Session, SessionLaunchOptions } from "@/types";
import { AgentIcon } from "@/components/AgentIcon";
import { TASK_CHOICES, useLaunchChoiceLabel } from "@/hooks/useLaunchChoiceLabel";
import { useDefaultInstalledAgentSelection } from "@/hooks/useDefaultInstalledAgentSelection";
import { useAppStore } from "@/store";
import { getDefaultSessionTitle } from "@/lib/sessionTitles";

interface NewSessionDialogProps {
  open: boolean;
  creating: boolean;
  title?: string;
  onCancel: () => void;
  onCreate: (name: string, agent: AgentCliInfo, launchOptions?: SessionLaunchOptions, titleSource?: Session["titleSource"]) => void;
}
export function NewSessionDialog({ open, creating, title, onCancel, onCreate }: NewSessionDialogProps) {
  const { t } = useTranslation();
  const choiceLabel = useLaunchChoiceLabel();
  const defaults = useAppStore(s => s.agentPermissionDefaults);
  const projectPath = useAppStore(s => s.currentProject?.path);
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [defaultTitleTimestamp, setDefaultTitleTimestamp] = useState(Date.now);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const nameInputRef = useRef<InputRef>(null);
  const nameButtonRef = useRef<HTMLButtonElement>(null);
  const launcherRef = useRef<HTMLDivElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const [agents, setAgents] = useState<AgentCliInfo[]>([]);
  const [agentId, setAgentId] = useState<AiAgentId | null>(null);
  const [selectOpen, setSelectOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [overrides, setOverrides] = useState<Partial<Record<AiAgentId, string>>>({});
  const [effortInfo, setEffortInfo] = useState<ClaudeEffortInfo | null>(null);
  const [quotas, setQuotas] = useState<Partial<Record<AiAgentId, number>>>({});
  const submitting = useRef(false);
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    setName("");
    setDefaultTitleTimestamp(Date.now());
    setEditingName(false);
    setNameEdited(false); setAgentId(null); setSelectOpen(false); setOverrides({}); setFailed(false); submitting.current = false;
    const filter = (items: AgentCliInfo[]) => items.filter(a => a.installed && supportsAgentCapability(a.id, "interactiveTerminal"));
    const cached = getCachedAgentClis();
    setAgents(filter(cached ?? [])); setDetecting(cached === null);
    void inspectAgentClis().then(items => { if (!disposed) setAgents(filter(items)); }).catch(error => {
      console.error("Failed to inspect launcher agents", error);
      if (!disposed && !cached) setFailed(true);
    }).finally(() => { if (!disposed) setDetecting(false); });
    return () => { disposed = true; };
  }, [open, t]);
  useEffect(() => {
    if (editingName) nameInputRef.current?.focus({ cursor: "all" });
  }, [editingName]);
  useEffect(() => {
    if (!open) return;
    let disposed = false; setEffortInfo(null);
    void getClaudeEffortInfo(projectPath ?? null).then(info => { if (!disposed) setEffortInfo(info); }).catch(error => console.warn("Failed to read Claude effort", error));
    return () => { disposed = true; };
  }, [open, projectPath]);
  useEffect(() => {
    if (!open) return;
    let disposed = false; setQuotas({});
    const ids = new Set(agents.map(a => a.id));
    const session = useAppStore.getState().sessions.find(s => s.agentId === "claude" && s.path === projectPath);
    const requests: [AiAgentId, Promise<number | null>][] = [];
    const percent = (windows: { usedPercent: number }[]) => windows.length ? Math.min(...windows.map(w => 100 - w.usedPercent)) : null;
    if (ids.has("claude") && session) requests.push(["claude", getClaudeRateLimits(session.id).then(v => v.status === "ok" ? percent(quotaWindows(v)) : null)]);
    if (ids.has("codex")) requests.push(["codex", getCodexRateLimits().then(v => v.status === "ok" ? percent(quotaWindows(v)) : null)]);
    if (ids.has("antigravity")) requests.push(["antigravity", getAntigravityUsage().then(v => { const windows = getAntigravityGeminiQuotaWindows(v.windows); return v.status === "ok" && windows.length ? Math.min(...windows.map(w => w.remainingPercent)) : null; })]);
    if (ids.has("qoder")) requests.push(["qoder", getQoderUsage().then(v => { const used = v.totalUsagePercentage ?? v.userQuota?.percentage; return v.status === "ok" && used != null ? 100 - used : null; })]);
    for (const [id, request] of requests) void request.then(value => { if (!disposed && value != null && Number.isFinite(value)) setQuotas(current => ({ ...current, [id]: Math.max(0, Math.min(100, Math.round(value))) })); }).catch(error => console.warn("Launcher quota unavailable", id, error));
    return () => { disposed = true; };
  }, [open, agents, projectPath]);
  useDefaultInstalledAgentSelection({ enabled: open && !detecting, installedAgents: agents, selectedAgentId: agentId, onSelectedAgentChange: setAgentId, emptyValue: null });
  const selected = agents.find(a => a.id === agentId);
  const base = selected ? getDefaultAgentLaunchOptions(selected.id, defaults) : undefined;
  const taskKey = agentId === "qoder" ? "permissionMode" : agentId === "antigravity" ? "mode" : "effort";
  const taskValue = agentId ? overrides[agentId] ?? "inherit" : "inherit";
  const launchOptions = base && taskValue !== "inherit" ? { ...base, [taskKey]: taskValue } as SessionLaunchOptions : base;
  const command = selected ? getAgentCommandPreview(selected.id, launchOptions) : "";
  const copyCommand = () => {
    if (!command) return;
    void navigator.clipboard.writeText(command).then(() => {
      message.success(t("newSession.commandCopied"));
    });
  };
  const sessionName = nameEdited ? name : selected ? getDefaultSessionTitle(selected.name, defaultTitleTimestamp) : "";
  const finishNameEditing = () => {
    const nextName = nameDraft.trim();
    if (nextName && nextName !== sessionName) {
      setName(nextName);
      setNameEdited(true);
    }
    setEditingName(false);
  };
  const canCreate = Boolean(selected && sessionName.trim() && !creating && !detecting);
  const focusCreateButton = () => (canCreate ? createButtonRef.current : launcherRef.current)?.focus();
  const confirm = () => { if (!canCreate || !selected || submitting.current) return; submitting.current = true; onCreate(sessionName.trim(), selected, launchOptions, nameEdited ? "manual" : "default"); };
  useEffect(() => { if (!creating) submitting.current = false; }, [creating]);
  const move = (step: number) => { if (!agents.length || creating) return; const index = Math.max(0, agents.findIndex(a => a.id === agentId)); const next = (index + step + agents.length) % agents.length; setAgentId(agents[next].id); };
  const choices = agentId && agentId in TASK_CHOICES ? TASK_CHOICES[agentId as keyof typeof TASK_CHOICES] : null;
  const defaultTask = base ? (base as unknown as Record<string, string>)[taskKey] : "inherit";
  const defaultLabel = agentId === "claude" && defaultTask === "inherit" ? t(`statusBar.effort.${effortInfo?.effectiveLevel ?? "auto"}`) : agentId ? choiceLabel(agentId, defaultTask) : "";
  return <Modal open={open} title={null} closable={false} footer={null} width={580} keyboard={!selectOpen} className="app-session-launcher-modal" classNames={{ mask: "app-session-launcher-mask" }} onCancel={() => { if (!creating) onCancel(); }} afterOpenChange={visible => {
    // 默认回车创建会话，避免 Modal 将焦点放在标题编辑按钮上。
    if (visible) focusCreateButton();
  }} destroyOnHidden>
    <div ref={launcherRef} tabIndex={-1} aria-label={title ?? t("newSession.title")} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.repeat) return;
      // 子控件保留原生回车行为，仅在弹窗内容本身聚焦时执行默认创建。
      if (event.key === "Enter" && !selectOpen && event.target === event.currentTarget) { event.preventDefault(); event.stopPropagation(); confirm(); }
      else if (event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1); }
    }}>
      <div className="app-launcher-header">
        {editingName ? <Input
          ref={nameInputRef}
          className="app-launcher-name-input"
          variant="borderless"
          aria-label={t("newSession.name")}
          value={nameDraft}
          disabled={creating}
          maxLength={80}
          onChange={event => setNameDraft(event.target.value)}
          onBlur={finishNameEditing}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (event.key === "Enter" || event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              const saved = event.key === "Enter";
              if (saved) finishNameEditing();
              else setEditingName(false);
              // 等输入框卸载后恢复焦点：保存后可继续创建，取消后可重新编辑。
              requestAnimationFrame(() => {
                if (saved) focusCreateButton();
                else nameButtonRef.current?.focus();
              });
            }
          }}
        /> : <button
          ref={nameButtonRef}
          type="button"
          className="app-launcher-name"
          aria-label={t("newSession.name")}
          disabled={creating}
          onClick={() => { setNameDraft(sessionName); setEditingName(true); }}
          onKeyDown={event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}
        >{sessionName || title || t("newSession.title")}</button>}
        {selected && !["pi", "opencode"].includes(selected.id) && <Tooltip title={t("newSession.permissionManagedInSettings")}><button type="button" className="app-launcher-permission" disabled={creating} data-yolo={isAgentYoloEnabled(selected.id, defaults)} onClick={() => { onCancel(); sessionStorage.setItem("krosna.settings.pendingPage", "agents"); useAppStore.getState().openTab("__settings__"); window.dispatchEvent(new CustomEvent("settings:navigate", { detail: "agents" })); }}>{isAgentYoloEnabled(selected.id, defaults) ? t("newSession.yoloActive") : t("newSession.manualActive")}</button></Tooltip>}
      </div>
      <div className="app-launcher-body"><div className="mb-2 text-xs text-[var(--cs-text-secondary)]">{t("newSession.agent")}</div>
        {!detecting && !agents.length ? <p role="status" className="mb-0 text-xs text-[var(--cs-text-secondary)]">{t(failed ? "newSession.detectionFailed" : "newSession.noAgents")}</p> : (
          <Select<AiAgentId>
            className="app-launcher-select w-full"
            classNames={{ popup: { root: "app-launcher-select-dropdown" } }}
            size="large"
            aria-label={t("newSession.agent")}
            value={agentId ?? undefined}
            open={selectOpen}
            onOpenChange={setSelectOpen}
            disabled={creating || detecting || !agents.length}
            loading={detecting}
            placeholder={t(detecting ? "newSession.detecting" : "newSession.agent")}
            notFoundContent={detecting ? <Spin size="small" /> : t("newSession.noAgents")}
            onChange={value => setAgentId(value)}
            options={agents.map(agent => ({
              value: agent.id,
              label: (
                <span className="app-launcher-agent-option">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <AgentIcon agentId={agent.id} size={18} />
                    <strong className="truncate font-semibold text-[var(--cs-text-primary)]">{agent.name}</strong>
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-[var(--cs-text-tertiary)]">
                    <span>{formatAgentVersion(agent.version, agent.name)}</span>
                    {quotas[agent.id] != null && (
                      <span
                        className={
                          quotas[agent.id]! <= 5
                            ? "text-[var(--cs-error)]"
                            : quotas[agent.id]! <= 20
                              ? "text-[var(--cs-warning)]"
                              : "text-[var(--cs-success)]"
                        }
                      >
                        · {quotas[agent.id]}%
                      </span>
                    )}
                  </span>
                </span>
              ),
            }))}
          />
        )}
      </div>
      {choices && agentId && <div className="app-launcher-task"><div className="mb-2 flex justify-between gap-2 text-xs text-[var(--cs-text-secondary)]"><span>{t(agentId === "qoder" ? "newSession.qoderPermissionMode" : agentId === "antigravity" ? "newSession.antigravityMode" : "newSession.effort")}</span><span>{t("newSession.defaultValue", { value: defaultLabel })}</span></div><div className="app-launcher-pills">{choices.filter(value => value !== "dont_ask").map(value => <button type="button" key={value} disabled={creating} aria-pressed={taskValue === value} onClick={() => setOverrides(current => ({ ...current, [agentId]: value }))}>{choiceLabel(agentId, value)}</button>)}</div></div>}
      <div className="app-launcher-footer">
        <button
          type="button"
          className="app-launcher-command"
          disabled={!command}
          aria-label={t("newSession.commandCopyHint")}
          onMouseDown={e => e.preventDefault()}
          onClick={copyCommand}
        >
          <code aria-label={t("newSession.commandPreview")}>$ {command}</code>
        </button>
        <Button disabled={creating} onClick={onCancel}>{t("common.cancel")}</Button>
        <Button ref={createButtonRef} type="primary" loading={creating} disabled={!canCreate} onClick={confirm}>{t("newSession.create")} <EnterOutlined /></Button>
      </div>
    </div>
  </Modal>;
}

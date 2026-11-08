import { Segmented, Switch } from "antd";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import { getDefaultAgentLaunchOptions } from "@/lib/agents";
import type { AiAgentId, SessionLaunchOptions } from "@/types";

export const TASK_CHOICES = {
  claude: ["inherit", "low", "medium", "high", "xhigh", "max"],
  codex: ["inherit", "low", "medium", "high"],
  antigravity: ["inherit", "accept-edits", "plan"],
  qoder: ["inherit", "default", "accept_edits", "plan", "auto", "dont_ask", "bypass_permissions"],
};
export function useLaunchChoiceLabel() {
  const { t } = useTranslation();
  return (agent: AiAgentId, value: string): string => {
    if (agent === "claude" || agent === "codex") return value === "inherit" ? t("newSession.effortInherit") : t(`statusBar.effort.${value}`);
    if (agent === "antigravity") return t(`newSession.antigravityMode${value === "inherit" ? "Inherit" : value === "plan" ? "Plan" : "AcceptEdits"}`);
    const suffix: Record<string, string> = { inherit: "Inherit", default: "Default", accept_edits: "AcceptEdits", plan: "Plan", auto: "Auto", dont_ask: "DontAsk", bypass_permissions: "Bypass" };
    return t(`newSession.qoderPermissionMode${suffix[value]}`);
  };
}
export function AgentLaunchConfigPanel({ agentId }: { agentId: AiAgentId }) {
  const { t } = useTranslation();
  const label = useLaunchChoiceLabel();
  const defaults = useAppStore(s => s.agentPermissionDefaults);
  const save = useAppStore(s => s.setAgentPermissionDefaults);
  const options = getDefaultAgentLaunchOptions(agentId, defaults);
  if (!options) return null;
  const update = (patch: object) => save(agentId, { ...options, ...patch } as SessionLaunchOptions);
  const row = (title: string, control: React.ReactNode) => <div className="app-launch-config-row"><span>{title}</span>{control}</div>;
  const toggle = (key: string, title: string) => row(title, <Switch size="small" checked={Boolean((options as unknown as Record<string, unknown>)[key])} onChange={value => update({ [key]: value })} />);
  const choices = TASK_CHOICES[agentId as keyof typeof TASK_CHOICES];
  const taskKey = agentId === "qoder" ? "permissionMode" : agentId === "antigravity" ? "mode" : "effort";
  return <div className="app-agent-config-drawer">
    {agentId === "claude" && toggle("skipPermissions", t("newSession.skipPermissions"))}
    {agentId === "codex" && <>
      {toggle("yolo", t("newSession.codexYolo"))}
      {row(t("newSession.approvalMode"), <Segmented disabled={"yolo" in options && options.yolo} value={"approvalMode" in options ? options.approvalMode : "on-request"} options={[{ value: "on-request", label: t("newSession.codexApprovalOnRequest") }, { value: "never", label: t("newSession.codexApprovalNever") }]} onChange={value => update({ approvalMode: value })} />)}
      {row(t("newSession.sandboxMode"), <Segmented disabled={"yolo" in options && options.yolo} value={"sandboxMode" in options ? options.sandboxMode : "workspace-write"} options={[{ value: "workspace-write", label: t("newSession.workspaceWrite") }, { value: "read-only", label: t("newSession.readOnly") }]} onChange={value => update({ sandboxMode: value })} />)}
    </>}
    {agentId === "antigravity" && <>{toggle("dangerouslySkipPermissions", t("newSession.antigravitySkipPermissions"))}{toggle("sandbox", t("newSession.antigravitySandbox"))}</>}
    {choices && row(t(agentId === "qoder" ? "newSession.qoderPermissionMode" : agentId === "antigravity" ? "newSession.antigravityMode" : "newSession.effort"), <div className="app-launch-pills"><Segmented value={(options as unknown as Record<string, string>)[taskKey]} options={choices.map(value => ({ value, label: label(agentId, value) }))} onChange={value => update({ [taskKey]: value })} /></div>)}
  </div>;
}

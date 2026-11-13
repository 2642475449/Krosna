import { useTranslation } from "react-i18next";
import type { AiAgentId } from "@/types";

export const TASK_CHOICES = {
  claude: ["inherit", "low", "medium", "high", "xhigh", "max"],
  codex: ["inherit", "low", "medium", "high"],
  antigravity: ["inherit", "accept-edits", "plan"],
  qoder: ["inherit", "default", "accept_edits", "plan", "auto", "dont_ask", "bypass_permissions"],
} as const;

const QODER_MODE_KEY_SUFFIX: Record<string, string> = {
  inherit: "Inherit",
  default: "Default",
  accept_edits: "AcceptEdits",
  plan: "Plan",
  auto: "Auto",
  dont_ask: "DontAsk",
  bypass_permissions: "Bypass",
};

/** 将智能体启动参数（思考深度 / 权限模式）映射为当前界面语言的展示文本。 */
export function useLaunchChoiceLabel() {
  const { t } = useTranslation();
  return (agent: AiAgentId, value: string): string => {
    if (agent === "claude" || agent === "codex") {
      return value === "inherit" ? t("newSession.effortInherit") : t(`statusBar.effort.${value}`);
    }
    if (agent === "antigravity") {
      const suffix = value === "inherit" ? "Inherit" : value === "plan" ? "Plan" : "AcceptEdits";
      return t(`newSession.antigravityMode${suffix}`);
    }
    return t(`newSession.qoderPermissionMode${QODER_MODE_KEY_SUFFIX[value]}`);
  };
}

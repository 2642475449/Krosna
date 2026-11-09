import type { AgentId, Session } from "@/types";
import { AgentIcon } from "@/components/AgentIcon";

interface AgentActivityIconProps {
  agentId: AgentId;
  active?: boolean;
  status?: Session["status"];
  size?: number;
}

/** Brand identity stays still; AgentSessionStatus presents execution feedback. */
export function AgentActivityIcon({ agentId, size = 18 }: AgentActivityIconProps) {
  return <span className="inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
    <AgentIcon agentId={agentId} size={size} />
  </span>;
}

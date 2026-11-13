import { createContext, useContext } from 'react';
import type { AiAgentId } from '@/types';
import { AGENT_DEFINITIONS, getAgentCommandPreview, getDefaultAgentLaunchOptions } from '@/lib/agents';
import { AgentIcon } from '@/components/AgentIcon';
import { LaunchConfig } from './LaunchConfig';
import type { Agent, Model } from './model';

export type StudioApi = {
  model: Model; agents: Agent[]; dark: boolean; busy: boolean; selected: AiAgentId;
  preset: 'yolo' | 'manual' | 'custom';
  select: (id: AiAgentId) => void; open: (id: AiAgentId) => void;
  setDefault: (id: AiAgentId) => void; setPreset: (value: 'yolo' | 'manual') => void;
  update: (id: AiAgentId, patch: object) => void; check: () => void;
  copy: (value: string) => Promise<void>; install: (id: AiAgentId) => void; upgrade: (id: AiAgentId) => void;
};
export const StudioContext = createContext<StudioApi | null>(null);
export function useStudio(): StudioApi { const value = useContext(StudioContext); if (!value) throw new Error('Missing StudioContext'); return value; }
export const agentName = (id: AiAgentId) => AGENT_DEFINITIONS[id].displayName;
export const agentCommand = (model: Model, id: AiAgentId) => getAgentCommandPreview(id, getDefaultAgentLaunchOptions(id, model.permissions));
export const agentUpdate = (agent: Agent) => agent.installed && agent.version !== agent.latest;
export function quotaText(agent: Agent): string {
  if (!agent.installed) return '安装后可用';
  if (agent.quota === 'session') return '启动会话后读取';
  if (agent.quota === 'unavailable') return '额度暂不可读';
  if (agent.quota === 'unsupported') return '暂无额度接口';
  return `${agent.period}剩余 ${agent.remaining}%`;
}
export function AgentLogo({ id, size = 28 }: { id: AiAgentId; size?: number }) { return <AgentIcon agentId={id} size={size} />; }
export function StudioCommand({ id }: { id: AiAgentId }) {
  const api = useStudio(); const value = agentCommand(api.model, id);
  return <div className="studio-command"><div><span>命令预览</span><button onClick={() => void api.copy(value)}>复制命令</button></div><code tabIndex={0}>{value}</code></div>;
}
export function StudioConfig({ agent }: { agent: Agent }) {
  const api = useStudio();
  return <div className="studio-config"><LaunchConfig id={agent.id} permissions={api.model.permissions} update={api.update} /><StudioCommand id={agent.id} /></div>;
}

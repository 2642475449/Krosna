import type { AgentPermissionDefaults, AiAgentId, SessionLaunchOptions } from '@/types';
import { applyGlobalPermissionPreset, getDefaultAgentLaunchOptions, getPermissionDefaultsForLaunch } from '@/lib/agents';

export type Variant = 'A' | 'B' | 'C' | 'D' | 'E';
export type Scenario = 'normal' | 'loading' | 'empty' | 'failed' | 'uninstalled';
export type Agent = { id: AiAgentId; version: string; latest: string; installed: boolean; quota: 'ready' | 'session' | 'unavailable' | 'unsupported'; remaining?: number; period?: string; secondary?: string };
export type Model = { agents: Agent[]; defaultId: AiAgentId; permissions: AgentPermissionDefaults; checkedAt: number; scenario: Scenario; checks: number };
export const designs: Record<Variant, { name: string; subtitle: string; hypothesis: string; changes: string; benefit: string; cost: string }> = {
  A: { name: '编辑目录', subtitle: '瑞士编辑式排版', hypothesis: '用大胆字体和开放网格建立清晰的视觉顺序。', changes: '取消后台侧栏；用大字默认索引与双栏目录组织智能体。', benefit: '让身份、默认项与主要动作更明确。', cost: '留白更多，信息密度较低。' },
  B: { name: '藏书室', subtitle: '温暖的工具资料库', hypothesis: '把工具当作可选择与配置的资料，建立温暖且可读的目录。', changes: '纸色目录索引；资料签与书签式配置工作区。', benefit: '降低后台表格感，状态与配置有明确归属。', cost: '分区较多，熟悉界面需要短暂浏览。' },
  C: { name: '控制室', subtitle: '精密的开发者控制台', hypothesis: '直接呈现选择对象、执行策略和命令，让工具配置更利落。', changes: '硬边序号资源选择；命令与启动策略作为主工作区。', benefit: '连续配置与验证命令更直接。', cost: '视觉更理性，强调操作而非舒适留白。' },
  D: { name: '空间编排', subtitle: '带有空间感的智能体工作台', hypothesis: '用位置、色块与选择状态组织多个智能体。', changes: '重构整体构图；将当前对象的配置放到独立工作区。', benefit: '快速识别对象，减少重复状态标签。', cost: '宽屏体验更好，窄屏需要重新排布。' },
  E: { name: '焦点偏好', subtitle: '清晰从容的原生设置', hypothesis: '把对象选择与配置表单分开，让设置体验更专注。', changes: '独立智能体导航；原生偏好式表单与命令确认区。', benefit: '常用选项更好找，文字和控件更舒适。', cost: '完整信息需要切换对象查看。' },
};
export function createModel(now = Date.now()): Model {
  return {
    agents: [
      { id: 'claude', version: '2.1.322', latest: '2.1.322', installed: true, quota: 'session' },
      { id: 'codex', version: '0.167.1', latest: '0.167.2', installed: true, quota: 'ready', remaining: 76, period: '每周', secondary: '5 小时剩余 94%' },
      { id: 'antigravity', version: '1.5.5', latest: '1.5.7', installed: true, quota: 'ready', remaining: 92, period: '每周', secondary: '5 小时剩余 97%' },
      { id: 'opencode', version: '1.19.5', latest: '1.19.5', installed: true, quota: 'unsupported' },
      { id: 'qoder', version: '1.1.87', latest: '1.1.88', installed: true, quota: 'unavailable' },
      { id: 'pi', version: '1.5.2', latest: '1.5.2', installed: true, quota: 'unsupported' },
    ], defaultId: 'codex', permissions: applyGlobalPermissionPreset({}, 'yolo'), checkedAt: now, scenario: 'normal', checks: 0,
  };
}
export function changeConfig(model: Model, id: AiAgentId, patch: object): Model {
  const options = getDefaultAgentLaunchOptions(id, model.permissions);
  if (!options) return model;
  const permissions = getPermissionDefaultsForLaunch(id, { ...options, ...patch } as SessionLaunchOptions);
  return { ...model, permissions: { ...model.permissions, ...permissions } };
}
export function changeScenario(model: Model, scenario: Scenario): Model {
  return { ...model, scenario };
}
export function visibleAgents(model: Model): Agent[] {
  if (model.scenario === 'empty') return [];
  return model.agents.map(agent => model.scenario === 'uninstalled' && (agent.id === 'qoder' || agent.id === 'pi') ? { ...agent, installed: false } : agent);
}
export function finishCheck(model: Model, now: number): Model {
  return { ...model, checkedAt: now, checks: model.checks + 1, scenario: 'normal', agents: model.agents.map(agent => agent.quota === 'ready' ? { ...agent, remaining: Math.max(0, (agent.remaining ?? 0) - 1) } : agent) };
}
export const configurable = (id: AiAgentId) => ['claude', 'codex', 'antigravity', 'qoder'].includes(id);

import { Select, Switch } from 'antd';
import type { AgentPermissionDefaults, AiAgentId } from '@/types';
import { getDefaultAgentLaunchOptions } from '@/lib/agents';

const labels: Record<string, string> = {
  inherit: '继承全局', low: 'Low · 轻量', medium: 'Medium · 平衡', high: 'High · 深入', xhigh: 'xHigh · 更强推理', max: 'Max · 最高',
  'on-request': '按需审批', never: '不请求审批', 'workspace-write': '工作区可写', 'read-only': '只读',
  'accept-edits': '接受编辑', plan: '规划模式', default: '默认权限', accept_edits: '接受编辑', auto: '自动', dont_ask: '不询问', bypass_permissions: '跳过权限',
};
export function LaunchConfig({ id, permissions, update }: { id: AiAgentId; permissions: AgentPermissionDefaults; update: (id: AiAgentId, patch: object) => void }) {
  const options = getDefaultAgentLaunchOptions(id, permissions);
  if (!options) return <p className="muted">此智能体暂不提供启动配置，使用 CLI 默认行为。</p>;
  const values = options as unknown as Record<string, string | boolean>;
  const select = (label: string, key: string, choices: string[], disabled = false) => <label className="config-row"><span>{label}</span><Select aria-label={`${id} ${label}`} disabled={disabled} value={String(values[key])} options={choices.map(value => ({ value, label: labels[value] ?? value }))} onChange={value => update(id, { [key]: value })} /></label>;
  const toggle = (label: string, key: string) => <label className="config-row"><span>{label}</span><Switch aria-label={`${id} ${label}`} checked={Boolean(values[key])} onChange={value => update(id, { [key]: value })} /></label>;
  return <div className="config-controls">
    {id === 'claude' && <>{toggle('跳过权限审批', 'skipPermissions')}{select('思考强度', 'effort', ['inherit', 'low', 'medium', 'high', 'xhigh', 'max'])}</>}
    {id === 'codex' && <>{toggle('Yolo 模式', 'yolo')}{select('审批模式', 'approvalMode', ['on-request', 'never'], Boolean(values.yolo))}{select('沙箱范围', 'sandboxMode', ['workspace-write', 'read-only'], Boolean(values.yolo))}{values.yolo && <p className="field-help">Yolo 已启用，审批和沙箱设置暂不参与命令。</p>}{select('思考强度', 'effort', ['inherit', 'low', 'medium', 'high'])}</>}
    {id === 'antigravity' && <>{toggle('跳过权限审批', 'dangerouslySkipPermissions')}{toggle('启用沙箱', 'sandbox')}{select('启动模式', 'mode', ['inherit', 'accept-edits', 'plan'])}</>}
    {id === 'qoder' && select('权限模式', 'permissionMode', ['inherit', 'default', 'accept_edits', 'plan', 'auto', 'dont_ask', 'bypass_permissions'])}
  </div>;
}

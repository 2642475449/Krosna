import { useState } from 'react';
import { CheckOutlined, ReloadOutlined } from '@ant-design/icons';
import type { AiAgentId } from '@/types';
import { AgentLogo, StudioConfig, agentName, agentUpdate, quotaText, useStudio } from '../studio';
import './RefinementD.css';

export default function RefinementD() {
  const api = useStudio();
  const agents = api.agents.slice(0, 2);
  const [selectedId, setSelectedId] = useState<AiAgentId>('claude');
  const selected = agents.find(agent => agent.id === selectedId) ?? agents[0];
  if (!selected) return null;
  const isDefault = api.model.defaultId === selected.id;

  return <div className="refine-d">
    <header className="refine-d__heading"><h1>智能体</h1><button className="refine-d__check" disabled={api.busy} onClick={api.check}><ReloadOutlined spin={api.busy} />{api.busy ? '检查中' : '重新检查'}</button></header>
    <div className="refine-d__preferences"><p>默认使用 <strong>{agentName(api.model.defaultId)}</strong></p><div className="refine-d__permission"><span>全局权限</span>{api.preset === 'custom' && <span className="refine-d__custom">自定义</span>}<div className="refine-d__permission-options" aria-label="全局权限"><button aria-pressed={api.preset === 'yolo'} onClick={() => api.setPreset('yolo')}>Yolo</button><button aria-pressed={api.preset === 'manual'} onClick={() => api.setPreset('manual')}>手动</button></div></div></div>

    <div className="refine-d__switcher" aria-label="选择智能体">{agents.map(agent => <button key={agent.id} className={`refine-d__tool ${selected.id === agent.id ? 'refine-d__tool--selected' : ''}`} aria-pressed={selected.id === agent.id} aria-label={`选择 ${agentName(agent.id)}`} onClick={() => { setSelectedId(agent.id); api.select(agent.id); }}><AgentLogo id={agent.id} size={26} /><span className="refine-d__tool-text"><span className="refine-d__tool-name">{agentName(agent.id)}{api.model.defaultId === agent.id && <span className="refine-d__default-marker">默认</span>}</span><span className="refine-d__tool-status">{agent.installed ? agent.version : '未安装'}<span>·</span>{agentUpdate(agent) ? <span className="refine-d__update-label">可更新至 {agent.latest}</span> : <span>{agent.installed ? '已是最新' : '等待安装'}</span>}</span></span></button>)}</div>

    <section className="refine-d__workspace" aria-label={`${agentName(selected.id)} 启动配置`}>
      <div className="refine-d__status-row"><div className="refine-d__installation"><span className={`refine-d__dot ${selected.installed ? 'refine-d__dot--ready' : ''}`} /><span>{selected.installed ? '已安装' : '未安装'}</span>{agentUpdate(selected) && <><span className="refine-d__status-separator" /><button onClick={() => api.upgrade(selected.id)}>更新至 {selected.latest}</button></>}</div><div className="refine-d__quota">{selected.installed && selected.quota === 'ready' ? <><span>{selected.period}剩余 <strong>{selected.remaining}%</strong></span><progress value={selected.remaining} max={100} aria-label={`${agentName(selected.id)} 剩余额度`} /></> : <span>{quotaText(selected)}</span>}</div></div>
      <div className="refine-d__configuration-heading"><div><h2>启动配置</h2><p>设置下次启动时的权限与思考方式。</p></div><div className="refine-d__actions">{!selected.installed ? <button className="refine-d__default-action" onClick={() => api.install(selected.id)}>安装智能体</button> : isDefault ? <span className="refine-d__active-default"><CheckOutlined />默认智能体</span> : <button className="refine-d__default-action" onClick={() => api.setDefault(selected.id)}>设为默认</button>}<button className="refine-d__detail" onClick={() => api.open(selected.id)}>查看详情</button></div></div>
      {selected.installed ? <StudioConfig agent={selected} /> : <div className="refine-d__uninstalled"><p>安装后即可调整启动配置。</p><button onClick={() => api.open(selected.id)}>查看安装信息</button></div>}
    </section>
  </div>;
}

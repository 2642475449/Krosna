import { useState } from 'react';
import { CheckOutlined, DownOutlined, ReloadOutlined } from '@ant-design/icons';
import type { AiAgentId } from '@/types';
import { AgentLogo, agentName, agentUpdate, quotaText, StudioConfig, useStudio } from '../studio';
import './RefinementA.css';

export default function RefinementA() {
  const api = useStudio();
  const [expanded, setExpanded] = useState<AiAgentId | null>('claude');
  return <div className="refine-a">
    <header className="refine-a__heading"><h1>智能体</h1><button className="refine-a__check" disabled={api.busy} onClick={api.check}><ReloadOutlined spin={api.busy} />{api.busy ? '检查中' : '重新检查'}</button></header>
    <div className="refine-a__preferences">
      <div className="refine-a__default"><span>默认智能体</span><AgentLogo id={api.model.defaultId} size={17} /><strong>{agentName(api.model.defaultId)}</strong></div>
      <div className="refine-a__permissions"><span>全局权限</span>{api.preset === 'custom' && <span className="refine-a__custom">自定义</span>}<div className="refine-a__permission-options" aria-label="全局权限"><button aria-pressed={api.preset === 'yolo'} onClick={() => api.setPreset('yolo')}>Yolo</button><button aria-pressed={api.preset === 'manual'} onClick={() => api.setPreset('manual')}>手动</button></div></div>
    </div>
    <section className="refine-a__agents" aria-label="智能体列表">{api.agents.slice(0, 2).map(agent => {
      const isDefault = agent.id === api.model.defaultId;
      const isExpanded = expanded === agent.id;
      return <article className="refine-a__agent" key={agent.id}>
        <div className="refine-a__row">
          <div className="refine-a__identity"><span className="refine-a__logo"><AgentLogo id={agent.id} size={28} /></span><div><button className="refine-a__name" onClick={() => api.open(agent.id)} aria-label={`查看 ${agentName(agent.id)} 详情`}>{agentName(agent.id)}</button><div className="refine-a__metadata"><span>{agent.installed ? agent.version : '未安装'}</span><span className="refine-a__metadata-divider" />{agent.installed ? <span className="refine-a__installed">已安装</span> : <span>尚未检测到 CLI</span>}{agentUpdate(agent) && <><span className="refine-a__metadata-divider" /><button className="refine-a__update" onClick={() => api.upgrade(agent.id)}>更新至 {agent.latest}</button></>}</div></div></div>
          <div className="refine-a__quota">{agent.installed && agent.quota === 'ready' ? <><div><span>{agent.period}剩余</span><strong>{agent.remaining}%</strong></div><progress value={agent.remaining} max={100} aria-label={`${agentName(agent.id)} 剩余额度`} /></> : <span>{quotaText(agent)}</span>}</div>
          <div className="refine-a__actions">{!agent.installed ? <button className="refine-a__set-default" onClick={() => api.install(agent.id)}>安装</button> : isDefault ? <span className="refine-a__active-default"><CheckOutlined />默认智能体</span> : <button className="refine-a__set-default" onClick={() => api.setDefault(agent.id)}>设为默认</button>}<button className="refine-a__detail" onClick={() => api.open(agent.id)}>详情</button><button className={`refine-a__expand ${isExpanded ? 'refine-a__expand--open' : ''}`} aria-label={`${isExpanded ? '收起' : '配置'} ${agentName(agent.id)}`} aria-expanded={isExpanded} onClick={() => { api.select(agent.id); setExpanded(isExpanded ? null : agent.id); }}><DownOutlined rotate={isExpanded ? 180 : 0} /></button></div>
        </div>
        {isExpanded && agent.installed && <section className="refine-a__configuration"><div className="refine-a__configuration-title">启动配置</div><StudioConfig agent={agent} /></section>}
      </article>;
    })}</section>
  </div>;
}

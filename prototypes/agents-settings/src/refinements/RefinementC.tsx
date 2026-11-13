import { useState } from 'react';
import { CheckOutlined, ReloadOutlined, ArrowRightOutlined } from '@ant-design/icons';
import type { AiAgentId } from '@/types';
import { AgentLogo, agentName, agentUpdate, quotaText, StudioConfig, useStudio } from '../studio';
import './RefinementC.css';

export default function RefinementC() {
  const api = useStudio();
  const agents = api.agents.slice(0, 2);
  const [selectedId, setSelectedId] = useState<AiAgentId>('claude');
  const selected = agents.find(agent => agent.id === selectedId) ?? agents[0];
  const checkedAt = new Date(api.model.checkedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (!selected) return null;
  const isDefault = selected.id === api.model.defaultId;
  const select = (id: AiAgentId) => { setSelectedId(id); api.select(id); };

  return <div className="refine-c">
    <header className="rc-page-heading"><div><h1>智能体</h1><p>管理 CLI 工具，调整新会话的启动方式。</p></div><button className="rc-button" disabled={api.busy} onClick={api.check}><ReloadOutlined spin={api.busy} />{api.busy ? '正在检查' : '重新检查'}</button></header>

    <section className="rc-preferences" aria-label="智能体通用设置">
      <div className="rc-default-summary"><span className="rc-preference-label">默认智能体</span><span className="rc-default-name"><AgentLogo id={api.model.defaultId} size={19} /><strong>{agentName(api.model.defaultId)}</strong></span><span className="rc-preference-note">用于新会话与快捷命令</span></div>
      <div className="rc-global-permission"><div><span className="rc-preference-label">全局权限</span>{api.preset === 'custom' && <span className="rc-custom">自定义</span>}</div><div className="rc-segment" aria-label="全局权限预设"><button aria-pressed={api.preset === 'yolo'} onClick={() => api.setPreset('yolo')}>Yolo</button><button aria-pressed={api.preset === 'manual'} onClick={() => api.setPreset('manual')}>手动</button></div></div>
    </section>

    <div className="rc-workspace">
      <section className="rc-agent-column" aria-label="选择智能体"><div className="rc-column-caption"><span>已安装</span><span>{agents.filter(agent => agent.installed).length}</span></div><div className="rc-agent-choices">{agents.map(agent => <button className={`rc-agent-choice ${agent.id === selected.id ? 'rc-agent-selected' : ''}`} key={agent.id} aria-pressed={agent.id === selected.id} onClick={() => select(agent.id)}>
        <span className="rc-agent-identity"><AgentLogo id={agent.id} size={26} /><strong>{agentName(agent.id)}</strong>{api.model.defaultId === agent.id && <span className="rc-default-badge">默认</span>}</span>
        <span className="rc-agent-version">{agent.installed ? `v${agent.version}` : '未安装'}</span>
        <span className={`rc-version-note ${agentUpdate(agent) ? 'rc-update' : ''}`}>{agentUpdate(agent) ? `可更新至 ${agent.latest}` : agent.installed ? '已是最新版本' : `可安装 ${agent.latest}`}</span>
        <span className="rc-choice-divider" />
        <span className="rc-agent-quota"><span className={`rc-quota-dot ${agent.quota === 'ready' && agent.installed ? 'rc-quota-readable' : ''}`} />{quotaText(agent)}</span>
        {agent.quota === 'ready' && agent.installed && <progress value={agent.remaining} max={100} aria-label={`${agentName(agent.id)} 剩余额度`} />}
      </button>)}</div><p className="rc-last-checked">{api.busy ? '正在检查安装与额度…' : `上次检查 ${checkedAt}`}</p></section>

      <section className="rc-configuration" aria-label={`${agentName(selected.id)} 启动配置`}>
        <header className="rc-detail-heading"><div className="rc-detail-identity"><AgentLogo id={selected.id} size={28} /><div><h2>{agentName(selected.id)}</h2><p><span className="rc-installed-dot" />{selected.installed ? '已安装' : '未安装'}<span>·</span>{selected.installed ? `v${selected.version}` : `最新 ${selected.latest}`}</p></div></div>{!selected.installed ? <button className="rc-button rc-button-primary" onClick={() => api.install(selected.id)}>模拟安装</button> : isDefault ? <span className="rc-active-default"><CheckOutlined />默认智能体</span> : <button className="rc-button" onClick={() => api.setDefault(selected.id)}>设为默认</button>}</header>
        <div className="rc-detail-body"><div className="rc-form-heading"><h3>启动设置</h3><span>应用于后续新建的会话</span></div>{selected.installed ? <StudioConfig agent={selected} /> : <div className="rc-not-installed"><p>安装后即可调整启动配置。</p><button className="rc-button" onClick={() => api.install(selected.id)}>模拟安装 {agentName(selected.id)}</button></div>}<div className="rc-detail-footer"><span>已有会话保持当前配置。</span><button className="rc-text-button" onClick={() => api.open(selected.id)}>查看完整详情 <ArrowRightOutlined /></button></div></div>
      </section>
    </div>
  </div>;
}

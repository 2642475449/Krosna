import { useState } from 'react';
import { CheckOutlined, ReloadOutlined, ArrowRightOutlined } from '@ant-design/icons';
import type { AiAgentId } from '@/types';
import { AgentLogo, StudioConfig, agentName, agentUpdate, quotaText, useStudio } from '../studio';
import './RefinementB.css';

export default function RefinementB() {
  const api = useStudio();
  const [configuredId, setConfiguredId] = useState<AiAgentId>('claude');
  const samples = api.agents.slice(0, 2);
  const configured = samples.find(agent => agent.id === configuredId) ?? samples[0];
  const choose = (id: AiAgentId) => { setConfiguredId(id); api.select(id); };

  return <div className="refine-b">
    <header className="rb-heading"><h1>智能体</h1><button className="rb-check" disabled={api.busy} onClick={api.check}><ReloadOutlined spin={api.busy} />{api.busy ? '正在检查' : '重新检查'}</button></header>
    <div className="rb-preferences">
      <div className="rb-permission"><div><span className="rb-preference-label">智能体权限</span><p>选择智能体执行操作时的审批方式。</p></div><div className="rb-permission-choice" role="group" aria-label="全局智能体权限"><button aria-pressed={api.preset === 'yolo'} onClick={() => api.setPreset('yolo')}>Yolo</button><button aria-pressed={api.preset === 'manual'} onClick={() => api.setPreset('manual')}>手动</button></div>{api.preset === 'custom' && <span className="rb-custom">自定义</span>}</div>
      <div className="rb-default-summary"><span className="rb-preference-label">默认智能体</span><span><AgentLogo id={api.model.defaultId} size={19} /><strong>{agentName(api.model.defaultId)}</strong><small>用于新会话与快捷命令</small></span></div>
    </div>
    <div className="rb-section-heading"><h2>已安装的智能体</h2><span>检查于 {new Date(api.model.checkedAt).toLocaleTimeString('zh-CN', { hour12: false })}</span></div>
    <div className="rb-tools">
      {samples.map(agent => {
        const isDefault = api.model.defaultId === agent.id;
        const selected = configured?.id === agent.id;
        return <article className={`rb-tool ${selected ? 'is-configured' : ''}`} key={agent.id}>
          <div className="rb-tool-heading"><span className="rb-agent-logo"><AgentLogo id={agent.id} size={29} /></span><div><h3>{agentName(agent.id)}</h3><span className="rb-install-state"><i />{agent.installed ? '已安装' : '未安装'}</span></div>{!agent.installed ? <button className="rb-default-button" onClick={() => api.install(agent.id)}>模拟安装</button> : isDefault ? <span className="rb-current-default"><CheckOutlined />默认智能体</span> : <button className="rb-default-button" onClick={() => api.setDefault(agent.id)}>设为默认</button>}</div>
          <div className="rb-version-line"><span>{agent.installed ? `v${agent.version}` : '尚未安装'}</span>{agentUpdate(agent) ? <button onClick={() => api.upgrade(agent.id)}>可更新至 {agent.latest}</button> : <span className="rb-version-note">{agent.installed ? '已是最新版本' : `可安装 ${agent.latest}`}</span>}</div>
          <div className="rb-quota-line"><span>使用额度</span>{agent.installed && agent.quota === 'ready' ? <div><span className="rb-quota-value">{agent.remaining}<small>%</small></span><span className="rb-quota-period">{agent.period}剩余</span><progress max={100} value={agent.remaining} aria-label={`${agentName(agent.id)} 额度剩余`} /></div> : <p>{quotaText(agent)}</p>}</div>
          <div className="rb-tool-actions"><button className={selected ? 'is-active' : ''} aria-pressed={selected} aria-label={`配置 ${agentName(agent.id)}`} onClick={() => choose(agent.id)}>启动设置<ArrowRightOutlined /></button><button onClick={() => api.open(agent.id)}>查看详情</button></div>
        </article>;
      })}
    </div>
    {configured && <section className="rb-configuration" aria-label={`${agentName(configured.id)} 启动设置`}><div className="rb-configuration-heading"><div><h2>启动设置</h2><span>{agentName(configured.id)}</span></div><p>调整下一次启动时使用的配置。</p></div>{configured.installed ? <StudioConfig agent={configured} /> : <div className="rb-install-first"><span>安装后即可配置启动方式。</span><button onClick={() => api.install(configured.id)}>模拟安装</button></div>}</section>}
  </div>;
}

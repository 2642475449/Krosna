import { useState } from 'react';
import { AgentLogo, StudioConfig, agentName, agentUpdate, quotaText, useStudio } from '../studio';
import { configurable } from '../model';
import type { AiAgentId } from '@/types';
import './DesignB.css';

const subjects: Record<AiAgentId, string> = {
  claude: '思考强度 · 权限控制',
  codex: '审批 · 沙箱 · 思考强度',
  antigravity: '启动模式 · 沙箱',
  opencode: 'CLI 默认启动',
  qoder: '权限模式',
  pi: 'CLI 默认启动',
};

export default function DesignB() {
  const api = useStudio();
  const [filter, setFilter] = useState<'all' | 'updates'>('all');
  const selected = api.agents.find(agent => agent.id === api.selected) ?? api.agents[0];
  const currentDefault = api.agents.find(agent => agent.id === api.model.defaultId);
  const updates = api.agents.filter(agentUpdate);
  const displayed = filter === 'updates' ? updates : api.agents;
  const configure = (id: AiAgentId) => {
    api.select(id);
    document.getElementById('db-workbench')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  return <div className="design-b" data-mode={api.dark ? 'dark' : 'light'}>
    <aside className="db-library-rail">
      <a className="db-wordmark" href="#db-catalogue"><span className="db-monogram">K.</span><span>Krosna<small>工作偏好 / 智能体</small></span></a>
      <div className="db-rail-title"><span>YOUR TOOL LIBRARY</span><h1>工具<br />藏书室<span>。</span></h1><p>把常用工具放在顺手的位置。</p></div>
      <section className="db-default-section">
        <div className="db-section-label"><span>01</span> 默认搭档</div>
        <div className="db-favorite"><AgentLogo id={api.model.defaultId} size={38} /><div><strong>{agentName(api.model.defaultId)}</strong><span>{currentDefault?.installed ? '新会话将使用此智能体' : '默认工具尚未安装'}</span></div><span className="db-bookmark" aria-label="当前默认">▾</span></div>
        <label className="db-select-label" htmlFor="db-default-select">更换默认智能体</label>
        <select id="db-default-select" aria-label="更换默认智能体" value={api.model.defaultId} onChange={event => api.setDefault(event.target.value as AiAgentId)}>
          {api.agents.map(agent => <option key={agent.id} value={agent.id} disabled={!agent.installed}>{agentName(agent.id)}{!agent.installed ? ' · 未安装' : ''}</option>)}
        </select>
      </section>
      <section className="db-permission-section">
        <div className="db-section-label"><span>02</span> 执行方式{api.preset === 'custom' && <b>自定义</b>}</div>
        <div className="db-permission-options" aria-label="全局权限">
          <button aria-pressed={api.preset === 'manual'} onClick={() => api.setPreset('manual')}><span className="db-radio" /><span><strong>手动确认</strong><small>在需要时审批操作</small></span></button>
          <button aria-pressed={api.preset === 'yolo'} onClick={() => api.setPreset('yolo')}><span className="db-radio" /><span><strong>Yolo</strong><small>让智能体直接执行</small></span></button>
        </div>
      </section>
      <div className="db-rail-bottom"><span className="db-stamp">K / WORKSPACE</span><p>找到合适的工具，<br />然后专注手上的工作。</p></div>
    </aside>
    <main className="db-library-content" id="db-catalogue">
      <header className="db-content-header"><div><div className="db-overline">工具 / AGENTS</div><h2>智能体目录<span>{String(api.agents.length).padStart(2, '0')}</span></h2><p>查看状态，挑选搭档，调整每个工具的启动方式。</p></div><div className="db-check"><button disabled={api.busy} onClick={api.check}><span className={api.busy ? 'db-spin' : ''}>↻</span>{api.busy ? '正在检查' : '检查工具'}</button><small>上次检查 {new Date(api.model.checkedAt).toLocaleTimeString('zh-CN', { hour12: false })}</small></div></header>
      <div className="db-catalogue-toolbar"><div role="group" aria-label="筛选智能体"><button className={filter === 'all' ? 'is-active' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>全部工具 <span>{api.agents.length}</span></button><button className={filter === 'updates' ? 'is-active' : ''} aria-pressed={filter === 'updates'} onClick={() => setFilter('updates')}>可更新 <span>{updates.length}</span></button></div><span className="db-catalogue-note">点击工具，展开启动设置</span></div>
      <div className="db-catalogue-grid">
        {displayed.map((agent) => {
          const isDefault = agent.id === api.model.defaultId;
          const isSelected = agent.id === selected?.id;
          const index = api.agents.findIndex(value => value.id === agent.id);
          return <article className={`db-tool-slip ${isSelected ? 'is-selected' : ''} ${isDefault ? 'is-default' : ''}`} key={agent.id}>
            <div className="db-slip-top"><span className="db-slip-number">{String(index + 1).padStart(2, '0')}</span><span className={`db-install-state ${agent.installed ? 'is-installed' : ''}`}>{agent.installed ? '已安装' : '未安装'}</span>{isDefault && <span className="db-default-tag">默认</span>}</div>
            <button className="db-tool-identity" aria-label={`配置 ${agentName(agent.id)}`} aria-pressed={isSelected} onClick={() => configure(agent.id)}><span className="db-tool-icon"><AgentLogo id={agent.id} size={31} /></span><span><strong>{agentName(agent.id)}</strong><small>{subjects[agent.id]}</small></span><span className="db-identity-arrow">↗</span></button>
            <div className="db-slip-info"><div className="db-slip-version"><span>{agent.installed ? `v${agent.version}` : `可安装 v${agent.latest}`}</span>{agentUpdate(agent) ? <button className="db-update" onClick={() => api.upgrade(agent.id)}>更新至 {agent.latest} ↗</button> : <span className="db-version-current">{agent.installed ? '最新版本' : '等待安装'}</span>}</div><div className="db-slip-quota"><span>{quotaText(agent)}</span>{agent.installed && agent.quota === 'ready' && <div className="db-quota-track" role="meter" aria-label={`${agentName(agent.id)} 额度剩余`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={agent.remaining}><i style={{ width: `${agent.remaining}%` }} /></div>}</div></div>
            <div className="db-slip-actions"><button onClick={() => api.open(agent.id)}>查看详情</button>{!agent.installed ? <button className="db-emphasis-action" onClick={() => api.install(agent.id)}>模拟安装 +</button> : isDefault ? <span className="db-default-caption">✓ 当前默认</span> : <button className="db-emphasis-action" onClick={() => api.setDefault(agent.id)}>设为默认 ↗</button>}</div>
          </article>;
        })}
      </div>
      {displayed.length === 0 && <div className="db-no-updates"><strong>工具都已是最新版本。</strong><button onClick={() => setFilter('all')}>返回全部工具 →</button></div>}
      {selected && <section className="db-workbench" id="db-workbench">
        <div className="db-workbench-heading"><div><span className="db-section-label"><span>03</span> 启动设置</span><h3><AgentLogo id={selected.id} size={24} />{agentName(selected.id)}</h3></div><span className="db-workbench-status">{selected.installed ? '配置下一次启动' : '安装后可配置'}</span><button className="db-detail-link" onClick={() => api.open(selected.id)}>完整详情 ↗</button></div>
        {!selected.installed ? <div className="db-install-prompt"><p>此工具尚未安装，安装后即可调整启动设置。</p><button onClick={() => api.install(selected.id)}>模拟安装 {agentName(selected.id)}</button></div> : <><StudioConfig agent={selected} />{!configurable(selected.id) && <p className="db-config-note">可直接复制命令启动，使用 CLI 自身的配置。</p>}</>}
      </section>}
      <footer className="db-content-footer"><span>Krosna · 智能体偏好</span><span>工具随你，工作由你。</span></footer>
    </main>
  </div>;
}

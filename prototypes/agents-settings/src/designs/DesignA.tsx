import { useState } from 'react';
import type { AiAgentId } from '@/types';
import { configurable } from '../model';
import { AgentLogo, agentName, agentUpdate, quotaText, StudioConfig, useStudio } from '../studio';
import './DesignA.css';

export default function DesignA() {
  const api = useStudio();
  const [configured, setConfigured] = useState<AiAgentId | null>(null);
  const current = api.agents.find(agent => agent.id === api.model.defaultId);
  const checkedAt = new Date(api.model.checkedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return <div className="design-a" data-mode={api.dark ? 'dark' : 'light'}>
    <div className="da-page">
      <header className="da-masthead"><div className="da-wordmark">krosna<span>®</span></div><span className="da-location">偏好设置 <span>／</span> 工具与连接</span><span className="da-section-number">01 — AGENTS</span></header>
      <section className="da-intro">
        <div className="da-intro-copy"><span className="da-kicker">你的工具，由你决定</span><h1>智能体<span>。</span></h1><p>选择默认工具，定义它们如何工作。</p></div>
        <div className="da-permission"><div className="da-permission-heading"><span>全局权限</span><span className="da-permission-current">{api.preset === 'custom' ? '自定义' : api.preset === 'yolo' ? '自主执行' : '逐步审批'}</span></div><div className="da-permission-options"><button aria-pressed={api.preset === 'yolo'} onClick={() => api.setPreset('yolo')}><span>01</span><strong>Yolo</strong><span className="da-choice-mark">↗</span></button><button aria-pressed={api.preset === 'manual'} onClick={() => api.setPreset('manual')}><span>02</span><strong>手动</strong><span className="da-choice-mark">↗</span></button></div><p>{api.preset === 'custom' ? '各智能体使用独立的权限配置。' : api.preset === 'yolo' ? '减少审批提示，让工作连续进行。' : '保留审批，在关键步骤做出决定。'}</p></div>
      </section>
      <div className="da-directory-heading"><h2>工具目录 <span>/{String(api.agents.length).padStart(2, '0')}</span></h2><button className="da-check" disabled={api.busy} onClick={api.check}><span aria-hidden="true">{api.busy ? '◌' : '↻'}</span>{api.busy ? '正在检查' : '重新检查'}<span className="da-check-time">{checkedAt}</span></button></div>
      <section className="da-directory">
        <aside className="da-default"><div className="da-default-top"><span>当前默认</span><span className="da-default-dot" /></div><div className="da-default-logo"><AgentLogo id={api.model.defaultId} size={62} /></div><h2>{agentName(api.model.defaultId)}</h2><p>{current?.installed ? '新会话、Git AI 和快捷命令，都会从这里开始。' : '默认工具尚未安装。安装此工具，或在右侧选择其他智能体。'}</p><button className="da-default-link" onClick={() => api.open(api.model.defaultId)}>查看工具详情 <span>↗</span></button><div className="da-default-footnote"><span>默认选择</span><strong>随时可更改</strong></div></aside>
        <div className="da-entries">{api.agents.map((agent, index) => {
          const isDefault = agent.id === api.model.defaultId;
          const isOpen = agent.id === configured;
          return <article className={`da-entry ${isDefault ? 'da-entry-default' : ''} ${isOpen ? 'da-entry-open' : ''}`} key={agent.id}>
            <div className="da-entry-top"><span className="da-index">{String(index + 1).padStart(2, '0')}</span><span className={`da-install ${agent.installed ? '' : 'da-install-missing'}`}><i />{agent.installed ? '已安装' : '未安装'}</span>{isDefault && <span className="da-default-tag">默认工具</span>}</div>
            <div className="da-identity"><AgentLogo id={agent.id} size={32} /><button onClick={() => api.open(agent.id)} aria-label={`查看 ${agentName(agent.id)} 详情`}>{agentName(agent.id)}<span>↗</span></button></div>
            <div className="da-version"><span>{agent.installed ? `v${agent.version}` : '尚未安装'}</span>{agentUpdate(agent) ? <button className="da-update" onClick={() => api.upgrade(agent.id)}>更新至 {agent.latest} <span>↑</span></button> : <span className="da-up-to-date">{agent.installed ? '已是最新' : `可安装 v${agent.latest}`}</span>}</div>
            <div className="da-quota"><span>{quotaText(agent)}</span>{agent.installed && agent.quota === 'ready' && <progress max={100} value={agent.remaining} aria-label={`${agentName(agent.id)} 剩余额度`} />}</div>
            <div className="da-entry-actions">{!agent.installed ? <button className="da-use" onClick={() => api.install(agent.id)}>安装此工具 <span>＋</span></button> : isDefault ? <span className="da-in-use">正在默认使用 <span>✓</span></span> : <button className="da-use" onClick={() => api.setDefault(agent.id)}>设为默认 <span>→</span></button>}{agent.installed && configurable(agent.id) ? <button className="da-configure" aria-expanded={isOpen} onClick={() => { api.select(agent.id); setConfigured(isOpen ? null : agent.id); }}>{isOpen ? '收起设置' : '启动设置'} <span>{isOpen ? '−' : '＋'}</span></button> : <button className="da-configure" onClick={() => api.open(agent.id)}>查看详情 <span>↗</span></button>}</div>
            {isOpen && agent.installed && <section className="da-inline-config"><div><h3>启动设置</h3><span>/{agentName(agent.id)}</span></div><StudioConfig agent={agent} /></section>}
          </article>;
        })}</div>
      </section>
      <footer className="da-footer"><span>KROSNA / 本地工作空间</span><span>独立的工具。统一的工作流。</span></footer>
    </div>
  </div>;
}

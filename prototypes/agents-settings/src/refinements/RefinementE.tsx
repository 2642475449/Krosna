import { useState } from 'react';
import { CheckOutlined, DownOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons';
import type { AiAgentId } from '@/types';
import { AgentLogo, StudioConfig, agentName, agentUpdate, quotaText, useStudio } from '../studio';
import './RefinementE.css';

export default function RefinementE() {
  const api = useStudio();
  const agents = api.agents.slice(0, 2);
  const [expanded, setExpanded] = useState<AiAgentId[]>(['claude']);
  const toggle = (id: AiAgentId) => {
    api.select(id);
    setExpanded(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  };
  const defaultInSample = agents.some(agent => agent.id === api.model.defaultId);

  return <div className="refine-e">
    <header className="re-heading"><div><h1>智能体</h1><p>设置默认工具，以及每个智能体的启动偏好。</p></div><button className="re-check" disabled={api.busy} onClick={api.check}><ReloadOutlined spin={api.busy} />重新检查</button></header>

    <section className="re-defaults" aria-label="通用偏好">
      <div className="re-setting-row"><div><h2>默认工具</h2><p>新会话、Git AI 和快捷命令使用此智能体</p></div><select aria-label="默认工具" value={api.model.defaultId} onChange={event => api.setDefault(event.target.value as AiAgentId)}>{!defaultInSample && <option value={api.model.defaultId}>{agentName(api.model.defaultId)}（当前）</option>}{agents.map(agent => <option key={agent.id} value={agent.id} disabled={!agent.installed}>{agentName(agent.id)}</option>)}</select></div>
      <div className="re-setting-row"><div><h2>执行权限{api.preset === 'custom' && <span className="re-custom">自定义</span>}</h2><p>{api.preset === 'custom' ? '各智能体使用独立的权限设置' : '选择新会话的全局权限预设'}</p></div><div className="re-permissions" aria-label="全局执行权限"><button aria-pressed={api.preset === 'manual'} onClick={() => api.setPreset('manual')}>手动审批</button><button aria-pressed={api.preset === 'yolo'} onClick={() => api.setPreset('yolo')}>Yolo</button></div></div>
    </section>

    <div className="re-section-title"><h2>启动偏好</h2><p>按工具单独调整，命令会同步更新。</p></div>
    <div className="re-tool-groups">{agents.map(agent => {
      const open = expanded.includes(agent.id);
      const currentDefault = api.model.defaultId === agent.id;
      return <section className={`re-tool ${open ? 're-tool-open' : ''}`} key={agent.id}>
        <div className="re-tool-top"><span className="re-logo"><AgentLogo id={agent.id} size={28} /></span><div className="re-tool-identity"><h3>{agentName(agent.id)}{currentDefault && <span className="re-default-label">默认</span>}</h3><p><span className={agent.installed ? 're-installed' : ''}>{agent.installed ? '已安装' : '未安装'}</span><span className="re-dot-separator">·</span>{agent.installed ? `版本 ${agent.version}` : `可安装 ${agent.latest}`}</p></div><div className="re-tool-actions">{agent.installed ? !currentDefault && <button className="re-secondary" onClick={() => api.setDefault(agent.id)}>设为默认</button> : <button className="re-secondary" onClick={() => api.install(agent.id)}>模拟安装</button>}<button className="re-details" onClick={() => api.open(agent.id)}>详情<RightOutlined /></button></div></div>
        <div className="re-tool-facts"><div><span>版本状态</span>{agentUpdate(agent) ? <button onClick={() => api.upgrade(agent.id)}>可更新至 {agent.latest}</button> : <strong>{agent.installed ? <><CheckOutlined />已是最新</> : '等待安装'}</strong>}</div><div><span>使用额度</span><strong>{quotaText(agent)}</strong>{agent.installed && agent.quota === 'ready' && <progress aria-label={`${agentName(agent.id)} 额度剩余`} value={agent.remaining} max={100} />}</div></div>
        <button className="re-expand" aria-expanded={open} aria-label={`${open ? '收起' : '展开'} ${agentName(agent.id)} 启动偏好`} onClick={() => toggle(agent.id)}><span>{open ? '启动设置' : '展开启动设置'}</span><DownOutlined rotate={open ? 180 : 0} /></button>
        {open && <div className="re-tool-config">{agent.installed ? <StudioConfig agent={agent} /> : <p className="re-install-help">安装后可以调整此智能体的启动偏好。</p>}</div>}
      </section>;
    })}</div>
    <footer className="re-footnote">更改应用于后续新会话，不影响当前运行中的会话。</footer>
  </div>;
}

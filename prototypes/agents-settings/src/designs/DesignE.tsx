import { CheckOutlined, CopyOutlined, ArrowUpOutlined, ReloadOutlined, SettingOutlined, RightOutlined } from '@ant-design/icons';
import { LaunchConfig } from '../LaunchConfig';
import { configurable } from '../model';
import { AgentLogo, agentCommand, agentName, agentUpdate, quotaText, useStudio } from '../studio';
import './DesignE.css';

export default function DesignE() {
  const api = useStudio();
  const agent = api.agents.find(value => value.id === api.selected) ?? api.agents[0];
  if (!agent) return null;
  const isDefault = agent.id === api.model.defaultId;
  const value = agentCommand(api.model, agent.id);
  const lastCheck = new Date(api.model.checkedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

  return <div className="design-e" data-mode={api.dark ? 'dark' : 'light'}>
    <div className="de-window">
      <header className="de-topbar">
        <div className="de-wordmark"><span>K</span><strong>Krosna</strong><i />偏好设置</div>
        <div className="de-topbar-right"><span>上次检查 {lastCheck}</span><button className="de-icon-button" aria-label="重新检查智能体" disabled={api.busy} onClick={api.check}><ReloadOutlined spin={api.busy} /></button></div>
      </header>

      <div className="de-body">
        <nav className="de-rail" aria-label="选择要配置的智能体">
          <div className="de-rail-title"><span>智能体</span><b>{api.agents.length}</b></div>
          <div className="de-agent-list">{api.agents.map(item => <button key={item.id} className={`de-agent ${item.id === agent.id ? 'de-selected' : ''}`} aria-pressed={item.id === agent.id} onClick={() => api.select(item.id)}>
            <span className="de-agent-logo"><AgentLogo id={item.id} size={27} /></span>
            <span className="de-agent-info"><strong>{agentName(item.id)}</strong><span>{item.installed ? `v${item.version}` : '尚未安装'}{item.id === api.model.defaultId && <em>默认</em>}</span><small className={agentUpdate(item) ? 'de-update-text' : ''}>{agentUpdate(item) ? `有更新 ${item.latest}` : item.installed ? quotaText(item) : '可安装使用'}</small></span>
            {item.id === agent.id && <span className="de-selection-dot" />}
          </button>)}</div>
          <div className="de-rail-note"><SettingOutlined /><span>选择智能体后，调整它的<br />启动方式与执行权限。</span></div>
        </nav>

        <main className="de-preferences">
          <header className="de-page-title"><span className="de-eyebrow">智能体偏好</span><h1>{agentName(agent.id)}</h1><p>为日常工作设置顺手的默认行为。</p></header>

          <section className="de-preference-group">
            <div className="de-group-heading"><h2>日常使用</h2><span>01</span></div>
            <div className="de-preference-row de-default-row"><div><h3>默认智能体</h3><p>{!agent.installed ? '安装此智能体后，才可用于新会话。' : isDefault ? '新会话、Git AI 与快捷命令将使用此智能体。' : `当前默认使用 ${agentName(api.model.defaultId)}。`}</p></div>{!agent.installed ? <button className="de-primary" onClick={() => api.install(agent.id)}>模拟安装</button> : <button className={isDefault ? 'de-default-state' : 'de-primary'} disabled={isDefault} onClick={() => api.setDefault(agent.id)}>{isDefault ? <><CheckOutlined /> 已设为默认</> : '设为默认'}</button>}</div>
            <div className="de-preference-row"><div><h3>安装与版本</h3><p>{agent.installed ? `已安装 ${agent.version}` : '尚未在本机安装'}<span className="de-inline-separator">·</span>最新 {agent.latest}</p></div>{agentUpdate(agent) ? <button className="de-text-button de-update-text" onClick={() => api.upgrade(agent.id)}>模拟更新 <ArrowUpOutlined /></button> : <span className="de-quiet-state">{agent.installed ? '已是最新' : '未安装'}</span>}</div>
            <button className="de-preference-row de-detail-link" onClick={() => api.open(agent.id)}><span><h3>查看安装详情</h3><p>可执行文件位置、安装命令及完整信息</p></span><RightOutlined /></button>
          </section>

          <section className="de-preference-group de-startup">
            <div className="de-group-heading"><h2>启动方式</h2><span>02</span></div>
            {agent.installed && configurable(agent.id) ? <div className="de-config-wrap studio-config"><LaunchConfig id={agent.id} permissions={api.model.permissions} update={api.update} /></div> : <div className="de-unconfigured"><SettingOutlined /><p>{agent.installed ? '此智能体使用 CLI 自身的默认配置。' : '安装后即可查看支持的启动设置。'}</p></div>}
            <p className="de-group-footnote">设置应用于后续新会话。当前运行中的会话保持原有行为。</p>
          </section>

          <section className="de-quota-section"><div><span className={`de-status-dot ${agent.quota === 'ready' && agent.installed ? 'de-status-ready' : ''}`} /><h3>可用额度</h3></div><strong>{quotaText(agent)}</strong>{agent.installed && agent.quota === 'ready' && <progress aria-label={`${agentName(agent.id)} 额度剩余`} max={100} value={agent.remaining} />}</section>
        </main>

        <aside className="de-confirmation">
          <div className="de-command-heading"><span>启动预览</span><span className="de-live-marker">实时同步</span></div>
          <div className="de-terminal"><div><span /><span /><span /><b>command</b></div><code tabIndex={0}>{value}</code></div>
          <button className="de-copy-command" onClick={() => void api.copy(value)}><CopyOutlined />复制启动命令</button>
          <p className="de-command-help">修改左侧设置时，命令会同步变化。</p>

          <section className="de-policy"><span className="de-eyebrow">所有智能体</span><h2>执行权限</h2><p>选择新会话的全局权限预设。</p><div className="de-policy-options">
            <button className={api.preset === 'manual' ? 'de-policy-active' : ''} aria-pressed={api.preset === 'manual'} onClick={() => api.setPreset('manual')}><span className="de-radio" /><span><strong>手动审批</strong><small>重要操作由你确认</small></span></button>
            <button className={api.preset === 'yolo' ? 'de-policy-active' : ''} aria-pressed={api.preset === 'yolo'} onClick={() => api.setPreset('yolo')}><span className="de-radio" /><span><strong>Yolo</strong><small>减少审批，直接执行</small></span></button>
          </div>{api.preset === 'custom' && <div className="de-custom-state">自定义 · 各智能体使用独立权限</div>}</section>
          <footer className="de-confirmation-footer"><span className="de-save-dot" />设置用于后续新会话</footer>
        </aside>
      </div>
    </div>
  </div>;
}

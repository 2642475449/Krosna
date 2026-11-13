import { ReloadOutlined, ArrowRightOutlined, CheckOutlined, ArrowUpOutlined, CopyOutlined } from '@ant-design/icons';
import { LaunchConfig } from '../LaunchConfig';
import { AgentLogo, agentCommand, agentName, agentUpdate, quotaText, useStudio } from '../studio';
import './DesignC.css';

export default function DesignC() {
  const api = useStudio();
  const agent = api.agents.find(item => item.id === api.selected) ?? api.agents[0];
  const defaultAgent = api.agents.find(item => item.id === api.model.defaultId);
  const installed = api.agents.filter(item => item.installed).length;
  const updateCount = api.agents.filter(agentUpdate).length;
  if (!agent) return null;
  const currentCommand = agentCommand(api.model, agent.id);
  const isDefault = agent.id === api.model.defaultId;
  const checkedTime = new Date(api.model.checkedAt).toLocaleTimeString('zh-CN', { hour12: false });

  return <div className="design-c" data-mode={api.dark ? 'dark' : 'light'}>
    <header className="dc-masthead">
      <div className="dc-brand"><span className="dc-mark" aria-hidden="true">K<span>_</span></span><strong>KROSNA</strong><span className="dc-slash">/</span><span>AGENT CONTROL</span></div>
      <div className="dc-scan"><span><i />本地环境 <b>{checkedTime}</b></span><button onClick={api.check} disabled={api.busy}><ReloadOutlined spin={api.busy} />{api.busy ? '正在检测' : '重新检测'}</button></div>
    </header>

    <div className="dc-heading"><div><p className="dc-overline">WORKSPACE PREFERENCES <span>01 — AGENTS</span></p><h1>智能体控制室<span>_</span></h1><p className="dc-description">选择工具，调整执行方式。每一次启动，都清楚可控。</p></div><div className="dc-environment"><span>{String(installed).padStart(2, '0')}<small> / {String(api.agents.length).padStart(2, '0')}</small></span><p>智能体已就绪{updateCount > 0 && <b>{updateCount} 项可更新</b>}</p></div></div>

    <section className="dc-policy" aria-label="全局执行权限">
      <div className="dc-policy-label"><span>EXECUTION POLICY</span><strong>全局执行权限</strong>{api.preset === 'custom' && <em>自定义</em>}</div>
      <div className="dc-policy-options"><button className={api.preset === 'manual' ? 'dc-policy-active' : ''} aria-pressed={api.preset === 'manual'} onClick={() => api.setPreset('manual')}><span className="dc-radio" /><span><strong>手动审批</strong><small>保留审批与沙箱控制</small></span><span className="dc-policy-code">MANUAL</span></button><button className={api.preset === 'yolo' ? 'dc-policy-active' : ''} aria-pressed={api.preset === 'yolo'} onClick={() => api.setPreset('yolo')}><span className="dc-radio" /><span><strong>自主执行</strong><small>减少审批提示，直接执行</small></span><span className="dc-policy-code">YOLO</span></button></div>
    </section>

    <section className="dc-registry" aria-label="智能体选择">
      <div className="dc-section-label"><span>01 <b>选择智能体</b></span><span>默认：{agentName(api.model.defaultId)}{defaultAgent?.installed ? '' : ' · 当前不可用'}</span></div>
      <div className="dc-agent-strip">{api.agents.map((item, index) => <button key={item.id} className={`dc-agent-selector ${agent.id === item.id ? 'dc-selected' : ''}`} aria-pressed={agent.id === item.id} onClick={() => api.select(item.id)}>
        <div className="dc-selector-top"><span className="dc-agent-index">{String(index + 1).padStart(2, '0')}</span>{api.model.defaultId === item.id ? <span className="dc-default-flag">默认</span> : <span className={item.installed ? 'dc-ready' : 'dc-not-ready'}>{item.installed ? '已安装' : '未安装'}</span>}</div>
        <div className="dc-selector-identity"><span className="dc-icon"><AgentLogo id={item.id} size={28} /></span><strong>{agentName(item.id)}</strong></div>
        <div className="dc-selector-version"><span>{item.installed ? `v${item.version}` : '尚未安装'}</span>{agentUpdate(item) && <span className="dc-update"><ArrowUpOutlined />{item.latest}</span>}</div>
        <span className="dc-selector-quota">{quotaText(item)}</span>
      </button>)}</div>
    </section>

    <section className="dc-active-agent" aria-label={`${agentName(agent.id)} 配置`}>
      <div className="dc-active-heading"><div><span className="dc-section-index">02 / CONFIGURE</span><h2>{agentName(agent.id)}<span>{agent.installed ? 'READY' : 'NOT INSTALLED'}</span></h2></div><div className="dc-active-actions"><button className="dc-link" onClick={() => api.open(agent.id)}>完整详情 <ArrowRightOutlined /></button>{!agent.installed ? <button className="dc-primary" onClick={() => api.install(agent.id)}>模拟安装 <ArrowRightOutlined /></button> : isDefault ? <span className="dc-current-default"><CheckOutlined />当前默认智能体</span> : <button className="dc-primary" onClick={() => api.setDefault(agent.id)}>设为默认 <ArrowRightOutlined /></button>}</div></div>

      <div className="dc-workspace">
        <div className="dc-command-zone">
          <div className="dc-console"><div className="dc-console-header"><span><i />STARTUP COMMAND</span><button onClick={() => void api.copy(currentCommand)} aria-label={`复制 ${agentName(agent.id)} 启动命令`}><CopyOutlined />复制</button></div><div className="dc-console-command"><span aria-hidden="true">❯</span><code tabIndex={0}>{currentCommand}</code></div><div className="dc-console-footer"><span>POWERSHELL</span><span>配置更改后即时更新 <span aria-hidden="true">↵</span></span></div></div>
          <div className="dc-agent-facts"><div><span>安装版本</span><strong>{agent.installed ? agent.version : '未安装'}</strong>{agentUpdate(agent) ? <button onClick={() => api.upgrade(agent.id)}><ArrowUpOutlined />模拟更新至 {agent.latest}</button> : <small>{agent.installed ? '已是最新版本' : `可安装 ${agent.latest}`}</small>}</div><div><span>使用额度</span>{agent.quota === 'ready' && agent.installed ? <><strong className="dc-quota-number">{agent.remaining}<small>%</small></strong><progress max={100} value={agent.remaining} aria-label={`${agentName(agent.id)} 剩余额度`} /><small>{agent.period}剩余{agent.secondary ? ` · ${agent.secondary}` : ''}</small></> : <><strong className="dc-quota-state">{!agent.installed ? '待安装' : agent.quota === 'session' ? '等待会话' : agent.quota === 'unavailable' ? '暂不可读' : '暂无接口'}</strong><small>{quotaText(agent)}</small></>}</div></div>
        </div>
        <div className="dc-config-panel"><div className="dc-config-title"><span>启动设置</span><span>LAUNCH OPTIONS</span></div>{agent.installed ? <LaunchConfig id={agent.id} permissions={api.model.permissions} update={api.update} /> : <div className="dc-install-state"><strong>先安装，再开始配置。</strong><p>安装后可选择权限、模式等受支持的启动选项。</p><button className="dc-primary" onClick={() => api.install(agent.id)}>模拟安装 {agentName(agent.id)}</button></div>}<p className="dc-config-note">设置用于后续启动的会话；已有会话保持当前配置。</p></div>
      </div>
    </section>
    <footer className="dc-footer"><span><i />KROSNA / LOCAL WORKSPACE</span><span>所选智能体与默认智能体可独立切换。</span></footer>
  </div>;
}

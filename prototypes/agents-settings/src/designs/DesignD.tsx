import { AppstoreOutlined, ArrowRightOutlined, CheckOutlined, CloudDownloadOutlined, ReloadOutlined, SettingOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { AgentLogo, StudioConfig, agentName, agentUpdate, quotaText, useStudio } from '../studio';
import { configurable } from '../model';
import './DesignD.css';

export default function DesignD() {
  const api = useStudio();
  const selected = api.agents.find(agent => agent.id === api.selected) ?? api.agents[0];
  const primary = api.agents.find(agent => agent.id === api.model.defaultId);
  if (!selected) return null;
  const installed = api.agents.filter(agent => agent.installed).length;
  const checked = new Date(api.model.checkedAt).toLocaleTimeString('zh-CN', { hour12: false });

  return <div className="design-d" data-mode={api.dark ? 'dark' : 'light'}>
    <aside className="dd-rail" aria-label="工作台上下文">
      <span className="dd-monogram">k<span>·</span></span>
      <div className="dd-rail-current"><AppstoreOutlined /><span>智能体</span></div>
      <span className="dd-rail-line" />
      <div className="dd-rail-bottom"><span className="dd-local-dot" /><span>本地</span></div>
    </aside>

    <div className="dd-workspace">
      <header className="dd-header"><div><p className="dd-eyebrow">KROSNA / WORKSPACE</p><h1>智能体工作台<span>。</span></h1><p className="dd-intro">把适合的工具，放在顺手的位置。</p></div><div className="dd-detection"><span>上次检查 {checked}</span><button className="dd-button dd-outline" onClick={api.check} disabled={api.busy}><ReloadOutlined spin={api.busy} />{api.busy ? '正在检查' : '检查环境'}</button></div></header>

      <div className="dd-layout">
        <div className="dd-board">
          <section className="dd-primary-strip" aria-label="默认智能体"><span className="dd-primary-orbit"><AgentLogo id={api.model.defaultId} size={32} /></span><div><span>下一次启动，默认使用</span><strong>{agentName(api.model.defaultId)}</strong>{!primary?.installed && <small>当前不可用，请先安装或更换默认项</small>}</div><span className="dd-primary-mark"><CheckOutlined />默认搭档</span></section>

          <div className="dd-board-label"><h2>工具编排</h2><span>{installed} / {api.agents.length} 已就绪</span></div>
          <section className="dd-grid" aria-label="选择智能体">{api.agents.map((agent, index) => {
            const active = agent.id === selected.id;
            const isDefault = agent.id === api.model.defaultId;
            return <article className={`dd-tile ${active ? 'dd-tile-selected' : ''}`} data-tone={index} key={agent.id}>
              <button className="dd-tile-select" aria-label={`选择 ${agentName(agent.id)}`} aria-pressed={active} onClick={() => api.select(agent.id)}>
                <div className="dd-tile-top"><span className="dd-tile-number">0{index + 1}</span><span className={`dd-selection-indicator ${active ? 'dd-selected-indicator' : ''}`}>{active && <CheckOutlined />}</span></div>
                <div className="dd-tile-identity"><span className="dd-tile-icon"><AgentLogo id={agent.id} size={32} /></span><h3>{agentName(agent.id)}</h3></div>
                <div className="dd-tile-version"><span>{agent.installed ? `v${agent.version}` : '未安装'}</span>{isDefault && <span className="dd-default-label">默认</span>}</div>
                <div className="dd-tile-quota">{agent.installed && agent.quota === 'ready' && <progress value={agent.remaining} max={100} aria-label={`${agentName(agent.id)} 额度剩余`} />}<span>{quotaText(agent)}</span></div>
              </button>
              <div className="dd-tile-footer">{agentUpdate(agent) ? <button className="dd-update-action" onClick={() => api.upgrade(agent.id)}>更新至 {agent.latest}<CloudDownloadOutlined /></button> : <span className="dd-installed-note"><i />{agent.installed ? '已是最新版本' : `可安装 ${agent.latest}`}</span>}<button className="dd-detail-action" onClick={() => api.open(agent.id)} aria-label={`查看 ${agentName(agent.id)} 详情`}><ArrowRightOutlined /></button></div>
            </article>;
          })}</section>

          <section className="dd-policy" aria-label="全局执行权限"><div className="dd-policy-copy"><span className="dd-policy-icon"><ThunderboltOutlined /></span><div><h2>执行方式{api.preset === 'custom' && <em>自定义</em>}</h2><p>所有智能体的默认权限</p></div></div><div className="dd-policy-options"><button aria-pressed={api.preset === 'manual'} className={api.preset === 'manual' ? 'dd-policy-selected' : ''} onClick={() => api.setPreset('manual')}><span>手动审批</span><small>每一步更可控</small></button><button aria-pressed={api.preset === 'yolo'} className={api.preset === 'yolo' ? 'dd-policy-selected' : ''} onClick={() => api.setPreset('yolo')}><span>Yolo 自主执行</span><small>减少审批打断</small></button></div></section>
        </div>

        <aside className="dd-inspector" aria-label="选中智能体的启动设置"><div className="dd-inspector-label"><span className="dd-focus-dot" /><span>当前选中</span><span>配置工作区</span></div><div className="dd-inspector-identity"><span><AgentLogo id={selected.id} size={42} /></span><div><h2>{agentName(selected.id)}</h2><p>{selected.installed ? '已安装 · 可用于新会话' : '尚未安装'}</p></div></div>
          <div className="dd-inspector-actions">{!selected.installed ? <button className="dd-button dd-solid" onClick={() => api.install(selected.id)}>模拟安装<CloudDownloadOutlined /></button> : selected.id === api.model.defaultId ? <div className="dd-current-default"><CheckOutlined />当前默认搭档</div> : <button className="dd-button dd-solid" onClick={() => api.setDefault(selected.id)}>设为默认搭档<ArrowRightOutlined /></button>}<button className="dd-button dd-icon-button" onClick={() => api.open(selected.id)} aria-label={`打开 ${agentName(selected.id)} 完整详情`}><SettingOutlined /></button></div>
          <div className="dd-inspector-rule" />
          <div className="dd-config-heading"><h3>启动设置</h3><span>{configurable(selected.id) ? '即时生效于下次启动' : 'CLI 默认行为'}</span></div>
          {selected.installed ? <StudioConfig agent={selected} /> : <div className="dd-install-placeholder"><CloudDownloadOutlined /><p>安装后，即可设置启动方式。</p><button onClick={() => api.open(selected.id)}>查看安装信息<ArrowRightOutlined /></button></div>}
          <footer className="dd-inspector-footer"><span className="dd-safe-symbol">↗</span><p>选择不同的智能体，在这里调整它的启动方式。</p></footer>
        </aside>
      </div>
    </div>
  </div>;
}

import { useEffect, useRef, useState } from 'react';
import { App as AntApp, Button, ConfigProvider, Drawer, Empty, Spin, Switch, theme } from 'antd';
import { AGENT_DEFINITIONS, applyGlobalPermissionPreset, getGlobalPermissionPreset } from '@/lib/agents';
import type { AiAgentId } from '@/types';
import { ANTD_COMPONENT_OVERRIDES } from '@/lib/antdTheme';
import { changeConfig, changeScenario, createModel, designs, finishCheck, visibleAgents, type Agent, type Scenario, type Variant } from './model';
import { AgentLogo, StudioConfig, StudioContext, agentName, quotaText, type StudioApi } from './studio';
import DesignA from './designs/DesignA';
import DesignB from './designs/DesignB';
import DesignC from './designs/DesignC';
import DesignD from './designs/DesignD';
import DesignE from './designs/DesignE';
import RefinementA from './refinements/RefinementA';
import RefinementB from './refinements/RefinementB';
import RefinementC from './refinements/RefinementC';
import RefinementD from './refinements/RefinementD';
import RefinementE from './refinements/RefinementE';
import { EmbeddedShell } from './EmbeddedShell';

const variants: Variant[] = ['A', 'B', 'C', 'D', 'E'];
const refinementNames = { A: '横向行组', B: '并列面板', C: '分栏配置', D: '焦点切换', E: '分组设置' };
const refinementNotes: Record<Variant, { changes: string; benefit: string; cost: string }> = {
  A: { changes: '身份与状态靠拢；配置沿工具行轻量展开。', benefit: '保留直观扫描，同时减少大块底色与重复标签。', cost: '横向空间较窄时状态需要换行。' },
  B: { changes: '工具信息并列呈现；下方使用统一配置区。', benefit: '两项工具可以在相同位置比较版本和额度。', cost: '配置与状态分为两个阅读区域。' },
  C: { changes: '窄列选择对象；右侧固定表单与命令。', benefit: '切换工具时配置位置稳定。', cost: '同时呈现的完整配置信息较少。' },
  D: { changes: '横向切换工具；单一工作区承载当前配置。', benefit: '减少重复容器，集中处理当前工具。', cost: '查看完整信息需要切换对象。' },
  E: { changes: '默认与权限按设置行分组；两工具使用独立启动偏好。', benefit: '以阅读和调整配置的顺序建立层级。', cost: '同时比较状态不如列表直接。' },
};
type Palette = { bg: string; panel: string; text: string; muted: string; line: string; accent: string; soft: string; ok: string };
const palettes: Record<Variant, { light: Palette; dark: Palette }> = {
  A: { light: { bg: '#f7f7f2', panel: '#ffffff', text: '#16191c', muted: '#656a70', line: '#d5d7d4', accent: '#234dde', soft: '#e9edff', ok: '#26734a' }, dark: { bg: '#151719', panel: '#202325', text: '#f1f2ed', muted: '#acb1b6', line: '#3a3e41', accent: '#a4b5ff', soft: '#2a3355', ok: '#8bd2a6' } },
  B: { light: { bg: '#f4eee3', panel: '#fffcf5', text: '#372b23', muted: '#806c59', line: '#d8cbb9', accent: '#a44c2e', soft: '#ead9c7', ok: '#53734a' }, dark: { bg: '#231e19', panel: '#302821', text: '#f3e6d5', muted: '#c2ac94', line: '#514436', accent: '#e2a17d', soft: '#493225', ok: '#a9c795' } },
  C: { light: { bg: '#edf1ed', panel: '#f7fcf9', text: '#182b26', muted: '#5a7168', line: '#bed0c6', accent: '#117c50', soft: '#d4eee1', ok: '#087a50' }, dark: { bg: '#101916', panel: '#17231e', text: '#e2f1e7', muted: '#9ab6a6', line: '#354b3f', accent: '#aff37c', soft: '#263d2e', ok: '#91f4ae' } },
  D: { light: { bg: '#ecf0f7', panel: '#ffffff', text: '#232b45', muted: '#67718b', line: '#d2d9e9', accent: '#5c49c7', soft: '#ece8ff', ok: '#277a64' }, dark: { bg: '#17182b', panel: '#24253d', text: '#efedff', muted: '#b3b0ce', line: '#44445e', accent: '#b5a6ff', soft: '#363051', ok: '#8bd9bc' } },
  E: { light: { bg: '#f2f4f6', panel: '#ffffff', text: '#222831', muted: '#66717f', line: '#d7dde5', accent: '#d44d43', soft: '#faebe9', ok: '#377c61' }, dark: { bg: '#171b21', panel: '#232931', text: '#f0f1f3', muted: '#a7b0bc', line: '#414952', accent: '#ffaaa1', soft: '#49302f', ok: '#92d2b1' } },
};

export function Prototype() {
  const query = new URLSearchParams(window.location.search);
  const [variant, setVariant] = useState<Variant>(() => variants.includes(query.get('design') as Variant) ? query.get('design') as Variant : 'A');
  const [embedded, setEmbedded] = useState(() => query.get('stage') !== 'archive');
  const [dark, setDark] = useState(() => query.get('theme') ? query.get('theme') === 'dark' : query.get('stage') !== 'archive');
  const palette = embedded ? (dark
    ? { bg: '#15181f', panel: '#1e232d', text: '#e4edf9', muted: '#b8c8df', line: '#343d4d', accent: '#8198ff', soft: '#2b3342', ok: '#4ade80' }
    : { bg: '#f1f3f7', panel: '#ffffff', text: '#20242c', muted: '#4f5f79', line: '#e0e5ed', accent: '#4263eb', soft: '#e9edf4', ok: '#16a34a' })
    : palettes[variant][dark ? 'dark' : 'light'];
  useEffect(() => {
    const html = document.documentElement;
    html.dataset.theme = dark ? 'dark-starry' : 'light-glass'; html.dataset.design = variant;
    const values: Record<string, string> = {
      '--cs-bg-app': palette.bg, '--cs-bg-content': palette.bg, '--cs-bg-card-solid': palette.panel,
      '--cs-bg-card': palette.panel, '--cs-bg-body': palette.panel, '--cs-bg-header': palette.bg, '--cs-primary-light': palette.soft,
      '--cs-bg-elevated': palette.panel, '--cs-bg-hover': palette.soft, '--cs-bg-active': palette.soft,
      '--cs-text-primary': palette.text, '--cs-text-secondary': palette.muted, '--cs-text-tertiary': palette.muted,
      '--cs-border': palette.line, '--cs-border-card': palette.line, '--cs-primary': palette.accent,
      '--cs-text-on-primary': dark ? palette.bg : '#ffffff', '--cs-success': palette.ok,
    };
    for (const [key, value] of Object.entries(values)) { if (embedded) html.style.removeProperty(key); else html.style.setProperty(key, value); }
    const url = new URL(window.location.href); url.searchParams.set('design', variant); url.searchParams.set('theme', dark ? 'dark' : 'light');
    url.searchParams.set('stage', embedded ? 'refine' : 'archive');
    window.history.replaceState(null, '', url);
  }, [variant, dark, palette, embedded]);
  return <ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm, token: {
    colorPrimary: palette.accent, colorBgContainer: palette.panel, colorText: palette.text, colorTextSecondary: palette.muted,
    colorBorder: palette.line, borderRadius: embedded ? 6 : variant === 'A' || variant === 'C' ? 3 : 9,
    fontSize: 14, controlHeight: embedded ? 32 : 36, fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif',
  }, components: ANTD_COMPONENT_OVERRIDES }}><AntApp><Workbench variant={variant} setVariant={setVariant} dark={dark} setDark={setDark} embedded={embedded} setEmbedded={setEmbedded} /></AntApp></ConfigProvider>;
}

function Workbench({ variant, setVariant, dark, setDark, embedded, setEmbedded }: { variant: Variant; setVariant: (value: Variant) => void; dark: boolean; setDark: (value: boolean) => void; embedded: boolean; setEmbedded: (value: boolean) => void }) {
  const { message } = AntApp.useApp();
  const [model, setModel] = useState(createModel);
  const [selected, select] = useState<AiAgentId>('codex');
  const [detailOpen, setDetailOpen] = useState(false);
  const [explain, setExplain] = useState(false);
  const [copyFailure, setCopyFailure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const agents = visibleAgents(model);
  const cancel = () => { generation.current++; if (timer.current) clearTimeout(timer.current); timer.current = null; setBusy(false); };
  useEffect(() => () => { generation.current++; if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    const fail = () => setErrors(value => value + 1); const original = console.error;
    console.error = (...args: unknown[]) => { fail(); original(...args); };
    window.addEventListener('error', fail, true); window.addEventListener('unhandledrejection', fail);
    return () => { console.error = original; window.removeEventListener('error', fail, true); window.removeEventListener('unhandledrejection', fail); };
  }, []);
  const scenario = (value: Scenario) => { cancel(); setModel(current => changeScenario(current, value)); setDetailOpen(false); };
  const reset = () => { cancel(); setModel(createModel()); select('codex'); setDetailOpen(false); setCopyFailure(false); message.success('模拟数据已重置'); };
  const check = () => {
    if (busy) return;
    cancel(); const request = generation.current; setBusy(true);
    timer.current = setTimeout(() => {
      if (request !== generation.current) return;
      setModel(current => finishCheck(current, Date.now())); setBusy(false); timer.current = null;
      message.success('检查完成，已刷新模拟额度与检查时间');
    }, 850);
  };
  const api: StudioApi = {
    model, agents, dark, busy, selected, select,
    preset: getGlobalPermissionPreset(model.permissions, agents.filter(agent => agent.installed).map(agent => agent.id)),
    open: id => { select(id); setDetailOpen(true); },
    setDefault: id => { if (!agents.find(agent => agent.id === id)?.installed) return; setModel(current => ({ ...current, defaultId: id })); message.success(`默认智能体已切换为 ${agentName(id)}`); },
    setPreset: value => { setModel(current => ({ ...current, permissions: applyGlobalPermissionPreset(current.permissions, value) })); message.success(`全局权限已切换为 ${value === 'yolo' ? 'Yolo' : '手动'}`); },
    update: (id, patch) => setModel(current => changeConfig(current, id, patch)), check,
    copy: async value => { try { if (copyFailure) throw new Error('模拟拒绝'); await navigator.clipboard.writeText(value); message.success('命令已复制'); } catch { message.error('复制失败，请选中命令后手动复制'); } },
    install: id => { setModel(current => ({ ...current, scenario: 'normal', agents: visibleAgents(current).map(agent => agent.id === id ? { ...agent, installed: true } : agent) })); message.success(`${agentName(id)} 已模拟安装`); },
    upgrade: id => { setModel(current => ({ ...current, agents: current.agents.map(agent => agent.id === id ? { ...agent, version: agent.latest } : agent) })); message.success(`${agentName(id)} 已模拟更新`); },
  };
  const selectedAgent = agents.find(agent => agent.id === selected);
  const info = embedded ? { name: refinementNames[variant], hypothesis: '固定 Krosna 外壳、主题与内容宽度，先比较 Claude / Codex 两项局部样张。', ...refinementNotes[variant] } : designs[variant];
  const View = embedded ? { A: RefinementA, B: RefinementB, C: RefinementC, D: RefinementD, E: RefinementE }[variant] : { A: DesignA, B: DesignB, C: DesignC, D: DesignD, E: DesignE }[variant];
  return <StudioContext.Provider value={api}>
    <header className="gallery-bar"><a className="gallery-brand" href="#studio"><b>K/</b><span>{embedded ? '内容区局部样张' : '五位设计师'}<small>{embedded ? '第三轮 · 固定 Krosna 外壳' : '第二轮 · 已保留归档'}</small></span></a>
      <nav className="gallery-designs" aria-label="五套独立设计">{variants.map(value => <button key={value} aria-pressed={value === variant} onClick={() => { setDetailOpen(false); setVariant(value); }}><b>{value}</b><span>{embedded ? refinementNames[value] : designs[value].name}</span></button>)}</nav>
      <div className="gallery-actions"><button aria-label={dark ? '切换亮色' : '切换暗色'} onClick={() => setDark(!dark)}>{dark ? '☀ 亮色' : '◐ 暗色'}</button><button aria-expanded={explain} onClick={() => setExplain(!explain)}>设计说明 {explain ? '−' : '+'}</button><button onClick={() => { setDetailOpen(false); setEmbedded(!embedded); }}>{embedded ? '上一轮' : '局部样张'}</button></div>
    </header>
    {explain && <aside className="gallery-notes"><div><strong>{variant} / {info.name}</strong><p>{info.hypothesis}</p><dl><dt>两项变化</dt><dd>{info.changes}</dd><dt>预期改善</dt><dd>{info.benefit}</dd><dt>取舍</dt><dd>{info.cost}</dd></dl></div><div className="gallery-tools"><label>模拟场景<select aria-label="模拟场景" value={model.scenario} onChange={event => scenario(event.target.value as Scenario)}><option value="normal">正常</option><option value="loading">加载中</option><option value="empty">空状态</option><option value="failed">检查失败</option><option value="uninstalled">部分未安装</option></select></label><label>模拟复制拒绝<Switch aria-label="模拟复制失败" checked={copyFailure} onChange={setCopyFailure} size="small" /></label><button onClick={reset}>重置模拟数据</button><small>检查完成 {model.checks} 次 · 异常计数 {errors}</small><p>五套设计共用模拟数据。安装、更新、额度查询均为模拟；复制使用浏览器剪贴板。</p></div></aside>}
    <div id="studio" className="studio-viewport" data-design={variant}>
      {model.scenario === 'failed' && <div className="studio-alert" role="alert"><span>检查失败，当前显示上次成功结果。</span><button disabled={busy} onClick={check}>重新检查</button></div>}
      {busy && <div className="studio-progress" role="status">正在检查智能体版本与模拟额度…</div>}
      {model.scenario === 'loading' ? <div className="studio-state"><Spin /><h2>正在发现智能体</h2><p>检测安装状态、版本与可用额度。</p><Button onClick={check} loading={busy}>完成模拟检查</Button></div>
        : agents.length === 0 ? <div className="studio-state"><Empty description="尚未发现智能体" /><Button type="primary" onClick={check} loading={busy}>重新检测</Button></div> : embedded ? <><div className="refinement-sample-note"><strong>局部样张</strong><span>先用 Claude / Codex 比较字体、间距、状态和配置布局；外壳保持一致，尚未迁入正式产品。</span></div><EmbeddedShell><View /></EmbeddedShell></> : <View />}
    </div>
    <Drawer title="智能体详情与启动设置" size={580} open={detailOpen && !!selectedAgent} onClose={() => setDetailOpen(false)}>{selectedAgent && <Inspector agent={selectedAgent} api={api} />}</Drawer>
  </StudioContext.Provider>;
}

function Inspector({ agent, api }: { agent: Agent; api: StudioApi }) {
  const definition = AGENT_DEFINITIONS[agent.id];
  return <div className="studio-inspector"><select aria-label="切换详情智能体" value={agent.id} onChange={event => api.select(event.target.value as AiAgentId)}>{api.agents.map(value => <option key={value.id} value={value.id}>{agentName(value.id)}</option>)}</select>
    <header><AgentLogo id={agent.id} size={40} /><div><h2>{agentName(agent.id)}</h2><p>{agent.installed ? `已安装 · v${agent.version}` : '尚未安装'}{api.model.defaultId === agent.id ? ' · 默认智能体' : ''}</p></div></header>
    <div className="inspector-actions">{!agent.installed ? <Button type="primary" onClick={() => api.install(agent.id)}>模拟安装</Button> : <Button type="primary" disabled={api.model.defaultId === agent.id} onClick={() => api.setDefault(agent.id)}>{api.model.defaultId === agent.id ? '当前默认' : '设为默认智能体'}</Button>}{agent.installed && agent.version !== agent.latest && <Button onClick={() => api.upgrade(agent.id)}>模拟更新至 {agent.latest}</Button>}</div>
    <section><h3>版本与安装</h3><p>当前 {agent.installed ? agent.version : '未安装'} / 最新 {agent.latest}</p><code>{agent.installed ? `C:\\Users\\demo\\AppData\\Roaming\\npm\\${definition.command}.cmd` : '未在 PATH 中找到可执行文件'}</code></section>
    <section><h3>可用额度</h3><p>{quotaText(agent)}</p>{agent.remaining !== undefined && agent.installed && <progress value={agent.remaining} max={100} aria-label="额度剩余" />}<small>检查于 {new Date(api.model.checkedAt).toLocaleTimeString('zh-CN', { hour12: false })}</small></section>
    {agent.installed && <section><h3>启动设置</h3><StudioConfig agent={agent} /></section>}
    <section><h3>安装命令</h3>{definition.installCommands.map(value => <div className="studio-command" key={value.shell}><div><span>{value.shell}</span><button onClick={() => void api.copy(value.command)}>复制</button></div><code tabIndex={0}>{value.command}</code></div>)}<small>仅供查看与复制，不会执行安装。</small></section>
  </div>;
}

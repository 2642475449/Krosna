import type { ReactNode } from 'react';
import { SettingOutlined, RobotOutlined, GlobalOutlined, FontSizeOutlined, SoundOutlined, ThunderboltOutlined, AppstoreOutlined, ApiOutlined, CodeOutlined, FileMarkdownOutlined, DatabaseOutlined } from '@ant-design/icons';
import './embedded.css';
import '@/styles/settings.css';

// Static host context, using the production settings classes and container rules.
// It deliberately does not mount SettingsPanel, which owns real application state.
export function EmbeddedShell({ children }: { children: ReactNode }) {
  const basic = [[<SettingOutlined />, '常规'], [<GlobalOutlined />, '网络'], [<FontSizeOutlined />, '终端'], [<SoundOutlined />, '语音输入'], [<ThunderboltOutlined />, '快捷键']] as const;
  const agents = [[<RobotOutlined />, '智能体'], [<CodeOutlined />, 'Git'], [<AppstoreOutlined />, 'Skills'], [<ApiOutlined />, 'Hooks'], [<CodeOutlined />, 'MCP'], [<ThunderboltOutlined />, '快捷命令'], [<FileMarkdownOutlined />, '指令文件']] as const;
  return <div className="embedded-host">
    <div className="embedded-tabs" aria-label="Krosna 标签栏静态上下文"><span className="embedded-project-name">Termflow</span><span className="embedded-session-tab">完善智能体设置页…</span><span className="embedded-settings-tab"><SettingOutlined />设置</span><span className="embedded-add-tab">＋</span></div>
    <div className="embedded-workspace"><aside className="embedded-project-sidebar" aria-label="项目侧栏静态上下文"><strong>Termflow</strong><span className="embedded-sidebar-heading">项目资源</span><span>⌄ &nbsp; src</span><span className="embedded-file-indent">components</span><span className="embedded-file-indent">lib</span><span className="embedded-file-indent">styles</span><span>⌄ &nbsp; src-tauri</span><span>⌄ &nbsp; prototypes</span><div className="embedded-sidebar-bottom">本地工作区</div></aside>
      <div className="app-settings"><aside className="app-settings-nav" aria-label="设置导航静态上下文"><div className="embedded-settings-search">搜索设置</div><div className="app-settings-nav__group"><div className="app-settings-nav__group-title">基础设置</div>{basic.map(([icon, label]) => <div className="app-settings-nav__item" key={label}>{icon}<span className="app-settings-nav__label">{label}</span></div>)}</div><div className="app-settings-nav__group"><div className="app-settings-nav__group-title">智能体与扩展</div>{agents.map(([icon, label]) => <div className="app-settings-nav__item" aria-current={label === '智能体' ? 'page' : undefined} key={label}>{icon}<span className="app-settings-nav__label">{label}</span></div>)}</div><div className="app-settings-nav__group"><div className="app-settings-nav__group-title">数据</div><div className="app-settings-nav__item"><DatabaseOutlined /><span className="app-settings-nav__label">搜索索引</span></div></div></aside>
        <div className="app-settings-scroll"><div className="app-settings-content app-settings-content--wide refinement-content" data-settings-page="agents">{children}</div></div>
      </div>
    </div>
  </div>;
}

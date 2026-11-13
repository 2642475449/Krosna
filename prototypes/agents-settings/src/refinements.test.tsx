// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Prototype } from './App';

let host: HTMLDivElement;
let root: Root;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
async function click(element: Element) { await act(async () => { (element as HTMLElement).click(); }); }
async function design(value: string) { await click(document.querySelector(`.gallery-designs button:nth-child(${value.charCodeAt(0) - 64})`)!); }
beforeEach(async () => {
  window.history.replaceState(null, '', '/?stage=refine&theme=dark');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  await act(async () => { root.render(<Prototype />); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('content-only samples in the fixed Krosna host (DOM simulation)', () => {
  it('keeps host nodes and production theme unchanged when changing designs', async () => {
    const shell = document.querySelector('.embedded-host');
    const navigation = document.querySelector('.app-settings-nav');
    expect(document.querySelector('.app-settings-content--wide')).not.toBeNull();
    for (const value of ['A', 'B', 'C', 'D', 'E']) {
      await design(value);
      expect(document.querySelector('.embedded-host')).toBe(shell);
      expect(document.querySelector('.app-settings-nav')).toBe(navigation);
      expect(document.querySelector(`.refine-${value.toLowerCase()}`)).not.toBeNull();
      expect(document.documentElement.dataset.theme).toBe('dark-starry');
      expect(document.documentElement.style.getPropertyValue('--cs-primary')).toBe('');
      const content = document.querySelector('.refinement-content')!;
      expect(content.querySelector('h1')?.textContent).toBe('智能体');
      expect(content.textContent).toContain('Claude Code');
      expect(content.textContent).toContain('Codex');
      expect(content.textContent).not.toContain('Antigravity');
    }
  });
  it.each(['A', 'B', 'C', 'D', 'E'])('%s binds configuration changes to the shared command model', async value => {
    await design(value);
    const toggle = document.querySelector('.refinement-content [aria-label="claude 跳过权限审批"]')!;
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(document.querySelector('.refinement-content')?.textContent).toContain('自定义');
    expect(Array.from(document.querySelectorAll('.refinement-content .studio-command code')).some(code => code.textContent === 'claude')).toBe(true);
  });
  it('removes archived theme overrides on returning to the fixed host', async () => {
    const archive = Array.from(document.querySelectorAll('.gallery-actions button')).find(element => element.textContent === '上一轮')!;
    await click(archive); await design('B');
    expect(document.documentElement.style.getPropertyValue('--cs-primary')).not.toBe('');
    const back = Array.from(document.querySelectorAll('.gallery-actions button')).find(element => element.textContent === '局部样张')!;
    await click(back);
    expect(document.documentElement.style.getPropertyValue('--cs-primary')).toBe('');
    expect(document.querySelector('.embedded-host')).not.toBeNull();
  });
});

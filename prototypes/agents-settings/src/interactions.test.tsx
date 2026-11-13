// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Prototype } from './App';

let host: HTMLDivElement;
let root: Root;
const writeText = vi.fn<(value: string) => Promise<void>>();
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
function findButton(text: string, parent: ParentNode = document) {
  const target = Array.from(parent.querySelectorAll('button')).find(value => value.textContent?.replace(/\s/g, '').startsWith(text.replace(/\s/g, '')));
  if (!target) throw new Error(`Button missing: ${text}`);
  return target;
}
async function click(target: Element) { await act(async () => { (target as HTMLElement).click(); }); }
async function chooseDesign(value: string) { await click(document.querySelector(`.gallery-designs button:nth-child(${value.charCodeAt(0) - 64})`)!); }
async function showTools() { await click(findButton('设计说明')); }
async function setScenario(value: string) {
  const select = document.querySelector<HTMLSelectElement>('[aria-label="模拟场景"]')!;
  await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
}
beforeEach(async () => {
  window.history.replaceState(null, '', '/?stage=archive&theme=light');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  await act(async () => { root.render(<Prototype />); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

describe('five independently authored designs: DOM interaction simulation', () => {
  it('retains the default choice across five different page structures and both themes', async () => {
    await click(findButton('设为默认', document.querySelector('.da-entry')!));
    expect(document.querySelector('.da-default h2')?.textContent).toBe('Claude Code');
    await chooseDesign('B'); expect(document.querySelector('.db-favorite strong')?.textContent).toBe('Claude Code');
    await chooseDesign('C'); expect(document.querySelector('.dc-registry')?.textContent).toContain('默认：Claude Code');
    await chooseDesign('D'); expect(document.querySelector('.dd-primary-strip strong')?.textContent).toBe('Claude Code');
    await chooseDesign('E');
    const defaultItem = Array.from(document.querySelectorAll('.de-agent')).find(value => value.querySelector('em'));
    expect(defaultItem?.textContent).toContain('Claude Code');
    for (const variant of ['A', 'B', 'C', 'D', 'E']) {
      await chooseDesign(variant);
      expect(document.querySelector(`.design-${variant.toLowerCase()}`)).not.toBeNull();
      for (const agent of ['Claude Code', 'Codex', 'Antigravity CLI', 'OpenCode', 'Qoder CLI', 'Pi']) expect(document.querySelector('.studio-viewport')?.textContent).toContain(agent);
      await click(document.querySelector('[aria-label="切换暗色"]')!);
      expect(document.querySelector(`.design-${variant.toLowerCase()}`)?.getAttribute('data-mode')).toBe('dark');
      await click(document.querySelector('[aria-label="切换亮色"]')!);
    }
  });
  it('keeps real configuration semantics, command copying, and rejection recovery', async () => {
    await click(findButton('启动设置', document.querySelector('.da-entry')!));
    expect(document.querySelector('.da-inline-config code')?.textContent).toContain('--dangerously-skip-permissions');
    await click(document.querySelector('[aria-label="claude 跳过权限审批"]')!);
    expect(document.querySelector('.da-inline-config code')?.textContent).toBe('claude');
    expect(document.querySelector('.da-permission-current')?.textContent).toBe('自定义');
    await click(findButton('复制命令', document.querySelector('.da-inline-config')!));
    expect(writeText).toHaveBeenCalledWith('claude');
    writeText.mockRejectedValueOnce(new Error('Permission denied'));
    await click(findButton('复制命令', document.querySelector('.da-inline-config')!));
    expect(document.body.textContent).toContain('复制失败，请选中命令后手动复制');
  });
  it('preserves an unavailable default item in the catalogue and provides installation', async () => {
    const qoder = Array.from(document.querySelectorAll('.da-entry')).find(value => value.textContent?.includes('Qoder CLI'))!;
    await click(findButton('设为默认', qoder));
    await showTools(); await setScenario('uninstalled'); await chooseDesign('B');
    expect(document.querySelectorAll('.db-tool-slip')).toHaveLength(6);
    expect(document.querySelector('.db-favorite')?.textContent).toContain('默认工具尚未安装');
    const item = Array.from(document.querySelectorAll('.db-tool-slip')).find(value => value.textContent?.includes('Qoder CLI'))!;
    await click(findButton('模拟安装', item));
    expect(document.querySelector('.db-favorite')?.textContent).toContain('新会话将使用此智能体');
  });
  it('recovers loading, empty, and failed scenes and cancels a check on reset', async () => {
    vi.useFakeTimers(); await showTools();
    await setScenario('loading'); expect(document.querySelector('.studio-state')?.textContent).toContain('正在发现智能体');
    await click(findButton('完成模拟检查')); await act(async () => { vi.advanceTimersByTime(900); });
    expect(document.querySelector('.design-a')).not.toBeNull();
    await setScenario('empty'); expect(document.querySelector('.studio-state')?.textContent).toContain('尚未发现智能体');
    await click(findButton('重新检测')); await act(async () => { vi.advanceTimersByTime(900); });
    expect(document.querySelectorAll('.da-entry')).toHaveLength(6);
    await setScenario('failed'); expect(document.querySelector('.studio-alert')?.textContent).toContain('上次成功结果');
    await click(findButton('重新检查', document.querySelector('.studio-alert')!)); await act(async () => { vi.advanceTimersByTime(900); });
    expect(document.querySelector('.studio-alert')).toBeNull();
    await click(document.querySelector('.da-check')!); await click(findButton('重置模拟数据'));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(document.querySelector('.gallery-tools')?.textContent).toContain('检查完成 0 次');
  });
  it.each([
    ['A', '.da-permission-options button:nth-child(2)', '.da-identity button'],
    ['B', '.db-permission-options button:first-child', '.db-slip-actions button:first-child'],
    ['C', '.dc-policy-options button:first-child', '.dc-link'],
    ['D', '.dd-policy-options button:first-child', '.dd-detail-action'],
    ['E', '.de-policy-options button:first-child', '.de-detail-link'],
  ])('%s exposes working global permissions and complete details', async (variant, policy, detail) => {
    await chooseDesign(variant); await click(document.querySelector(policy)!); await click(document.querySelector(detail)!);
    expect(document.querySelector('.studio-inspector')).not.toBeNull();
    const select = document.querySelector<HTMLSelectElement>('[aria-label="切换详情智能体"]')!;
    await act(async () => { select.value = 'codex'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(document.querySelector('.studio-inspector [aria-label="codex Yolo 模式"]')?.getAttribute('aria-checked')).toBe('false');
    expect(document.querySelector('.studio-inspector .studio-command code')?.textContent).toBe('codex');
  });
});

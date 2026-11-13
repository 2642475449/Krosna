import { describe, expect, it } from 'vitest';
import { applyGlobalPermissionPreset, getAgentCommandPreview, getDefaultAgentLaunchOptions, getGlobalPermissionPreset } from '@/lib/agents';
import { changeConfig, changeScenario, createModel, finishCheck, visibleAgents } from './model';

describe('prototype configuration and scenario contracts', () => {
  it('switches a single agent to custom without changing other agents', () => {
    const model = changeConfig(createModel(0), 'codex', { yolo: false });
    expect(getGlobalPermissionPreset(model.permissions)).toBe('custom');
    expect(model.permissions.claude?.skipPermissions).toBe(true);
    expect(getAgentCommandPreview('codex', getDefaultAgentLaunchOptions('codex', model.permissions))).toBe('codex');
  });
  it('preserves reasoning choice when applying a global permission preset', () => {
    const model = changeConfig(createModel(0), 'claude', { effort: 'max' });
    const permissions = applyGlobalPermissionPreset(model.permissions, 'manual');
    expect(getAgentCommandPreview('claude', getDefaultAgentLaunchOptions('claude', permissions))).toBe('claude --effort max');
    expect(getGlobalPermissionPreset(permissions)).toBe('manual');
  });
  it('retains disabled Codex controls and uses them after turning Yolo off', () => {
    let model = changeConfig(createModel(0), 'codex', { approvalMode: 'never', sandboxMode: 'read-only', effort: 'high' });
    const preview = () => getAgentCommandPreview('codex', getDefaultAgentLaunchOptions('codex', model.permissions));
    expect(preview()).toBe('codex --dangerously-bypass-approvals-and-sandbox -c model_reasoning_effort=high');
    model = changeConfig(model, 'codex', { yolo: false });
    expect(preview()).toBe('codex --ask-for-approval never --sandbox read-only -c model_reasoning_effort=high');
  });
  it('retains data in failed and loading scenes; empty can recover', () => {
    const initial = createModel(123);
    const failed = changeScenario(initial, 'failed');
    expect(failed.agents).toEqual(initial.agents);
    expect(failed.checkedAt).toBe(123);
    expect(visibleAgents(changeScenario(initial, 'loading'))).toHaveLength(6);
    const empty = changeScenario(initial, 'empty');
    expect(visibleAgents(empty)).toHaveLength(0);
    const recovered = finishCheck(empty, 456);
    expect(visibleAgents(recovered)).toHaveLength(6);
    expect(recovered.checkedAt).toBe(456);
    expect(recovered.checks).toBe(1);
    expect(recovered.agents[1].remaining).toBe(75);
  });
  it('keeps scenario overrides isolated from underlying mock data', () => {
    const initial = createModel(0);
    expect(visibleAgents(changeScenario(initial, 'uninstalled')).filter(agent => !agent.installed).map(agent => agent.id)).toEqual(['qoder', 'pi']);
    expect(initial.agents.every(agent => agent.installed)).toBe(true);
    expect(visibleAgents(changeScenario(initial, 'normal')).every(agent => agent.installed)).toBe(true);
  });
  it('does not invent options for OpenCode or Pi', () => {
    const initial = createModel(0);
    expect(changeConfig(initial, 'opencode', { effort: 'high' })).toBe(initial);
    expect(changeConfig(initial, 'pi', { effort: 'high' })).toBe(initial);
  });
});

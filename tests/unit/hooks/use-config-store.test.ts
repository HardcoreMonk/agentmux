import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import useConfigStore from '@/hooks/use-config-store';

const fetchMock = vi.fn();

const lastPatchBody = () => JSON.parse(fetchMock.mock.calls.at(-1)?.[1].body as string);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetchMock);
  useConfigStore.getState().hydrate({});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useConfigStore agent terminal toggle', () => {
  it('defaults to showing the terminal', () => {
    expect(useConfigStore.getState().agentShowTerminal).toBe(true);
  });

  it('falls back to the legacy codexShowTerminal key', () => {
    useConfigStore.getState().hydrate({ codexShowTerminal: false });
    expect(useConfigStore.getState().agentShowTerminal).toBe(false);
  });

  it('prefers agentShowTerminal over the legacy key', () => {
    useConfigStore.getState().hydrate({ agentShowTerminal: true, codexShowTerminal: false });
    expect(useConfigStore.getState().agentShowTerminal).toBe(true);
    useConfigStore.getState().hydrate({ agentShowTerminal: false, codexShowTerminal: true });
    expect(useConfigStore.getState().agentShowTerminal).toBe(false);
  });

  it('writes only the new key', () => {
    useConfigStore.getState().setAgentShowTerminal(false);
    expect(useConfigStore.getState().agentShowTerminal).toBe(false);
    expect(lastPatchBody()).toEqual({ agentShowTerminal: false });
  });
});

describe('useConfigStore Claude settings', () => {
  it('hydrates Claude values with empty defaults', () => {
    expect(useConfigStore.getState().claudeModel).toBe('');
    expect(useConfigStore.getState().claudePermissionMode).toBe('');
    useConfigStore.getState().hydrate({ claudeModel: 'opus', claudePermissionMode: 'plan' });
    expect(useConfigStore.getState().claudeModel).toBe('opus');
    expect(useConfigStore.getState().claudePermissionMode).toBe('plan');
  });

  it('saves the model, and null when cleared', () => {
    useConfigStore.getState().setClaudeModel(' sonnet ');
    expect(useConfigStore.getState().claudeModel).toBe('sonnet');
    expect(lastPatchBody()).toEqual({ claudeModel: 'sonnet' });
    useConfigStore.getState().setClaudeModel('');
    expect(lastPatchBody()).toEqual({ claudeModel: null });
  });

  it('does not save or store an invalid model', () => {
    useConfigStore.getState().setClaudeModel('bad model');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useConfigStore.getState().claudeModel).toBe('');
  });

  it('saves the permission mode, and null when cleared', () => {
    useConfigStore.getState().setClaudePermissionMode('plan');
    expect(useConfigStore.getState().claudePermissionMode).toBe('plan');
    expect(lastPatchBody()).toEqual({ claudePermissionMode: 'plan' });
    useConfigStore.getState().setClaudePermissionMode('');
    expect(lastPatchBody()).toEqual({ claudePermissionMode: null });
  });
});

describe('useConfigStore delegation guide', () => {
  it('defaults to on, and hydrates an explicit false', () => {
    expect(useConfigStore.getState().agentDelegationGuideEnabled).toBe(true);
    useConfigStore.getState().hydrate({ agentDelegationGuideEnabled: false });
    expect(useConfigStore.getState().agentDelegationGuideEnabled).toBe(false);
    useConfigStore.getState().hydrate({});
    expect(useConfigStore.getState().agentDelegationGuideEnabled).toBe(true);
  });

  it('saves the toggle', () => {
    useConfigStore.getState().setAgentDelegationGuideEnabled(false);
    expect(useConfigStore.getState().agentDelegationGuideEnabled).toBe(false);
    expect(lastPatchBody()).toEqual({ agentDelegationGuideEnabled: false });
  });
});

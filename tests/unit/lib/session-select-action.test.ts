import { describe, expect, it } from 'vitest';
import { buildSessionListQuery, decideSessionSelectAction } from '@/lib/session-select-action';

describe('decideSessionSelectAction', () => {
  it('opens the session directly when the provider matches', () => {
    expect(decideSessionSelectAction({ tabPanelType: 'claude', itemProviderId: 'claude', agentProcess: true })).toBe('open');
    expect(decideSessionSelectAction({ tabPanelType: 'codex', itemProviderId: 'codex', agentProcess: false })).toBe('open');
  });

  it('blocks a different provider while an agent process is running', () => {
    expect(decideSessionSelectAction({ tabPanelType: 'codex', itemProviderId: 'claude', agentProcess: true })).toBe('blocked-running');
  });

  it('resumes with the other provider when no agent process is running', () => {
    expect(decideSessionSelectAction({ tabPanelType: 'codex', itemProviderId: 'claude', agentProcess: false })).toBe('resume-other-provider');
    expect(decideSessionSelectAction({ tabPanelType: 'terminal', itemProviderId: 'codex', agentProcess: false })).toBe('resume-other-provider');
  });
});

describe('buildSessionListQuery', () => {
  const base = { tmuxSession: 'pt-a', limit: 50, offset: 0, panelType: 'codex' as const };

  it('joins providers with a comma', () => {
    const params = buildSessionListQuery({ ...base, providers: ['codex', 'claude'] });
    expect(params.get('providers')).toBe('codex,claude');
    expect(buildSessionListQuery({ ...base, providers: ['claude'] }).get('providers')).toBe('claude');
  });

  it('omits the providers key when none are given', () => {
    expect(buildSessionListQuery(base).has('providers')).toBe(false);
    expect(buildSessionListQuery({ ...base, providers: [] }).has('providers')).toBe(false);
  });

  it('keeps the existing query values', () => {
    const params = buildSessionListQuery({ ...base, offset: 50, cwd: '/work' });
    expect(params.get('tmuxSession')).toBe('pt-a');
    expect(params.get('limit')).toBe('50');
    expect(params.get('offset')).toBe('50');
    expect(params.get('panelType')).toBe('codex');
    expect(params.get('cwd')).toBe('/work');
  });
});

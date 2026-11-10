import { describe, expect, it } from 'vitest';
import { getAgentLabel, getAgentProviderMeta } from '@/lib/agent-provider-meta';
import { AGENT_PANEL_TYPES } from '@/lib/panel-type';

describe('agent-provider-meta', () => {
  it('has metadata for every agent panel type', () => {
    for (const type of AGENT_PANEL_TYPES) expect(getAgentProviderMeta(type)?.panelType).toBe(type);
  });

  it('keeps the current Codex behavior values', () => {
    expect(getAgentProviderMeta('codex')).toEqual({
      panelType: 'codex',
      label: 'Codex',
      shortLabel: 'CODEX',
      configDir: '~/.codex',
      newTabCommand: 'codex-new',
      restartCommands: ['/new', '/clear'],
      exitCommand: '/exit',
      interruptSequence: '\x1b\x1b',
      keepTimelineOnSessionEnd: true,
    });
  });

  it('describes Claude Code', () => {
    expect(getAgentProviderMeta('claude')).toEqual({
      panelType: 'claude',
      label: 'Claude Code',
      shortLabel: 'CLAUDE',
      configDir: '~/.claude',
      newTabCommand: 'claude-new',
      restartCommands: ['/clear'],
      exitCommand: '/exit',
      interruptSequence: '\x1b',
      keepTimelineOnSessionEnd: true,
    });
  });

  it('resolves the label with a default-agent fallback', () => {
    expect(getAgentLabel('codex')).toBe('Codex');
    expect(getAgentLabel('claude')).toBe('Claude Code');
    expect(getAgentLabel(undefined)).toBe('Codex');
    expect(getAgentLabel('terminal')).toBe('Codex');
  });

  it('returns null for non-agent panels', () => {
    for (const type of ['terminal', 'diff', 'web-browser', 'future-agent', undefined]) {
      expect(getAgentProviderMeta(type)).toBeNull();
    }
  });
});

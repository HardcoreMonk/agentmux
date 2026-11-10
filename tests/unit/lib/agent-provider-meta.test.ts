import { describe, expect, it } from 'vitest';
import { getAgentProviderMeta } from '@/lib/agent-provider-meta';
import { AGENT_PANEL_TYPES } from '@/lib/panel-type';

describe('agent-provider-meta', () => {
  it('has metadata for every agent panel type', () => {
    for (const type of AGENT_PANEL_TYPES) expect(getAgentProviderMeta(type)?.panelType).toBe(type);
  });

  it('keeps the current Codex behavior values', () => {
    expect(getAgentProviderMeta('codex')).toEqual({
      panelType: 'codex',
      label: 'Codex',
      newTabCommand: 'codex-new',
      restartCommands: ['/new', '/clear'],
      exitCommand: '/exit',
      interruptSequence: '\x1b\x1b',
      keepTimelineOnSessionEnd: true,
    });
  });

  it('returns null for non-agent panels', () => {
    for (const type of ['terminal', 'diff', 'web-browser', 'claude', undefined]) {
      expect(getAgentProviderMeta(type)).toBeNull();
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  AGENT_PANEL_TYPES,
  DEFAULT_AGENT_PANEL_TYPE,
  PANEL_TYPES,
  isAgentPanelType,
  normalizePanelType,
} from '@/lib/panel-type';

describe('panel-type', () => {
  it('treats every AGENT_PANEL_TYPES entry as an agent panel and nothing else', () => {
    for (const type of AGENT_PANEL_TYPES) expect(isAgentPanelType(type)).toBe(true);
    for (const type of ['terminal', 'web-browser', 'diff', 'claude', '', null, undefined, 42]) {
      expect(isAgentPanelType(type)).toBe(false);
    }
  });

  it('normalizes an unregistered agent type to undefined', () => {
    expect(normalizePanelType('claude')).toBeUndefined();
    expect(normalizePanelType('codex')).toBe('codex');
  });

  it('lists every panel type exactly once', () => {
    expect(new Set(PANEL_TYPES).size).toBe(PANEL_TYPES.length);
    expect(PANEL_TYPES).toEqual(expect.arrayContaining(['terminal', 'web-browser', 'diff', ...AGENT_PANEL_TYPES]));
  });

  it('defaults to a registered agent type', () => {
    expect(AGENT_PANEL_TYPES).toContain(DEFAULT_AGENT_PANEL_TYPE);
  });
});

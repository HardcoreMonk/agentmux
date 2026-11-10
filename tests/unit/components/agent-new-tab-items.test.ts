import { describe, expect, it } from 'vitest';

import { AGENT_NEW_TAB_ITEMS, findAgentNewTabItemByCommand } from '@/lib/agent-new-tab-items';
import { AGENT_PANEL_TYPES } from '@/lib/panel-type';

describe('agent new tab items', () => {
  it('has codex-new and claude-new entries that start the agent', () => {
    const keys = AGENT_NEW_TAB_ITEMS.map((item) => item.key);
    expect(keys).toContain('codex-new');
    expect(keys).toContain('claude-new');
    expect(AGENT_NEW_TAB_ITEMS.every((item) => item.startAgent)).toBe(true);
  });

  it('covers every agent panel type with a text label', () => {
    expect(AGENT_NEW_TAB_ITEMS.map((item) => item.type)).toEqual([...AGENT_PANEL_TYPES]);
    expect(AGENT_NEW_TAB_ITEMS.find((item) => item.type === 'claude')?.label).toBe('Claude Code');
  });

  it('looks up an item by its new-tab command', () => {
    expect(findAgentNewTabItemByCommand('claude-new')?.type).toBe('claude');
    expect(findAgentNewTabItemByCommand('codex-new')?.type).toBe('codex');
    expect(findAgentNewTabItemByCommand('nope')).toBeUndefined();
    expect(findAgentNewTabItemByCommand(undefined)).toBeUndefined();
  });
});

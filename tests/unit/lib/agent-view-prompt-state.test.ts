import { describe, expect, it, vi } from 'vitest';

import {
  acceptAgentViewPrompt,
  createAgentViewPromptRegistry,
  shouldOfferAgentView,
} from '@/lib/agent-view-prompt-state';

describe('acceptAgentViewPrompt', () => {
  it('opens the timeline only when the switch was applied', () => {
    const setSessionView = vi.fn();
    const updateTabPanelType = vi.fn(() => true);
    const ok = acceptAgentViewPrompt(
      { updateTabPanelType, setSessionView },
      { paneId: 'p1', tabId: 't1', providerPanelType: 'claude' },
    );
    expect(ok).toBe(true);
    expect(updateTabPanelType).toHaveBeenCalledWith('p1', 't1', 'claude');
    expect(setSessionView).toHaveBeenCalledWith('t1', 'timeline');
  });

  it('does not touch the session view when the switch is refused', () => {
    const setSessionView = vi.fn();
    const ok = acceptAgentViewPrompt(
      { updateTabPanelType: () => false, setSessionView },
      { paneId: 'p1', tabId: 't1', providerPanelType: 'codex' },
    );
    expect(ok).toBe(false);
    expect(setSessionView).not.toHaveBeenCalled();
  });
});

describe('createAgentViewPromptRegistry', () => {
  it('remembers a dismissal per tab and provider', () => {
    const registry = createAgentViewPromptRegistry();
    expect(registry.isDismissed('t1', 'claude')).toBe(false);
    registry.dismiss('t1', 'claude');
    expect(registry.isDismissed('t1', 'claude')).toBe(true);
    expect(registry.isDismissed('t1', 'codex')).toBe(false);
    expect(registry.isDismissed('t2', 'claude')).toBe(false);
  });
});

describe('shouldOfferAgentView', () => {
  const base = { runtimeVersion: 1, panelType: 'terminal', providerPanelType: 'claude', dismissed: false } as const;

  it('offers for a v1 terminal tab with a detected provider', () => {
    expect(shouldOfferAgentView(base)).toBe(true);
    expect(shouldOfferAgentView({ ...base, runtimeVersion: undefined })).toBe(true);
  });

  it('does not offer for v2 tabs, agent tabs, no provider, or after dismissal', () => {
    expect(shouldOfferAgentView({ ...base, runtimeVersion: 2 })).toBe(false);
    expect(shouldOfferAgentView({ ...base, panelType: 'codex' })).toBe(false);
    expect(shouldOfferAgentView({ ...base, providerPanelType: null })).toBe(false);
    expect(shouldOfferAgentView({ ...base, dismissed: true })).toBe(false);
  });
});

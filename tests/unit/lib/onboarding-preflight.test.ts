import { describe, expect, it } from 'vitest';

import { nextAgentAction, pickReadyAgents } from '@/lib/onboarding-agents';
import type { IAgentPreflightStatus } from '@/types/preflight';

const ready = (): IAgentPreflightStatus => ({
  installed: true,
  version: '2.1.0',
  compatible: true,
  loggedIn: true,
});

const missing = (): IAgentPreflightStatus => ({
  installed: false,
  version: null,
  compatible: false,
  loggedIn: false,
});

describe('onboarding agents', () => {
  it('treats a Claude-only host as ready', () => {
    const agents = { claude: ready(), codex: missing() };
    expect(pickReadyAgents(agents)).toEqual(['claude']);
    expect(nextAgentAction(agents)).toBeNull();
  });

  it('lists every ready agent in panel order', () => {
    expect(pickReadyAgents({ claude: ready(), codex: ready() })).toEqual(['codex', 'claude']);
  });

  it('suggests installing the first agent when none is installed', () => {
    expect(nextAgentAction({ codex: missing(), claude: missing() }))
      .toEqual({ panelType: 'codex', action: 'install' });
  });

  it('suggests login for an installed but logged-out agent', () => {
    const agents = { codex: missing(), claude: { ...ready(), loggedIn: false } };
    expect(pickReadyAgents(agents)).toEqual([]);
    expect(nextAgentAction(agents)).toEqual({ panelType: 'claude', action: 'login' });
  });

  it('suggests the PATH step when the binary exists outside PATH', () => {
    const agents = { claude: { ...missing(), binaryPath: '/home/u/.local/bin' } };
    expect(nextAgentAction(agents)).toEqual({ panelType: 'claude', action: 'path' });
  });

  it('does not count an incompatible version as ready', () => {
    expect(pickReadyAgents({ claude: { ...ready(), compatible: false } })).toEqual([]);
  });
});

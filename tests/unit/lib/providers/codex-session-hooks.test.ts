import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/cli-token', () => ({ getCliToken: () => 'test-token' }));

import { buildCodexSessionHookConfigs } from '@/lib/providers/codex/session-hooks';

describe('Codex session hooks', () => {
  beforeEach(() => vi.useRealTimers());

  it('builds native session-layer handlers for POSIX and Windows', () => {
    const configs = buildCodexSessionHookConfigs({
      tabId: 'tab-a',
      sessionName: 'session-a',
      nodePath: 'C:\\Program Files\\node.exe',
    });
    expect(configs).toHaveLength(3);
    expect(configs[0]).toContain('hooks.SessionStart');
    expect(configs[0]).toContain('commandWindows=');
    expect(configs[0]).toContain('ELECTRON_RUN_AS_NODE=1');
    expect(configs[0]).toContain('set \\"ELECTRON_RUN_AS_NODE=1\\" &&');
    expect(configs[0]).toContain('timeout=3');
    expect(configs[1]).toContain('hooks.UserPromptSubmit');
    expect(configs[2]).toContain('hooks.Stop');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/cli-token', () => ({ getCliToken: () => 'test-token' }));

import { verifyAgentHookCapability } from '@/lib/agent-hooks';
import { CODEX_SESSION_HOOK_COUNT, CODEX_SESSION_HOOKS } from '@/lib/codex-session-hook-spec';
import {
  buildCodexHookEnvPrefix,
  buildCodexSessionHookConfigs,
  getCodexHookFingerprint,
} from '@/lib/providers/codex/session-hooks';

describe('Codex session hooks', () => {
  beforeEach(() => vi.useRealTimers());

  it('builds native session-layer handlers for POSIX and Windows', () => {
    const configs = buildCodexSessionHookConfigs({ nodePath: 'C:\\Program Files\\node.exe' });
    expect(configs).toHaveLength(3);
    expect(configs[0]).toContain('hooks.SessionStart');
    expect(configs[0]).toContain('commandWindows=');
    expect(configs[0]).toContain('ELECTRON_RUN_AS_NODE=1');
    expect(configs[0]).toContain('set \\"ELECTRON_RUN_AS_NODE=1\\" &&');
    expect(configs[0]).toContain('timeout=3');
    expect(configs[1]).toContain('hooks.UserPromptSubmit');
    expect(configs[2]).toContain('hooks.Stop');
  });

  it('builds the same commands on every call with no tab values', () => {
    const configs = buildCodexSessionHookConfigs();
    expect(buildCodexSessionHookConfigs()).toEqual(configs);
    const joined = configs.join('\n');
    expect(joined).not.toMatch(/\b(pt|tab)-/);
    expect(joined).not.toMatch(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
  });

  it('gives each tab its own hook env prefix', () => {
    const a = { tabId: 'tab-a', sessionName: 'pt-ws-pane-tab-a' };
    const b = { tabId: 'tab-b', sessionName: 'pt-ws-pane-tab-b' };
    const prefixA = buildCodexHookEnvPrefix(a);
    expect(prefixA).not.toBe(buildCodexHookEnvPrefix(b));
    expect(prefixA.startsWith(`AMUX_HOOK_SESSION='${a.sessionName}' AMUX_HOOK_CAPABILITY='`)).toBe(true);
    expect(prefixA.endsWith(' ')).toBe(true);
    for (const tab of [a, b]) {
      const capability = /AMUX_HOOK_CAPABILITY='([^']+)'/.exec(buildCodexHookEnvPrefix(tab))?.[1] ?? '';
      expect(capability).not.toBe('');
      expect(verifyAgentHookCapability(capability, tab.sessionName)).toMatchObject({ tabId: tab.tabId });
    }
  });

  it('adds the current hook fingerprint to the env prefix', () => {
    const prefix = buildCodexHookEnvPrefix({ tabId: 'tab-a', sessionName: 'pt-ws-pane-tab-a' });
    const fingerprint = /AMUX_HOOK_FINGERPRINT='([0-9a-f]+)'/.exec(prefix)?.[1];

    expect(fingerprint).toBe(getCodexHookFingerprint());
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps the hook count and order in the spec', () => {
    expect(CODEX_SESSION_HOOK_COUNT).toBe(3);
    const events = buildCodexSessionHookConfigs().map((config) => /^hooks\.(\w+)=/.exec(config)?.[1]);
    expect(events).toEqual(CODEX_SESSION_HOOKS.map((hook) => hook.event));
  });
});

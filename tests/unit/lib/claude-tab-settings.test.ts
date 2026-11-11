import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/cli-token', () => ({ getCliToken: () => 'test-token' }));

import { verifyAgentHookCapability } from '@/lib/agent-hooks';
import {
  CLAUDE_DELEGATION_ALLOW_RULES,
  getClaudeTabSettingsPath,
  removeClaudeTabSettings,
  writeClaudeTabSettings,
} from '@/lib/providers/claude/tab-settings';

interface IHookEntry {
  matcher: string;
  hooks: Array<{ type: string; command: string; async: boolean; timeout: number }>;
}

let home: string;

describe('claude tab settings', () => {
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmux-claude-tab-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(home, { recursive: true, force: true });
  });

  it('writes a private settings file under claude-tabs', async () => {
    const file = await writeClaudeTabSettings({ tabId: 'tab-a', sessionName: 'pt-ws-pane-tab-a', nodePath: '/usr/bin/node' });
    expect(file).toBe(getClaudeTabSettingsPath('tab-a'));
    expect(path.basename(path.dirname(file))).toBe('claude-tabs');
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(path.dirname(file))).mode & 0o777).toBe(0o700);
  });

  it('maps the seven hook events to bridge events', async () => {
    const file = await writeClaudeTabSettings({ tabId: 'tab-a', sessionName: 'pt-ws-pane-tab-a', nodePath: '/usr/bin/node' });
    const settings = JSON.parse(await fs.readFile(file, 'utf-8')) as {
      hooks: Record<string, IHookEntry[]>;
      statusLine: { type: string; command: string };
      permissions?: unknown;
    };
    const expected: Record<string, string> = {
      SessionStart: 'session-start',
      UserPromptSubmit: 'prompt-submit',
      Notification: 'notification',
      Stop: 'stop',
      StopFailure: 'stop',
      PreCompact: 'pre-compact',
      PostCompact: 'post-compact',
    };
    expect(Object.keys(settings.hooks).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, bridgeEvent] of Object.entries(expected)) {
      const [group] = settings.hooks[name];
      expect(group.matcher).toBe(name === 'SessionStart' ? 'startup|resume|clear|fork' : '');
      const [hook] = group.hooks;
      expect(hook).toMatchObject({ type: 'command', async: true, timeout: 3 });
      expect(hook.command.startsWith("ELECTRON_RUN_AS_NODE=1 '/usr/bin/node' ")).toBe(true);
      const args = hook.command.match(/'([^']*)'/g)!.map((value) => value.slice(1, -1));
      expect(args[2]).toBe(bridgeEvent);
      expect(args[3]).toBe('pt-ws-pane-tab-a');
      expect(verifyAgentHookCapability(args[4], 'pt-ws-pane-tab-a')?.tabId).toBe('tab-a');
    }
    expect(settings.statusLine.type).toBe('command');
    expect(settings.statusLine.command.startsWith('ELECTRON_RUN_AS_NODE=1 ')).toBe(true);
    expect(settings.statusLine.command).toContain('statusline.cjs');
    expect('permissions' in settings).toBe(false);
  });

  it('allows only the delegation tab subcommands', async () => {
    const file = await writeClaudeTabSettings({
      tabId: 'tab-a',
      sessionName: 'pt-ws-pane-tab-a',
      nodePath: '/usr/bin/node',
      allowDelegation: true,
    });
    const settings = JSON.parse(await fs.readFile(file, 'utf-8')) as { permissions?: { allow: string[] } };
    expect(settings.permissions).toEqual({ allow: [...CLAUDE_DELEGATION_ALLOW_RULES] });
    expect(CLAUDE_DELEGATION_ALLOW_RULES).toHaveLength(6);
    for (const rule of CLAUDE_DELEGATION_ALLOW_RULES) {
      expect(rule).toMatch(/^Bash\(agentmux tab (list|create|send|status|result|close):\*\)$/);
      expect(rule).not.toContain('tab browser');
    }
    expect(CLAUDE_DELEGATION_ALLOW_RULES).not.toContain('Bash(agentmux:*)');
    expect(CLAUDE_DELEGATION_ALLOW_RULES).not.toContain('Bash(agentmux tab:*)');
  });

  it('writes no permissions when delegation is off', async () => {
    const file = await writeClaudeTabSettings({
      tabId: 'tab-a',
      sessionName: 'pt-ws-pane-tab-a',
      nodePath: '/usr/bin/node',
      allowDelegation: false,
    });
    const settings = JSON.parse(await fs.readFile(file, 'utf-8')) as Record<string, unknown>;
    expect(Object.keys(settings)).toEqual(['hooks', 'statusLine']);
  });

  it('removes the settings file and tolerates a missing one', async () => {
    const file = await writeClaudeTabSettings({ tabId: 'tab-a', sessionName: 's' });
    await removeClaudeTabSettings('tab-a');
    await expect(fs.access(file)).rejects.toThrow();
    await expect(removeClaudeTabSettings('tab-a')).resolves.toBeUndefined();
  });
});

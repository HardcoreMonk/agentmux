import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readLayoutFile: vi.fn(),
  checkTerminalProcess: vi.fn(),
  sendKeys: vi.fn(),
  buildLaunchCommand: vi.fn(),
  buildResumeCommand: vi.fn(),
  writeTerminalSession: vi.fn(),
  getCachedRuntimePreflight: vi.fn(),
  updateTabAgentSession: vi.fn(),
  buildClaudeLaunchCommand: vi.fn(),
  createLaunchSessionId: vi.fn(),
  patchTab: vi.fn(),
  getSessionCwd: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock('@/lib/layout-store', () => ({
  readLayoutFile: mocks.readLayoutFile,
  resolveLayoutFile: (workspaceId: string) => `/layout/${workspaceId}.json`,
  updateTabAgentSession: mocks.updateTabAgentSession,
  patchTab: mocks.patchTab,
}));
vi.mock('@/lib/tmux', () => ({
  checkTerminalProcess: mocks.checkTerminalProcess,
  getSessionCwd: mocks.getSessionCwd,
  sendKeys: mocks.sendKeys,
}));
vi.mock('@/lib/config-store', () => ({ getConfig: mocks.getConfig }));
vi.mock('@/lib/cli-token', () => ({ getCliToken: () => 'test-token' }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
const codexTestProvider = {
  id: 'codex',
  panelType: 'codex',
  isValidSessionId: (value: unknown) => typeof value === 'string' && value.startsWith('session-'),
  buildLaunchCommand: mocks.buildLaunchCommand,
  buildResumeCommand: mocks.buildResumeCommand,
};
const claudeTestProvider = {
  id: 'claude',
  panelType: 'claude',
  isValidSessionId: (value: unknown) => typeof value === 'string' && value.startsWith('session-'),
  buildLaunchCommand: mocks.buildClaudeLaunchCommand,
  buildResumeCommand: mocks.buildResumeCommand,
  createLaunchSessionId: mocks.createLaunchSessionId,
};
vi.mock('@/lib/providers', () => ({
  getProviderByPanelType: (panelType: string) => {
    if (panelType === 'codex') return codexTestProvider;
    if (panelType === 'claude') return claudeTestProvider;
    return null;
  },
}));
vi.mock('@/lib/runtime/supervisor', () => ({
  getRuntimeSupervisor: () => ({ writeTerminalSession: mocks.writeTerminalSession }),
}));
vi.mock('@/lib/preflight', () => ({
  getCachedRuntimePreflight: mocks.getCachedRuntimePreflight,
}));

import { launchAgentInTab } from '@/lib/agent-launch-service';

const layout = (runtimeVersion: 1 | 2, panelType: 'codex' | 'claude' = 'codex') => ({
  activePaneId: 'pane-a',
  updatedAt: '2026-08-14T00:00:00.000Z',
  root: {
    type: 'pane' as const,
    id: 'pane-a',
    activeTabId: 'tab-a',
    tabs: [{
      id: 'tab-a',
      sessionName: 'pt-ws-a-pane-a-tab-a',
      name: '',
      order: 0,
      panelType,
      runtimeVersion,
      cwd: '/work/stored',
    }],
  },
});

describe('launchAgentInTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCachedRuntimePreflight.mockResolvedValue({
      agent: { installed: true, compatible: true, version: '0.147.0' },
      agents: {
        codex: { installed: true, compatible: true, version: '0.147.0' },
        claude: { installed: true, compatible: true, version: '2.1.322' },
      },
    });
    mocks.checkTerminalProcess.mockResolvedValue({ isSafe: true, processName: 'bash' });
    mocks.getSessionCwd.mockResolvedValue('/work/live');
    mocks.buildLaunchCommand.mockResolvedValue('codex -c hooks');
    mocks.updateTabAgentSession.mockResolvedValue(undefined);
    mocks.patchTab.mockResolvedValue({});
    mocks.createLaunchSessionId.mockReturnValue('session-claude-1');
    mocks.buildClaudeLaunchCommand.mockImplementation(async (options: { sessionId?: string }) =>
      `claude --session-id ${options.sessionId}`);
  });

  it('validates ownership and sends a server-built command to a legacy tab', async () => {
    mocks.readLayoutFile.mockResolvedValue(layout(1));
    await expect(launchAgentInTab({
      workspaceId: 'ws-a',
      paneId: 'pane-a',
      tabId: 'tab-a',
      action: 'launch',
    })).resolves.toEqual({ ok: true });
    expect(mocks.buildLaunchCommand).toHaveBeenCalledWith({
      workspaceId: 'ws-a',
      tabId: 'tab-a',
      sessionName: 'pt-ws-a-pane-a-tab-a',
      cwd: '/work/live',
    });
    expect(mocks.getSessionCwd).toHaveBeenCalledWith('pt-ws-a-pane-a-tab-a');
    expect(mocks.sendKeys).toHaveBeenCalledWith('pt-ws-a-pane-a-tab-a', 'codex -c hooks');
    expect(mocks.updateTabAgentSession).not.toHaveBeenCalled();
  });

  it('falls back to the stored tab cwd when tmux does not know it', async () => {
    mocks.readLayoutFile.mockResolvedValue(layout(1));
    mocks.getSessionCwd.mockResolvedValue(null);
    await launchAgentInTab({ workspaceId: 'ws-a', paneId: 'pane-a', tabId: 'tab-a', action: 'launch' });
    expect(mocks.buildLaunchCommand).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/work/stored' }));
  });

  it('builds, then stores the assigned Claude session id, then sends the launch command', async () => {
    mocks.readLayoutFile.mockResolvedValue(layout(1, 'claude'));
    await expect(launchAgentInTab({
      workspaceId: 'ws-a',
      paneId: 'pane-a',
      tabId: 'tab-a',
      action: 'launch',
    })).resolves.toEqual({ ok: true });

    expect(mocks.updateTabAgentSession).toHaveBeenCalledWith(
      'pt-ws-a-pane-a-tab-a',
      claudeTestProvider,
      { sessionId: 'session-claude-1', jsonlPath: null },
    );
    expect(mocks.buildClaudeLaunchCommand).toHaveBeenCalledWith({
      workspaceId: 'ws-a',
      tabId: 'tab-a',
      sessionName: 'pt-ws-a-pane-a-tab-a',
      cwd: '/work/live',
      sessionId: 'session-claude-1',
    });
    expect(mocks.sendKeys).toHaveBeenCalledWith('pt-ws-a-pane-a-tab-a', 'claude --session-id session-claude-1');
    const builtAt = mocks.buildClaudeLaunchCommand.mock.invocationCallOrder[0];
    const storedAt = mocks.updateTabAgentSession.mock.invocationCallOrder[0];
    expect(builtAt).toBeLessThan(storedAt);
    expect(storedAt).toBeLessThan(mocks.sendKeys.mock.invocationCallOrder[0]);
  });

  it('stores nothing and sends nothing when building the Claude command fails', async () => {
    mocks.readLayoutFile.mockResolvedValue(layout(1, 'claude'));
    mocks.buildClaudeLaunchCommand.mockRejectedValue(new Error('settings write failed'));

    await expect(launchAgentInTab({
      workspaceId: 'ws-a',
      paneId: 'pane-a',
      tabId: 'tab-a',
      action: 'launch',
    })).rejects.toThrow('settings write failed');
    expect(mocks.updateTabAgentSession).not.toHaveBeenCalled();
    expect(mocks.sendKeys).not.toHaveBeenCalled();
  });

  it('does not assign a new Claude session id when resuming', async () => {
    mocks.readLayoutFile.mockResolvedValue(layout(1, 'claude'));
    mocks.buildResumeCommand.mockResolvedValue('claude --resume session-old');
    await expect(launchAgentInTab({
      workspaceId: 'ws-a',
      paneId: 'pane-a',
      tabId: 'tab-a',
      action: 'resume',
      sessionId: 'session-old',
    })).resolves.toEqual({ ok: true });

    expect(mocks.createLaunchSessionId).not.toHaveBeenCalled();
    // Resume binds the session first, like the new-tab and WS resume paths.
    expect(mocks.updateTabAgentSession).toHaveBeenCalledWith(
      'pt-ws-a-pane-a-tab-a',
      claudeTestProvider,
      { sessionId: 'session-old', jsonlPath: null },
    );
    expect(mocks.patchTab).not.toHaveBeenCalled();
    expect(mocks.sendKeys).toHaveBeenCalledWith('pt-ws-a-pane-a-tab-a', 'claude --resume session-old');
  });

  it('uses the internal Runtime v2 write boundary for a ready tab', async () => {
    mocks.readLayoutFile.mockResolvedValue(layout(2));
    await launchAgentInTab({
      workspaceId: 'ws-a',
      paneId: 'pane-a',
      tabId: 'tab-a',
      action: 'launch',
    });
    expect(mocks.writeTerminalSession).toHaveBeenCalledWith({
      sessionName: 'pt-ws-a-pane-a-tab-a',
      data: 'codex -c hooks\r',
    });
    expect(mocks.sendKeys).not.toHaveBeenCalled();
    expect(mocks.getSessionCwd).not.toHaveBeenCalled();
    expect(mocks.buildLaunchCommand).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/work/stored' }));
  });

  it('blocks unsafe legacy processes and unsupported Codex versions', async () => {
    mocks.readLayoutFile.mockResolvedValue(layout(1));
    mocks.checkTerminalProcess.mockResolvedValue({ isSafe: false, processName: 'vim' });
    await expect(launchAgentInTab({
      workspaceId: 'ws-a', paneId: 'pane-a', tabId: 'tab-a', action: 'launch',
    })).resolves.toMatchObject({ ok: false, code: 'unsafe-process' });

    mocks.getCachedRuntimePreflight.mockResolvedValue({
      agent: { installed: true, compatible: false, version: '0.143.0' },
      agents: { codex: { installed: true, compatible: false, version: '0.143.0' } },
    });
    await expect(launchAgentInTab({
      workspaceId: 'ws-a', paneId: 'pane-a', tabId: 'tab-a', action: 'launch',
    })).resolves.toMatchObject({ ok: false, code: 'agent-unavailable' });
  });

  it('rejects a claude tab with agent-unavailable when only Codex is installed', async () => {
    mocks.getCachedRuntimePreflight.mockResolvedValue({
      agent: { installed: true, compatible: true, version: '0.147.0' },
      agents: { codex: { installed: true, compatible: true, version: '0.147.0' } },
    });
    mocks.readLayoutFile.mockResolvedValue(layout(2, 'claude'));
    await expect(launchAgentInTab({
      workspaceId: 'ws-a', paneId: 'pane-a', tabId: 'tab-a', action: 'launch',
    })).resolves.toMatchObject({ ok: false, code: 'agent-unavailable' });
    expect(mocks.writeTerminalSession).not.toHaveBeenCalled();
  });

  it('launches a claude tab on a host without Codex', async () => {
    mocks.getCachedRuntimePreflight.mockResolvedValue({
      agent: { installed: false, version: null },
      agents: {
        codex: { installed: false, version: null },
        claude: { installed: true, compatible: true, version: '2.1.322' },
      },
    });
    mocks.readLayoutFile.mockResolvedValue(layout(2, 'claude'));
    await expect(launchAgentInTab({
      workspaceId: 'ws-a', paneId: 'pane-a', tabId: 'tab-a', action: 'launch',
    })).resolves.toEqual({ ok: true });
  });

  describe('with the real Claude provider', () => {
    const claudeSessionId = '11111111-2222-4333-8444-555555555555';
    let root: string;

    beforeEach(async () => {
      root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmux-launch-service-'));
      vi.stubEnv('HOME', root);
      vi.stubEnv('AGENTMUX_DATA_DIR', path.join(root, 'data'));
      const { claudeProvider } = await vi.importActual<typeof import('@/lib/providers/claude')>(
        '@/lib/providers/claude',
      );
      mocks.buildClaudeLaunchCommand.mockImplementation(claudeProvider.buildLaunchCommand);
      mocks.createLaunchSessionId.mockReturnValue(claudeSessionId);
      mocks.readLayoutFile.mockResolvedValue(layout(1, 'claude'));
    });

    afterEach(async () => {
      vi.unstubAllEnvs();
      await fs.rm(root, { recursive: true, force: true });
    });

    it('sends the tab id env var when delegation is on', async () => {
      mocks.getConfig.mockResolvedValue({});
      await expect(launchAgentInTab({
        workspaceId: 'ws-a', paneId: 'pane-a', tabId: 'tab-a', action: 'launch',
      })).resolves.toEqual({ ok: true });
      const [, command] = mocks.sendKeys.mock.calls[0] as [string, string];
      expect(command).toContain("AMUX_TAB_ID='tab-a'");
      expect(command).toContain(`--session-id ${claudeSessionId}`);
    });

    it('sends no tab id env var when delegation is off', async () => {
      mocks.getConfig.mockResolvedValue({ agentDelegationGuideEnabled: false });
      await expect(launchAgentInTab({
        workspaceId: 'ws-a', paneId: 'pane-a', tabId: 'tab-a', action: 'launch',
      })).resolves.toEqual({ ok: true });
      const [, command] = mocks.sendKeys.mock.calls[0] as [string, string];
      expect(command).not.toContain('AMUX_TAB_ID');
      expect(command.startsWith('claude --settings ')).toBe(true);
    });
  });

  describe('switching provider on resume', () => {
    const resumeInput = {
      workspaceId: 'ws-a',
      paneId: 'pane-a',
      tabId: 'tab-a',
      action: 'resume' as const,
      sessionId: 'session-old',
    };

    it('patches the tab, binds the session, then sends the target provider resume command', async () => {
      mocks.readLayoutFile.mockResolvedValue(layout(1, 'codex'));
      mocks.buildResumeCommand.mockResolvedValue('claude --resume session-old');
      await expect(launchAgentInTab({ ...resumeInput, panelType: 'claude' })).resolves.toEqual({ ok: true });

      expect(mocks.patchTab).toHaveBeenCalledWith('ws-a', 'pane-a', 'tab-a', { panelType: 'claude' });
      expect(mocks.updateTabAgentSession).toHaveBeenCalledWith(
        'pt-ws-a-pane-a-tab-a',
        claudeTestProvider,
        { sessionId: 'session-old', jsonlPath: null },
      );
      expect(mocks.sendKeys).toHaveBeenCalledWith('pt-ws-a-pane-a-tab-a', 'claude --resume session-old');
      const builtAt = mocks.buildResumeCommand.mock.invocationCallOrder[0];
      const patchedAt = mocks.patchTab.mock.invocationCallOrder[0];
      const boundAt = mocks.updateTabAgentSession.mock.invocationCallOrder[0];
      expect(builtAt).toBeLessThan(patchedAt);
      expect(patchedAt).toBeLessThan(boundAt);
      expect(boundAt).toBeLessThan(mocks.sendKeys.mock.invocationCallOrder[0]);
    });

    it('leaves the tab untouched when building the resume command fails', async () => {
      mocks.readLayoutFile.mockResolvedValue(layout(1, 'codex'));
      mocks.buildResumeCommand.mockRejectedValue(new Error('settings write failed'));
      await expect(launchAgentInTab({ ...resumeInput, panelType: 'claude' })).rejects.toThrow('settings write failed');

      expect(mocks.patchTab).not.toHaveBeenCalled();
      expect(mocks.updateTabAgentSession).not.toHaveBeenCalled();
      expect(mocks.sendKeys).not.toHaveBeenCalled();
    });

    it('binds the session before sending even when the provider stays the same', async () => {
      mocks.readLayoutFile.mockResolvedValue(layout(1, 'codex'));
      mocks.buildResumeCommand.mockResolvedValue('codex resume session-old');
      await expect(launchAgentInTab({ ...resumeInput, panelType: 'codex' })).resolves.toEqual({ ok: true });
      expect(mocks.patchTab).not.toHaveBeenCalled();
      expect(mocks.updateTabAgentSession.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.sendKeys.mock.invocationCallOrder[0]);
    });

    it('rejects a provider switch on a Runtime v2 tab without side effects', async () => {
      mocks.readLayoutFile.mockResolvedValue(layout(2, 'codex'));
      await expect(launchAgentInTab({ ...resumeInput, panelType: 'claude' }))
        .resolves.toMatchObject({ ok: false, code: 'runtime-v2-agent-unsupported' });
      expect(mocks.patchTab).not.toHaveBeenCalled();
      expect(mocks.updateTabAgentSession).not.toHaveBeenCalled();
      expect(mocks.sendKeys).not.toHaveBeenCalled();
      expect(mocks.writeTerminalSession).not.toHaveBeenCalled();
    });

    it('does not change the tab when an unsafe process is running', async () => {
      mocks.readLayoutFile.mockResolvedValue(layout(1, 'codex'));
      mocks.checkTerminalProcess.mockResolvedValue({ isSafe: false, processName: 'codex' });
      await expect(launchAgentInTab({ ...resumeInput, panelType: 'claude' }))
        .resolves.toMatchObject({ ok: false, code: 'unsafe-process' });
      expect(mocks.patchTab).not.toHaveBeenCalled();
      expect(mocks.updateTabAgentSession).not.toHaveBeenCalled();
    });

    it('validates the session id against the target provider before patching', async () => {
      mocks.readLayoutFile.mockResolvedValue(layout(1, 'codex'));
      await expect(launchAgentInTab({ ...resumeInput, sessionId: 'bad-id', panelType: 'claude' }))
        .resolves.toMatchObject({ ok: false, code: 'invalid-session' });
      expect(mocks.patchTab).not.toHaveBeenCalled();
      expect(mocks.sendKeys).not.toHaveBeenCalled();
    });
  });
});

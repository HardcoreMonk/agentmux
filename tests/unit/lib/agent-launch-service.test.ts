import { beforeEach, describe, expect, it, vi } from 'vitest';

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
}));

vi.mock('@/lib/layout-store', () => ({
  readLayoutFile: mocks.readLayoutFile,
  resolveLayoutFile: (workspaceId: string) => `/layout/${workspaceId}.json`,
  updateTabAgentSession: mocks.updateTabAgentSession,
}));
vi.mock('@/lib/tmux', () => ({
  checkTerminalProcess: mocks.checkTerminalProcess,
  sendKeys: mocks.sendKeys,
}));
const codexTestProvider = {
  id: 'codex-test',
  panelType: 'codex',
  isValidSessionId: (value: unknown) => typeof value === 'string' && value.startsWith('session-'),
  buildLaunchCommand: mocks.buildLaunchCommand,
  buildResumeCommand: mocks.buildResumeCommand,
};
const claudeTestProvider = {
  id: 'claude-test',
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
    }],
  },
});

describe('launchAgentInTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCachedRuntimePreflight.mockResolvedValue({
      agent: { installed: true, compatible: true, version: '0.147.0' },
    });
    mocks.checkTerminalProcess.mockResolvedValue({ isSafe: true, processName: 'bash' });
    mocks.buildLaunchCommand.mockResolvedValue('codex -c hooks');
    mocks.updateTabAgentSession.mockResolvedValue(undefined);
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
    });
    expect(mocks.sendKeys).toHaveBeenCalledWith('pt-ws-a-pane-a-tab-a', 'codex -c hooks');
    expect(mocks.updateTabAgentSession).not.toHaveBeenCalled();
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
    expect(mocks.updateTabAgentSession).not.toHaveBeenCalled();
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
  });

  it('blocks unsafe legacy processes and unsupported Codex versions', async () => {
    mocks.readLayoutFile.mockResolvedValue(layout(1));
    mocks.checkTerminalProcess.mockResolvedValue({ isSafe: false, processName: 'vim' });
    await expect(launchAgentInTab({
      workspaceId: 'ws-a', paneId: 'pane-a', tabId: 'tab-a', action: 'launch',
    })).resolves.toMatchObject({ ok: false, code: 'unsafe-process' });

    mocks.getCachedRuntimePreflight.mockResolvedValue({
      agent: { installed: true, compatible: false, version: '0.143.0' },
    });
    await expect(launchAgentInTab({
      workspaceId: 'ws-a', paneId: 'pane-a', tabId: 'tab-a', action: 'launch',
    })).resolves.toMatchObject({ ok: false, code: 'codex-update-required' });
  });
});

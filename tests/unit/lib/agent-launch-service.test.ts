import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readLayoutFile: vi.fn(),
  checkTerminalProcess: vi.fn(),
  sendKeys: vi.fn(),
  buildLaunchCommand: vi.fn(),
  buildResumeCommand: vi.fn(),
  writeTerminalSession: vi.fn(),
  getCachedRuntimePreflight: vi.fn(),
}));

vi.mock('@/lib/layout-store', () => ({
  readLayoutFile: mocks.readLayoutFile,
  resolveLayoutFile: (workspaceId: string) => `/layout/${workspaceId}.json`,
}));
vi.mock('@/lib/tmux', () => ({
  checkTerminalProcess: mocks.checkTerminalProcess,
  sendKeys: mocks.sendKeys,
}));
vi.mock('@/lib/providers', () => ({
  getProviderByPanelType: (panelType: string) => panelType === 'codex' ? {
    id: 'codex-test',
    panelType: 'codex',
    isValidSessionId: (value: unknown) => typeof value === 'string' && value.startsWith('session-'),
    buildLaunchCommand: mocks.buildLaunchCommand,
    buildResumeCommand: mocks.buildResumeCommand,
  } : null,
}));
vi.mock('@/lib/runtime/supervisor', () => ({
  getRuntimeSupervisor: () => ({ writeTerminalSession: mocks.writeTerminalSession }),
}));
vi.mock('@/lib/preflight', () => ({
  getCachedRuntimePreflight: mocks.getCachedRuntimePreflight,
}));

import { launchAgentInTab } from '@/lib/agent-launch-service';

const layout = (runtimeVersion: 1 | 2) => ({
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
      panelType: 'codex' as const,
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

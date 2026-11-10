import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const supervisor = {
    ensureStarted: vi.fn(),
    deleteTerminalTab: vi.fn(),
  };
  return {
    killSession: vi.fn(),
    getRuntimeSupervisor: vi.fn(() => supervisor),
    supervisor,
    writeClaudeTabSettings: vi.fn(),
    removeClaudeTabSettings: vi.fn(),
  };
});

vi.mock('@/lib/tmux', () => ({
  killSession: mocks.killSession,
}));

vi.mock('@/lib/runtime/supervisor', () => ({
  getRuntimeSupervisor: mocks.getRuntimeSupervisor,
}));

vi.mock('@/lib/providers/claude/tab-settings', () => ({
  writeClaudeTabSettings: mocks.writeClaudeTabSettings,
  removeClaudeTabSettings: mocks.removeClaudeTabSettings,
}));

import { cleanupTabSession } from '@/lib/tab-session-cleanup';

describe('tab session cleanup', () => {
  beforeEach(() => {
    mocks.killSession.mockClear();
    mocks.getRuntimeSupervisor.mockClear();
    mocks.supervisor.ensureStarted.mockClear();
    mocks.supervisor.deleteTerminalTab.mockClear();
    mocks.removeClaudeTabSettings.mockReset();
    mocks.removeClaudeTabSettings.mockResolvedValue(undefined);
  });

  it('kills legacy terminal sessions through the legacy tmux socket', async () => {
    await cleanupTabSession({
      id: 'tab-legacy',
      sessionName: 'pt-ws-a-pane-b-tab-legacy',
      runtimeVersion: 1,
    });

    expect(mocks.killSession).toHaveBeenCalledWith('pt-ws-a-pane-b-tab-legacy');
    expect(mocks.getRuntimeSupervisor).not.toHaveBeenCalled();
  });

  it('deletes runtime v2 terminal tabs through the runtime supervisor', async () => {
    await cleanupTabSession({
      id: 'tab-runtime',
      sessionName: 'rtv2-ws-a-pane-b-tab-runtime',
      panelType: 'terminal',
      runtimeVersion: 2,
    });

    expect(mocks.supervisor.ensureStarted).toHaveBeenCalled();
    expect(mocks.supervisor.deleteTerminalTab).toHaveBeenCalledWith('tab-runtime');
    expect(mocks.killSession).not.toHaveBeenCalledWith('rtv2-ws-a-pane-b-tab-runtime');
  });

  it('does not clean up web browser tabs', async () => {
    await cleanupTabSession({
      id: 'tab-web',
      sessionName: 'pt-ws-a-pane-b-tab-web',
      panelType: 'web-browser',
    });

    expect(mocks.killSession).not.toHaveBeenCalledWith('pt-ws-a-pane-b-tab-web');
    expect(mocks.getRuntimeSupervisor).not.toHaveBeenCalled();
  });

  it('removes the per-tab Claude settings after killing a Claude tab', async () => {
    await cleanupTabSession({
      id: 'tab-claude',
      sessionName: 'pt-ws-a-pane-b-tab-claude',
      panelType: 'claude',
      runtimeVersion: 1,
    });

    expect(mocks.killSession).toHaveBeenCalledWith('pt-ws-a-pane-b-tab-claude');
    expect(mocks.removeClaudeTabSettings).toHaveBeenCalledWith('tab-claude');
    expect(mocks.killSession.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.removeClaudeTabSettings.mock.invocationCallOrder[0]);
  });

  it('only logs when provider tab cleanup fails', async () => {
    mocks.removeClaudeTabSettings.mockRejectedValue(new Error('disk gone'));

    await expect(cleanupTabSession({
      id: 'tab-claude',
      sessionName: 'pt-ws-a-pane-b-tab-claude',
      panelType: 'claude',
      runtimeVersion: 1,
    })).resolves.toBeUndefined();
    expect(mocks.removeClaudeTabSettings).toHaveBeenCalledWith('tab-claude');
  });

  it('does not touch Claude settings for Codex tabs', async () => {
    await cleanupTabSession({
      id: 'tab-codex',
      sessionName: 'pt-ws-a-pane-b-tab-codex',
      panelType: 'codex',
      runtimeVersion: 1,
    });

    expect(mocks.killSession).toHaveBeenCalledWith('pt-ws-a-pane-b-tab-codex');
    expect(mocks.removeClaudeTabSettings).not.toHaveBeenCalled();
  });
});

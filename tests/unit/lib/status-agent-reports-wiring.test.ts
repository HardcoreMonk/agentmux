import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IAgentReportServiceLike } from '@/lib/agent-report-service';

const layoutMocks = vi.hoisted(() => ({
  readLayoutFile: vi.fn(async () => null),
  updateTabAgentSessionId: vi.fn(async () => undefined),
  updateTabAgentJsonlPath: vi.fn(async () => undefined),
  updateTabCliStatus: vi.fn(async () => undefined),
}));

const configMocks = vi.hoisted(() => ({
  getConfig: vi.fn(async () => ({
    agentDelegationGuideEnabled: true,
    agentReportsEnabled: true,
  })),
}));

const workspaceMocks = vi.hoisted(() => ({
  getWorkspaces: vi.fn(async () => ({
    workspaces: [{ id: 'ws-1', name: 'WS 1', path: '/tmp/ws1' }],
  })),
}));

vi.mock('@/lib/config-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/config-store')>();
  return {
    ...actual,
    getConfig: configMocks.getConfig,
  };
});

vi.mock('@/lib/workspace-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspace-store')>();
  return {
    ...actual,
    getWorkspaces: workspaceMocks.getWorkspaces,
  };
});

vi.mock('@/lib/layout-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/layout-store')>();
  return {
    ...actual,
    readLayoutFile: layoutMocks.readLayoutFile,
    updateTabAgentSessionId: layoutMocks.updateTabAgentSessionId,
    updateTabAgentJsonlPath: layoutMocks.updateTabAgentJsonlPath,
    updateTabCliStatus: layoutMocks.updateTabCliStatus,
  };
});

vi.mock('@/lib/rate-limits-watcher', () => ({
  createRateLimitsWatcher: () => ({ start: vi.fn(), stop: vi.fn() }),
}));

import { StatusManager } from '@/lib/status-manager';

const makeFakeAgentReports = () => ({
  onChildStateChange: vi.fn<IAgentReportServiceLike['onChildStateChange']>(async () => undefined),
  flush: vi.fn<IAgentReportServiceLike['flush']>(async () => 'empty' as const),
  onPromptSubmit: vi.fn<IAgentReportServiceLike['onPromptSubmit']>(() => 'human' as const),
  onTabRemoved: vi.fn<IAgentReportServiceLike['onTabRemoved']>(() => undefined),
  tick: vi.fn<IAgentReportServiceLike['tick']>(async () => undefined),
  reset: vi.fn<IAgentReportServiceLike['reset']>(() => undefined),
});

describe('StatusManager agentReports wiring', () => {
  beforeEach(() => {
    layoutMocks.readLayoutFile.mockClear();
    layoutMocks.updateTabAgentSessionId.mockClear();
    layoutMocks.updateTabAgentJsonlPath.mockClear();
    layoutMocks.updateTabCliStatus.mockClear();
    configMocks.getConfig.mockClear();
    workspaceMocks.getWorkspaces.mockClear();
  });

  it('calls onChildStateChange and flush when a child transitions to ready-for-review', () => {
    const broadcast = vi.fn();
    const agentReports = makeFakeAgentReports();
    const manager = new StatusManager({ broadcast, enableRateLimits: false, agentReports });

    manager.registerTab('tab-child', {
      cliState: 'busy',
      workspaceId: 'ws-1',
      tabName: 'Child',
      tmuxSession: 'pt-ws-1-pane-1-tab-child',
      panelType: 'claude',
      lastEvent: null,
      eventSeq: 0,
    });

    manager.updateTabFromHook('pt-ws-1-pane-1-tab-child', 'stop');

    expect(agentReports.onChildStateChange).toHaveBeenCalledWith(
      'tab-child',
      'ready-for-review',
      expect.objectContaining({ silent: undefined, completionKey: undefined }),
    );
    expect(agentReports.flush).toHaveBeenCalledWith('tab-child');
  });

  it('calls flush when a parent tab transitions to idle via dismissTab', () => {
    const broadcast = vi.fn();
    const agentReports = makeFakeAgentReports();
    const manager = new StatusManager({ broadcast, enableRateLimits: false, agentReports });

    manager.registerTab('tab-parent', {
      cliState: 'ready-for-review',
      workspaceId: 'ws-1',
      tabName: 'Parent',
      tmuxSession: 'pt-ws-1-pane-1-tab-parent',
      panelType: 'claude',
      lastEvent: { name: 'stop', at: 1000, seq: 1 },
      eventSeq: 1,
    });

    manager.dismissTab('tab-parent');

    expect(agentReports.flush).toHaveBeenCalledWith('tab-parent');
  });

  it('calls onPromptSubmit on prompt-submit hook and clears agentReportNotice when human', () => {
    const broadcast = vi.fn();
    const agentReports = makeFakeAgentReports();
    agentReports.onPromptSubmit.mockReturnValue('human');
    const manager = new StatusManager({ broadcast, enableRateLimits: false, agentReports });

    manager.registerTab('tab-parent', {
      cliState: 'busy',
      workspaceId: 'ws-1',
      tabName: 'Parent',
      tmuxSession: 'pt-ws-1-pane-1-tab-parent',
      panelType: 'claude',
      lastEvent: null,
      eventSeq: 0,
      agentReportNotice: { kind: 'paused', count: 2, at: 1000 },
    });
    broadcast.mockClear();

    manager.updateTabFromHook('pt-ws-1-pane-1-tab-parent', 'prompt-submit');

    expect(agentReports.onPromptSubmit).toHaveBeenCalledWith('tab-parent');
    expect(manager.getAllForClient()['tab-parent']?.agentReportNotice).toBeNull();
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'status:update',
        tabId: 'tab-parent',
        agentReportNotice: null,
      }),
      undefined,
    );
  });

  it('calls onTabRemoved when removeTab removes a tab', () => {
    const broadcast = vi.fn();
    const agentReports = makeFakeAgentReports();
    const manager = new StatusManager({ broadcast, enableRateLimits: false, agentReports });

    manager.registerTab('tab-child', {
      cliState: 'idle',
      workspaceId: 'ws-1',
      tabName: 'Child',
      tmuxSession: 'pt-ws-1-pane-1-tab-child',
      panelType: 'claude',
      lastEvent: null,
      eventSeq: 0,
    });

    expect(manager.removeTab('tab-child')).toBe(true);
    expect(agentReports.onTabRemoved).toHaveBeenCalledWith('tab-child');
  });

  it('disables default agent report delivery when the delegation guide is off even if agentReportsEnabled is true', async () => {
    configMocks.getConfig.mockResolvedValue({
      agentDelegationGuideEnabled: false,
      agentReportsEnabled: true,
    });
    const broadcast = vi.fn();
    const manager = new StatusManager({ broadcast, enableRateLimits: false });

    manager.registerTab('tab-child', {
      cliState: 'busy',
      workspaceId: 'ws-1',
      tabName: 'Child',
      tmuxSession: 'pt-ws-1-pane-1-tab-child',
      panelType: 'claude',
      lastEvent: null,
      eventSeq: 0,
    });

    manager.updateTabFromHook('pt-ws-1-pane-1-tab-child', 'stop');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(configMocks.getConfig).toHaveBeenCalled();
    expect(layoutMocks.readLayoutFile).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it } from 'vitest';

import useTabStore, { shouldOpenNewConversation } from '@/hooks/use-tab-store';

describe('useTabStore status sync readiness', () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: {}, tabOrders: {} });
    useTabStore.getState().setStatusWsConnected(false);
  });

  it('waits for a full snapshot after the socket opens', () => {
    const store = useTabStore.getState();
    expect(useTabStore.getState().statusSynced).toBe(false);
    store.setStatusWsConnected(true);
    store.updateFromServer('agent', { workspaceId: 'ws', panelType: 'codex', cliState: 'busy' });
    expect(useTabStore.getState().statusWsConnected).toBe(true);
    expect(useTabStore.getState().statusSynced).toBe(false);
    store.syncAllFromServer({});
    expect(useTabStore.getState().statusSynced).toBe(true);
  });

  it('invalidates the previous snapshot across a disconnect and reconnect', () => {
    const store = useTabStore.getState();
    store.setStatusWsConnected(true);
    store.syncAllFromServer({ agent: { workspaceId: 'ws', panelType: 'codex', cliState: 'idle' } });
    store.setStatusWsConnected(false);
    expect(useTabStore.getState().statusSynced).toBe(false);
    expect(useTabStore.getState().tabs.agent.cliState).toBe('idle');
    store.setStatusWsConnected(true);
    expect(useTabStore.getState().statusSynced).toBe(false);
    store.syncAllFromServer({ agent: { workspaceId: 'ws', panelType: 'codex', cliState: 'busy' } });
    expect(useTabStore.getState().statusSynced).toBe(true);
    expect(useTabStore.getState().tabs.agent.cliState).toBe('busy');
  });
});

describe('useTabStore agent process view state', () => {
  beforeEach(() => {
    useTabStore.setState({
      tabs: {},
      tabOrders: {},
      statusWsConnected: false,
    });
  });

  it('keeps Codex tabs on the timeline when the process exits', () => {
    useTabStore.getState().initTab('tab-codex', {
      workspaceId: 'ws-test',
      panelType: 'codex',
      agentProcess: true,
      sessionView: 'timeline',
    });

    useTabStore.getState().setAgentProcess('tab-codex', false, Date.now());

    expect(useTabStore.getState().tabs['tab-codex']).toMatchObject({
      agentProcess: false,
      sessionView: 'timeline',
    });
  });

  it('keeps the session list open when a Codex process is detected', () => {
    useTabStore.getState().initTab('tab-sessions', {
      workspaceId: 'ws-test',
      panelType: 'codex',
      agentProcess: false,
      sessionView: 'session-list',
    });

    useTabStore.getState().setAgentProcess('tab-sessions', true, Date.now());

    expect(useTabStore.getState().tabs['tab-sessions']).toMatchObject({
      agentProcess: true,
      sessionView: 'session-list',
    });
  });

  it('moves the check view to timeline when a Codex process is detected', () => {
    useTabStore.getState().initTab('tab-check', {
      workspaceId: 'ws-test',
      panelType: 'codex',
      agentProcess: false,
      sessionView: 'check',
    });

    useTabStore.getState().setAgentProcess('tab-check', true, Date.now());

    expect(useTabStore.getState().tabs['tab-check']).toMatchObject({
      agentProcess: true,
      sessionView: 'timeline',
    });
  });

  it('updates agent process and install fields directly', () => {
    useTabStore.getState().initTab('tab-partial', {
      workspaceId: 'ws-test',
      panelType: 'codex',
      agentProcess: true,
      agentInstalled: false,
    });

    useTabStore.getState().setAgentProcess('tab-partial', true, 456);
    useTabStore.getState().setAgentInstalled('tab-partial', false);

    expect(useTabStore.getState().tabs['tab-partial']).toMatchObject({
      agentProcess: true,
      agentProcessCheckedAt: 456,
      agentInstalled: false,
    });
  });

  it('moves a stale timeline-only tab to the session list when switching into Codex mode', () => {
    useTabStore.getState().initTab('tab-terminal', {
      workspaceId: 'ws-test',
      panelType: 'terminal',
      agentProcess: null,
      agentSessionId: null,
      sessionView: 'timeline',
    });

    useTabStore.getState().setPanelType('tab-terminal', 'codex');

    expect(useTabStore.getState().tabs['tab-terminal']).toMatchObject({
      panelType: 'codex',
      sessionView: 'session-list',
    });
  });

  it('keeps active Codex session views when switching into Codex mode', () => {
    useTabStore.getState().initTab('tab-active', {
      workspaceId: 'ws-test',
      panelType: 'terminal',
      agentProcess: true,
      sessionView: 'timeline',
    });
    useTabStore.getState().initTab('tab-check', {
      workspaceId: 'ws-test',
      panelType: 'terminal',
      agentProcess: null,
      sessionView: 'check',
    });

    useTabStore.getState().setPanelType('tab-active', 'codex');
    useTabStore.getState().setPanelType('tab-check', 'codex');

    expect(useTabStore.getState().tabs['tab-active']?.sessionView).toBe('timeline');
    expect(useTabStore.getState().tabs['tab-check']?.sessionView).toBe('check');
  });

  it('opens a new conversation when status sync discovers a running Codex tab without agentSessionId', () => {
    useTabStore.getState().syncAllFromServer({
      'tab-cli-codex': {
        workspaceId: 'ws-test',
        panelType: 'codex',
        cliState: 'idle',
        agentSessionId: null,
      },
    });

    expect(useTabStore.getState().tabs['tab-cli-codex']).toMatchObject({
      sessionView: 'check',
      sessionViewAuto: false,
    });

    useTabStore.getState().setAgentProcess('tab-cli-codex', true, Date.now());

    expect(useTabStore.getState().tabs['tab-cli-codex']).toMatchObject({
      agentProcess: true,
      sessionView: 'timeline',
    });
  });

  it('keeps an inactive status-synced Codex tab on session-list until cliState becomes running', () => {
    useTabStore.getState().syncAllFromServer({
      'tab-cli-inactive': {
        workspaceId: 'ws-test',
        panelType: 'codex',
        cliState: 'inactive',
        agentSessionId: null,
      },
    });

    expect(useTabStore.getState().tabs['tab-cli-inactive']).toMatchObject({
      sessionView: 'session-list',
      sessionViewAuto: true,
    });

    useTabStore.getState().updateFromServer('tab-cli-inactive', {
      cliState: 'idle',
      workspaceId: 'ws-test',
      panelType: 'codex',
    });

    expect(useTabStore.getState().tabs['tab-cli-inactive']).toMatchObject({
      sessionView: 'check',
      sessionViewAuto: false,
    });
  });

  it('keeps session-list open when initTab or setSessionView explicitly chose session-list', () => {
    useTabStore.getState().initTab('tab-explicit', {
      workspaceId: 'ws-test',
      panelType: 'codex',
      sessionView: 'session-list',
    });

    useTabStore.getState().updateFromServer('tab-explicit', {
      cliState: 'idle',
      workspaceId: 'ws-test',
      panelType: 'codex',
    });

    expect(useTabStore.getState().tabs['tab-explicit']).toMatchObject({
      sessionView: 'session-list',
      sessionViewAuto: false,
    });

    expect(shouldOpenNewConversation({
      panelType: 'codex',
      agentSessionId: null,
      sessionViewAuto: false,
      sessionView: 'session-list',
      cliState: 'idle',
    })).toBe(false);
  });

  it('stores and clears agentReportNotice from syncAllFromServer and updateFromServer', () => {
    useTabStore.getState().syncAllFromServer({
      'tab-parent': {
        workspaceId: 'ws-test',
        panelType: 'claude',
        cliState: 'idle',
        agentReportNotice: { kind: 'paused', count: 2, at: 1000 },
      },
    });

    expect(useTabStore.getState().tabs['tab-parent']?.agentReportNotice).toEqual({
      kind: 'paused',
      count: 2,
      at: 1000,
    });

    useTabStore.getState().updateFromServer('tab-parent', {
      cliState: 'busy',
      workspaceId: 'ws-test',
      panelType: 'claude',
      agentReportNotice: null,
    });

    expect(useTabStore.getState().tabs['tab-parent']?.agentReportNotice).toBeNull();
  });
});

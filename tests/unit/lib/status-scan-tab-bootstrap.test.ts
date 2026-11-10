import { describe, expect, it } from 'vitest';

import { buildStatusScanTabBootstrap } from '@/lib/status/scan-tab-bootstrap';
import type { IAgentProviderStatusBehavior } from '@/lib/providers';
import type { ITab } from '@/types/terminal';

const makeTab = (overrides: Partial<ITab> = {}): ITab => ({
  id: 'tab-a',
  sessionName: 'session-a',
  name: '',
  order: 0,
  panelType: 'codex',
  agentSessionId: null,
  agentSummary: 'persisted summary',
  lastUserMessage: 'prompt',
  dismissedAt: 123,
  ...overrides,
});

const codexStatusBehavior: IAgentProviderStatusBehavior = {
  watchJsonlWhenBound: true,
  deferStopHookUntilJsonlIdle: true,
  reconcileStateFromJsonl: true,
  recoverPaneInput: true,
};

const passiveStatusBehavior: IAgentProviderStatusBehavior = {
  watchJsonlWhenBound: false,
  deferStopHookUntilJsonlIdle: false,
  reconcileStateFromJsonl: false,
  recoverPaneInput: false,
};

const baseDetected = {
  running: true,
  jsonlPath: '/tmp/11111111-2222-3333-4444-555555555555.jsonl',
  idle: false,
  lastAssistantSnippet: null,
  currentAction: null,
  sessionId: null,
};

describe('status scan tab bootstrap', () => {
  it('builds a restored scan entry and Codex bootstrap action flags', () => {
    const result = buildStatusScanTabBootstrap({
      workspaceId: 'ws-a',
      tab: makeTab(),
      statusBehavior: codexStatusBehavior,
      paneInfo: {
        command: 'codex',
        path: '/repo',
        pid: 123,
        windowActivity: 1,
      },
      detected: baseDetected,
      terminalStatus: 'idle',
      listeningPorts: [],
      now: 1_000,
    });

    expect(result.entry).toMatchObject({
      cliState: 'busy',
      workspaceId: 'ws-a',
      tabName: 'codex',
      currentProcess: 'codex',
      paneTitle: 'codex|/repo',
      tmuxSession: 'session-a',
      panelType: 'codex',
      agentSummary: 'persisted summary',
      agentSessionId: '11111111-2222-3333-4444-555555555555',
      jsonlPath: '/tmp/11111111-2222-3333-4444-555555555555.jsonl',
      readyForReviewAt: null,
      busySince: null,
      dismissedAt: 123,
    });
    expect(result.actions).toEqual({
      shouldStartJsonlWatch: true,
      shouldRecoverPaneInput: true,
      shouldResolveUnknown: false,
    });
  });

  it('creates needs-input synthetic baseline and starts JSONL watch for restored input state', () => {
    const result = buildStatusScanTabBootstrap({
      workspaceId: 'ws-a',
      tab: makeTab({ panelType: 'terminal', cliState: 'needs-input' }),
      statusBehavior: null,
      paneInfo: undefined,
      detected: {
        ...baseDetected,
        running: false,
      },
      terminalStatus: 'running',
      listeningPorts: [3000],
      now: 1_000,
    });

    expect(result.entry.cliState).toBe('needs-input');
    expect(result.entry.lastEvent).toEqual({ name: 'notification', at: 1_000, seq: 0 });
    expect(result.actions).toEqual({
      shouldStartJsonlWatch: true,
      shouldRecoverPaneInput: false,
      shouldResolveUnknown: false,
    });
  });

  it('marks unknown scan entries for delayed resolution', () => {
    const result = buildStatusScanTabBootstrap({
      workspaceId: 'ws-a',
      tab: makeTab({ panelType: 'terminal', cliState: 'busy' }),
      statusBehavior: null,
      paneInfo: undefined,
      detected: {
        ...baseDetected,
        running: false,
        jsonlPath: null,
      },
      terminalStatus: 'running',
      listeningPorts: [],
      now: 1_000,
    });

    expect(result.entry.cliState).toBe('unknown');
    expect(result.actions).toEqual({
      shouldStartJsonlWatch: false,
      shouldRecoverPaneInput: false,
      shouldResolveUnknown: true,
    });
  });

  it('does not watch or recover a running agent whose provider opts out of bound JSONL work', () => {
    const result = buildStatusScanTabBootstrap({
      workspaceId: 'ws-a',
      tab: makeTab({ cliState: 'idle' }),
      statusBehavior: passiveStatusBehavior,
      paneInfo: undefined,
      detected: baseDetected,
      terminalStatus: 'idle',
      listeningPorts: [],
      now: 1_000,
    });

    expect(result.entry.cliState).toBe('idle');
    expect(result.actions).toEqual({
      shouldStartJsonlWatch: false,
      shouldRecoverPaneInput: false,
      shouldResolveUnknown: false,
    });
  });
});

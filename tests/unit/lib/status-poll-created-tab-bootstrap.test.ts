import { describe, expect, it } from 'vitest';

import { buildStatusPollCreatedTabBootstrap } from '@/lib/status/poll-created-tab-bootstrap';
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
  bindSessionFromHook: false,
  leaveNeedsInputOnJsonlGrowth: false,
};

const passiveStatusBehavior: IAgentProviderStatusBehavior = {
  watchJsonlWhenBound: false,
  deferStopHookUntilJsonlIdle: false,
  reconcileStateFromJsonl: false,
  recoverPaneInput: false,
  bindSessionFromHook: false,
  leaveNeedsInputOnJsonlGrowth: false,
};

const baseDetected = {
  running: true,
  jsonlPath: '/tmp/11111111-2222-3333-4444-555555555555.jsonl',
  idle: false,
  lastAssistantSnippet: null,
  currentAction: null,
  sessionId: null,
};

describe('status poll created tab bootstrap', () => {
  it('builds a poll-created entry without restored lifecycle fields', () => {
    const result = buildStatusPollCreatedTabBootstrap({
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
    });
    expect(result.entry.readyForReviewAt).toBeUndefined();
    expect(result.entry.busySince).toBeUndefined();
    expect(result.entry.dismissedAt).toBeUndefined();
    expect(result.actions).toEqual({
      shouldStartJsonlWatch: true,
      shouldResolveUnknown: false,
    });
  });

  it('marks unknown poll-created entries for delayed resolution', () => {
    const result = buildStatusPollCreatedTabBootstrap({
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
      listeningPorts: [3000],
      now: 1_000,
    });

    expect(result.entry.cliState).toBe('unknown');
    expect(result.actions).toEqual({
      shouldStartJsonlWatch: false,
      shouldResolveUnknown: true,
    });
  });

  it('does not watch a running agent whose provider opts out of bound JSONL watching', () => {
    const result = buildStatusPollCreatedTabBootstrap({
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
      shouldResolveUnknown: false,
    });
  });
});

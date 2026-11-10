import { describe, expect, it } from 'vitest';

import {
  createSyntheticStatusLastEvent,
  didStatusPortsChange,
  reconcileStatusPollTabChanges,
  reconcileStatusProcessRetry,
  resolveStatusInitialCliState,
} from '@/lib/status/poll-tab-reconciliation';
import type { ITabStatusEntry } from '@/types/status';

const detected = {
  running: false,
  jsonlPath: null,
  idle: false,
  lastAssistantSnippet: null,
};

const makeEntry = (overrides: Partial<ITabStatusEntry> = {}): ITabStatusEntry => ({
  cliState: 'busy',
  workspaceId: 'ws-1',
  tabName: 'Codex tab',
  currentProcess: 'codex',
  tmuxSession: 'codexmux:tab',
  panelType: 'codex',
  terminalStatus: 'idle',
  listeningPorts: [],
  lastUserMessage: 'prompt',
  ...overrides,
});

describe('status poll tab reconciliation', () => {
  it('resolves initial CLI state from persisted state and Codex metadata', () => {
    expect(resolveStatusInitialCliState({
      persistedState: 'busy',
      reconcileStateFromJsonl: false,
      detected,
    })).toBe('unknown');

    expect(resolveStatusInitialCliState({
      persistedState: 'unknown',
      reconcileStateFromJsonl: true,
      detected: { ...detected, running: false },
    })).toBe('idle');

    expect(resolveStatusInitialCliState({
      persistedState: 'idle',
      reconcileStateFromJsonl: true,
      detected: { ...detected, running: true, jsonlPath: null },
    })).toBe('busy');

    expect(resolveStatusInitialCliState({
      persistedState: 'busy',
      reconcileStateFromJsonl: true,
      detected: {
        ...detected,
        running: true,
        jsonlPath: '/tmp/session.jsonl',
        idle: true,
        lastAssistantSnippet: 'done',
      },
    })).toBe('ready-for-review');

    expect(resolveStatusInitialCliState({
      persistedState: 'ready-for-review',
      reconcileStateFromJsonl: false,
      detected: { ...detected, running: true },
    })).toBe('ready-for-review');
  });

  it('keeps the persisted baseline when the provider does not reconcile state from JSONL', () => {
    expect(resolveStatusInitialCliState({
      persistedState: 'busy',
      reconcileStateFromJsonl: false,
      detected: { running: true, jsonlPath: null, idle: false, lastAssistantSnippet: null },
    })).toBe('unknown');
    expect(resolveStatusInitialCliState({
      persistedState: 'idle',
      reconcileStateFromJsonl: false,
      detected: {
        running: true,
        jsonlPath: '/tmp/session.jsonl',
        idle: true,
        lastAssistantSnippet: 'done',
      },
    })).toBe('idle');
  });

  it('creates synthetic needs-input baseline events only for needs-input state', () => {
    expect(createSyntheticStatusLastEvent('needs-input', 1_000)).toEqual({
      name: 'notification',
      at: 1_000,
      seq: 0,
    });
    expect(createSyntheticStatusLastEvent('busy', 1_000)).toBeNull();
  });

  it('reconciles process retry countdown', () => {
    expect(reconcileStatusProcessRetry({
      processChanged: true,
      currentRetries: undefined,
      retryCount: 3,
    })).toEqual({
      processRetries: 3,
      processRetryNeeded: false,
    });

    expect(reconcileStatusProcessRetry({
      processChanged: false,
      currentRetries: 2,
      retryCount: 3,
    })).toEqual({
      processRetries: 1,
      processRetryNeeded: true,
    });

    expect(reconcileStatusProcessRetry({
      processChanged: false,
      currentRetries: 0,
      retryCount: 3,
    })).toEqual({
      processRetries: 0,
      processRetryNeeded: false,
    });
  });

  it('compares port arrays by length and order', () => {
    expect(didStatusPortsChange(undefined, [])).toBe(true);
    expect(didStatusPortsChange([3000], [3000])).toBe(false);
    expect(didStatusPortsChange([3000], [3001])).toBe(true);
    expect(didStatusPortsChange([3000], [3000, 3001])).toBe(true);
  });

  it('aggregates changed flags for existing poll tab updates', () => {
    const unchanged = reconcileStatusPollTabChanges({
      existing: makeEntry({ listeningPorts: [3000], agentSummary: 'summary' }),
      currentProcess: 'codex',
      nextLastUserMessage: 'prompt',
      nextPanelType: 'codex',
      nextTerminalStatus: 'idle',
      nextListeningPorts: [3000],
      nextAgentSummary: 'summary',
      metadataChanged: false,
      codexStateChanged: false,
      retryCount: 3,
    });

    expect(unchanged.shouldBroadcastUpdate).toBe(false);

    const changed = reconcileStatusPollTabChanges({
      existing: makeEntry({
        currentProcess: 'bash',
        listeningPorts: [3000],
        agentSummary: 'old',
        processRetries: 1,
      }),
      currentProcess: 'codex',
      nextLastUserMessage: 'new prompt',
      nextPanelType: 'codex',
      nextTerminalStatus: 'server',
      nextListeningPorts: [4173],
      nextAgentSummary: 'new',
      metadataChanged: true,
      codexStateChanged: false,
      retryCount: 3,
    });

    expect(changed).toMatchObject({
      processChanged: true,
      messageChanged: true,
      panelTypeChanged: false,
      portsChanged: true,
      terminalChanged: true,
      summaryChanged: true,
      processRetryNeeded: false,
      processRetries: 3,
      shouldBroadcastUpdate: true,
    });
  });
});

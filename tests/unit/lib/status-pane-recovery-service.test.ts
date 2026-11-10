import { describe, expect, it, vi } from 'vitest';

import { createStatusPaneRecoveryService } from '@/lib/status/pane-recovery-service';
import type { IApprovalPromptMetadata } from '@/lib/permission-prompt';
import type { IAgentProviderStatusBehavior } from '@/lib/providers';
import type { ITabStatusEntry } from '@/types/status';

const metadata: IApprovalPromptMetadata = {
  promptType: 'command',
  approvalKind: 'allow',
  riskLevel: 'medium',
  commandPreview: 'corepack pnpm test',
  fileHints: [],
  fallbackReason: null,
};

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

const makeEntry = (overrides: Partial<ITabStatusEntry> = {}): ITabStatusEntry => ({
  cliState: 'busy',
  workspaceId: 'ws-1',
  tabName: 'Codex tab',
  tmuxSession: 'codexmux:tab',
  panelType: 'codex',
  eventSeq: 2,
  currentAction: { toolName: 'Bash', summary: 'running' },
  ...overrides,
});

const createService = (overrides: Partial<Parameters<typeof createStatusPaneRecoveryService>[0]> = {}) =>
  createStatusPaneRecoveryService({
    capturePaneAtWidth: vi.fn(async () => 'pane content'),
    parsePermissionOptions: vi.fn(() => ({ options: ['1. Yes', '2. No'], focusedIndex: 0, metadata })),
    hasInterruptedPrompt: vi.fn(() => true),
    getStatusBehavior: () => codexStatusBehavior,
    now: () => 1_234,
    warn: vi.fn(),
    ...overrides,
  });

describe('status pane recovery service', () => {
  it('recovers pending input from Codex pane options', async () => {
    const service = createService();

    await expect(service.recoverPendingInput({
      tabId: 'tab-a',
      entry: makeEntry(),
      silent: false,
    })).resolves.toEqual({
      recovered: true,
      nextState: 'needs-input',
      applyOptions: { silent: false },
      lastEvent: { name: 'notification', at: 1_234, seq: 3 },
      approvalPromptMetadata: metadata,
      log: { event: 'pending-input', seq: 3, optionCount: 2 },
    });
  });

  it('rejects pending input recovery for entries without a provider and panes with no options', async () => {
    await expect(createService({ getStatusBehavior: () => null }).recoverPendingInput({
      tabId: 'tab-a',
      entry: makeEntry({ panelType: undefined }),
    })).resolves.toEqual({ recovered: false, reason: 'not-supported' });

    await expect(createService({
      parsePermissionOptions: vi.fn(() => ({ options: [], focusedIndex: 0, metadata })),
    }).recoverPendingInput({
      tabId: 'tab-a',
      entry: makeEntry(),
    })).resolves.toEqual({ recovered: false, reason: 'no-options' });
  });

  it('does not capture the pane when the provider does not recover pane input', async () => {
    const capturePaneAtWidth = vi.fn(async () => 'pane content');
    const service = createService({
      capturePaneAtWidth,
      getStatusBehavior: () => passiveStatusBehavior,
    });

    await expect(service.recoverPendingInput({
      tabId: 'tab-a',
      entry: makeEntry(),
    })).resolves.toEqual({ recovered: false, reason: 'not-supported' });
    await expect(service.recoverInterruptedPrompt({
      tabId: 'tab-a',
      entry: makeEntry(),
    })).resolves.toEqual({ recovered: false, reason: 'not-supported' });
    expect(capturePaneAtWidth).not.toHaveBeenCalled();
  });

  it('recovers interrupted prompts as idle without history', async () => {
    const service = createService();

    await expect(service.recoverInterruptedPrompt({
      tabId: 'tab-a',
      entry: makeEntry(),
    })).resolves.toEqual({
      recovered: true,
      nextState: 'idle',
      applyOptions: { silent: true, skipHistory: true },
      lastEvent: { name: 'interrupt', at: 1_234, seq: 3 },
      lastInterruptTs: 1_234,
      clearCurrentAction: true,
      log: { event: 'interrupted-prompt', seq: 3 },
    });
  });

  it('rejects interrupted recovery for invalid state, capture failure, and missing interrupted marker', async () => {
    await expect(createService().recoverInterruptedPrompt({
      tabId: 'tab-a',
      entry: makeEntry({ cliState: 'ready-for-review' }),
    })).resolves.toEqual({ recovered: false, reason: 'not-pending-state' });

    await expect(createService({
      capturePaneAtWidth: vi.fn(async () => null),
    }).recoverInterruptedPrompt({
      tabId: 'tab-a',
      entry: makeEntry(),
    })).resolves.toEqual({ recovered: false, reason: 'capture-failed' });

    await expect(createService({
      hasInterruptedPrompt: vi.fn(() => false),
    }).recoverInterruptedPrompt({
      tabId: 'tab-a',
      entry: makeEntry(),
    })).resolves.toEqual({ recovered: false, reason: 'not-interrupted-prompt' });
  });
});

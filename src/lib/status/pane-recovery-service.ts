import { capturePaneAtWidth as defaultCapturePaneAtWidth } from '@/lib/capture-at-width';
import { hasCodexInterruptedPrompt as defaultHasCodexInterruptedPrompt } from '@/lib/codex-pane-state';
import {
  parsePermissionOptions as defaultParsePermissionOptions,
  type IApprovalPromptMetadata,
  type IPermissionPromptParseResult,
} from '@/lib/permission-prompt';
import { getProviderByPanelType, type IAgentProviderStatusBehavior } from '@/lib/providers';
import type { TCliState } from '@/types/timeline';
import type { ILastEvent, ITabStatusEntry } from '@/types/status';

type TPaneRecoveryResult =
  | { recovered: false; reason: string }
  | {
    recovered: true;
    nextState: Extract<TCliState, 'needs-input' | 'idle'>;
    applyOptions: { silent?: boolean; skipHistory?: boolean };
    lastEvent: ILastEvent;
    approvalPromptMetadata?: IApprovalPromptMetadata;
    lastInterruptTs?: number;
    clearCurrentAction?: boolean;
    log: { event: 'pending-input'; seq: number; optionCount: number } | { event: 'interrupted-prompt'; seq: number };
  };

interface IStatusPaneRecoveryServiceDependencies {
  capturePaneAtWidth?: (session: string, width: number, height: number) => Promise<string | null>;
  parsePermissionOptions?: (content: string) => IPermissionPromptParseResult;
  hasInterruptedPrompt?: (content: string) => boolean;
  getStatusBehavior?: (entry: ITabStatusEntry) => IAgentProviderStatusBehavior | null;
  now?: () => number;
  warn?: (message: string) => void;
}

const isPendingInputState = (state: TCliState): boolean =>
  state === 'unknown' || state === 'busy' || state === 'idle';

const isInterruptedPromptState = (state: TCliState): boolean =>
  state === 'unknown' || state === 'busy';

export const createStatusPaneRecoveryService = (
  dependencies: IStatusPaneRecoveryServiceDependencies = {},
) => {
  const capturePaneAtWidth = dependencies.capturePaneAtWidth ?? defaultCapturePaneAtWidth;
  const parsePermissionOptions = dependencies.parsePermissionOptions ?? defaultParsePermissionOptions;
  const hasInterruptedPrompt = dependencies.hasInterruptedPrompt ?? defaultHasCodexInterruptedPrompt;
  const getStatusBehavior = dependencies.getStatusBehavior
    ?? ((entry: ITabStatusEntry) => getProviderByPanelType(entry.panelType)?.statusBehavior ?? null);
  const now = dependencies.now ?? Date.now;
  const warn = dependencies.warn;

  const capture = async (entry: ITabStatusEntry, label: string): Promise<string | null> => {
    try {
      return await capturePaneAtWidth(entry.tmuxSession, 120, 50);
    } catch (err) {
      warn?.(`${label} capture failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  };

  return {
    async recoverPendingInput({
      entry,
      silent,
    }: {
      tabId: string;
      entry: ITabStatusEntry;
      silent?: boolean;
    }): Promise<TPaneRecoveryResult> {
      if (!isPendingInputState(entry.cliState)) {
        return { recovered: false, reason: 'not-pending-state' };
      }
      if (!getStatusBehavior(entry)?.recoverPaneInput) {
        return { recovered: false, reason: 'not-supported' };
      }

      const content = await capture(entry, 'recoverUnknownIfPending');
      if (!content) return { recovered: false, reason: 'capture-failed' };

      const { options, metadata } = parsePermissionOptions(content);
      if (options.length === 0) return { recovered: false, reason: 'no-options' };

      const at = now();
      const seq = (entry.eventSeq ?? 0) + 1;
      return {
        recovered: true,
        nextState: 'needs-input',
        applyOptions: { silent },
        lastEvent: { name: 'notification', at, seq },
        approvalPromptMetadata: metadata,
        log: { event: 'pending-input', seq, optionCount: options.length },
      };
    },

    async recoverInterruptedPrompt({
      entry,
      silent,
    }: {
      tabId: string;
      entry: ITabStatusEntry;
      silent?: boolean;
    }): Promise<TPaneRecoveryResult> {
      if (!isInterruptedPromptState(entry.cliState)) {
        return { recovered: false, reason: 'not-pending-state' };
      }
      if (!getStatusBehavior(entry)?.recoverPaneInput) {
        return { recovered: false, reason: 'not-supported' };
      }

      const content = await capture(entry, 'recoverInterruptedPromptFromPane');
      if (!content) return { recovered: false, reason: 'capture-failed' };
      if (!hasInterruptedPrompt(content)) {
        return { recovered: false, reason: 'not-interrupted-prompt' };
      }

      const at = now();
      const seq = (entry.eventSeq ?? 0) + 1;
      return {
        recovered: true,
        nextState: 'idle',
        applyOptions: { silent: silent ?? true, skipHistory: true },
        lastEvent: { name: 'interrupt', at, seq },
        lastInterruptTs: at,
        clearCurrentAction: true,
        log: { event: 'interrupted-prompt', seq },
      };
    },
  };
};

import type { TCliState } from '@/types/timeline';
import type { ILastEvent, ITabStatusEntry, TTerminalStatus } from '@/types/status';
import type { TPanelType } from '@/types/terminal';

interface IStatusInitialDetection {
  running: boolean;
  jsonlPath: string | null;
  idle: boolean;
  lastAssistantSnippet: string | null;
}

interface IResolveStatusInitialCliStateInput {
  persistedState?: TCliState;
  reconcileStateFromJsonl: boolean;
  detected: IStatusInitialDetection;
}

interface IReconcileStatusProcessRetryInput {
  processChanged: boolean;
  currentRetries?: number;
  retryCount: number;
}

interface IReconcileStatusProcessRetryResult {
  processRetries?: number;
  processRetryNeeded: boolean;
}

interface IReconcileStatusPollTabChangesInput {
  existing: Pick<
    ITabStatusEntry,
    'currentProcess' | 'lastUserMessage' | 'panelType' | 'terminalStatus' | 'listeningPorts' | 'agentSummary' | 'processRetries'
  >;
  currentProcess?: string;
  nextLastUserMessage?: string | null;
  nextPanelType?: TPanelType;
  nextTerminalStatus: TTerminalStatus;
  nextListeningPorts: number[];
  nextAgentSummary?: string | null;
  metadataChanged: boolean;
  codexStateChanged: boolean;
  retryCount: number;
}

export interface IReconcileStatusPollTabChangesResult extends IReconcileStatusProcessRetryResult {
  processChanged: boolean;
  messageChanged: boolean;
  panelTypeChanged: boolean;
  portsChanged: boolean;
  terminalChanged: boolean;
  summaryChanged: boolean;
  shouldBroadcastUpdate: boolean;
}

export const resolveStatusInitialCliState = ({
  persistedState,
  reconcileStateFromJsonl,
  detected,
}: IResolveStatusInitialCliStateInput): TCliState => {
  let cliState: TCliState = (persistedState ?? 'idle') === 'busy' ? 'unknown' : (persistedState ?? 'idle');
  if (!reconcileStateFromJsonl) return cliState;

  if (!detected.running && (cliState === 'unknown' || cliState === 'inactive')) {
    cliState = 'idle';
  } else if (detected.running && !detected.jsonlPath) {
    cliState = 'busy';
  } else if (detected.running && detected.idle && detected.lastAssistantSnippet) {
    cliState = 'ready-for-review';
  } else if (detected.running && !detected.idle) {
    cliState = 'busy';
  }

  return cliState;
};

export const createSyntheticStatusLastEvent = (
  cliState: TCliState,
  now: number,
): ILastEvent | null => cliState === 'needs-input'
  ? { name: 'notification', at: now, seq: 0 }
  : null;

export const reconcileStatusProcessRetry = ({
  processChanged,
  currentRetries,
  retryCount,
}: IReconcileStatusProcessRetryInput): IReconcileStatusProcessRetryResult => {
  if (processChanged) {
    return { processRetries: retryCount, processRetryNeeded: false };
  }

  if ((currentRetries ?? 0) > 0) {
    return { processRetries: currentRetries! - 1, processRetryNeeded: true };
  }

  return { processRetries: currentRetries, processRetryNeeded: false };
};

export const didStatusPortsChange = (
  previousPorts: number[] | undefined,
  nextPorts: number[],
): boolean => previousPorts?.length !== nextPorts.length
  || nextPorts.some((port, index) => previousPorts?.[index] !== port);

export const reconcileStatusPollTabChanges = ({
  existing,
  currentProcess,
  nextLastUserMessage,
  nextPanelType,
  nextTerminalStatus,
  nextListeningPorts,
  nextAgentSummary,
  metadataChanged,
  codexStateChanged,
  retryCount,
}: IReconcileStatusPollTabChangesInput): IReconcileStatusPollTabChangesResult => {
  const processChanged = existing.currentProcess !== currentProcess;
  const messageChanged = existing.lastUserMessage !== nextLastUserMessage;
  const panelTypeChanged = existing.panelType !== nextPanelType;
  const portsChanged = didStatusPortsChange(existing.listeningPorts, nextListeningPorts);
  const terminalChanged = existing.terminalStatus !== nextTerminalStatus || portsChanged;
  const summaryChanged = existing.agentSummary !== nextAgentSummary;
  const retry = reconcileStatusProcessRetry({
    processChanged,
    currentRetries: existing.processRetries,
    retryCount,
  });

  return {
    processChanged,
    messageChanged,
    panelTypeChanged,
    portsChanged,
    terminalChanged,
    summaryChanged,
    processRetries: retry.processRetries,
    processRetryNeeded: retry.processRetryNeeded,
    shouldBroadcastUpdate: terminalChanged
      || processChanged
      || retry.processRetryNeeded
      || messageChanged
      || panelTypeChanged
      || summaryChanged
      || metadataChanged
      || codexStateChanged,
  };
};

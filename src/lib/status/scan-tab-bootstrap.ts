import { readAgentSessionId, readAgentSummary } from '@/lib/agent-tab-fields';
import type { IAgentProviderStatusBehavior } from '@/lib/providers';
import { resolveAgentSessionId } from '@/lib/status-session-mapping';
import {
  createSyntheticStatusLastEvent,
  resolveStatusInitialCliState,
} from '@/lib/status/poll-tab-reconciliation';
import { buildStatusTabEntry } from '@/lib/status/tab-entry';
import type { IPaneInfo } from '@/lib/tmux';
import type { ICurrentAction, ITabStatusEntry, TTerminalStatus } from '@/types/status';
import type { ITab } from '@/types/terminal';

interface IStatusScanDetectedMetadata {
  running: boolean;
  jsonlPath: string | null;
  idle: boolean;
  lastAssistantSnippet: string | null;
  currentAction: ICurrentAction | null;
  sessionId?: string | null;
}

interface IBuildStatusScanTabBootstrapInput {
  workspaceId: string;
  tab: ITab;
  statusBehavior: IAgentProviderStatusBehavior | null;
  paneInfo?: IPaneInfo;
  detected: IStatusScanDetectedMetadata;
  terminalStatus: TTerminalStatus;
  listeningPorts: number[];
  now: number;
}

interface IStatusScanTabBootstrapActions {
  shouldStartJsonlWatch: boolean;
  shouldRecoverPaneInput: boolean;
  shouldResolveUnknown: boolean;
}

interface IStatusScanTabBootstrap {
  entry: ITabStatusEntry;
  actions: IStatusScanTabBootstrapActions;
}

export const buildStatusScanTabBootstrap = ({
  workspaceId,
  tab,
  statusBehavior,
  paneInfo,
  detected,
  terminalStatus,
  listeningPorts,
  now,
}: IBuildStatusScanTabBootstrapInput): IStatusScanTabBootstrap => {
  const cliState = resolveStatusInitialCliState({
    persistedState: tab.cliState,
    reconcileStateFromJsonl: !!statusBehavior?.reconcileStateFromJsonl,
    detected,
  });
  const lastEvent = createSyntheticStatusLastEvent(cliState, now);
  const agentSessionId = resolveAgentSessionId({
    detectedSessionId: detected.sessionId,
    jsonlPath: detected.jsonlPath,
    persistedSessionId: readAgentSessionId(tab),
  });
  const entry = buildStatusTabEntry({
    workspaceId,
    tab,
    cliState,
    paneInfo,
    terminalStatus,
    listeningPorts,
    agentSummary: readAgentSummary(tab),
    agentSessionId,
    jsonlPath: detected.jsonlPath,
    lastAssistantSnippet: detected.lastAssistantSnippet,
    currentAction: detected.currentAction,
    lastEvent,
    now,
    restoreLifecycleFields: true,
  });

  return {
    entry,
    actions: {
      shouldStartJsonlWatch: !!detected.jsonlPath
        && (!!statusBehavior?.watchJsonlWhenBound || cliState === 'needs-input' || cliState === 'unknown'),
      shouldRecoverPaneInput: !!statusBehavior?.recoverPaneInput && detected.running,
      shouldResolveUnknown: cliState === 'unknown',
    },
  };
};

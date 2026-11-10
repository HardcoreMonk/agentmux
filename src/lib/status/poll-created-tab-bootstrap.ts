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

interface IStatusPollDetectedMetadata {
  running: boolean;
  jsonlPath: string | null;
  idle: boolean;
  lastAssistantSnippet: string | null;
  currentAction: ICurrentAction | null;
  sessionId?: string | null;
}

interface IBuildStatusPollCreatedTabBootstrapInput {
  workspaceId: string;
  tab: ITab;
  statusBehavior: IAgentProviderStatusBehavior | null;
  paneInfo?: IPaneInfo;
  detected: IStatusPollDetectedMetadata;
  terminalStatus: TTerminalStatus;
  listeningPorts: number[];
  now: number;
}

interface IStatusPollCreatedTabBootstrapActions {
  shouldStartJsonlWatch: boolean;
  shouldResolveUnknown: boolean;
}

interface IStatusPollCreatedTabBootstrap {
  entry: ITabStatusEntry;
  actions: IStatusPollCreatedTabBootstrapActions;
}

export const buildStatusPollCreatedTabBootstrap = ({
  workspaceId,
  tab,
  statusBehavior,
  paneInfo,
  detected,
  terminalStatus,
  listeningPorts,
  now,
}: IBuildStatusPollCreatedTabBootstrapInput): IStatusPollCreatedTabBootstrap => {
  const cliState = resolveStatusInitialCliState({
    persistedState: tab.cliState,
    reconcileStateFromJsonl: !!statusBehavior?.reconcileStateFromJsonl,
    detected,
  });
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
    lastEvent: createSyntheticStatusLastEvent(cliState, now),
    now,
    restoreLifecycleFields: false,
  });

  return {
    entry,
    actions: {
      shouldStartJsonlWatch: !!statusBehavior?.watchJsonlWhenBound && !!detected.jsonlPath,
      shouldResolveUnknown: cliState === 'unknown',
    },
  };
};

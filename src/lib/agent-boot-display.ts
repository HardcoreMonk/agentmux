import type { TSessionView } from '@/hooks/use-tab-store';
import type { TCliState } from '@/types/timeline';

export type TAgentBootDisplay = 'trust' | 'bypass' | 'starting' | 'waiting-session' | 'recover' | null;

export const AGENT_BOOT_RECOVER_MS = 60_000;

interface IResolveAgentBootDisplayInput {
  view: TSessionView;
  agentProcess: boolean | null;
  hasEntries: boolean;
  trustPrompt: boolean;
  bypassPrompt: boolean;
  // A startup prompt is present and it is not the bypass prompt.
  startingPrompt: boolean;
  cliState: TCliState | undefined;
  elapsedMs: number;
}

// Claude writes no transcript before the first prompt, so once the agent has reported a state
// the empty timeline is a ready agent, not a boot in progress.
const hasReportedState = (cliState: TCliState | undefined): boolean =>
  cliState !== undefined && cliState !== 'inactive' && cliState !== 'unknown';

// True while a boot display can be on screen, i.e. while the elapsed timer should run.
export const isAgentBootActive = ({
  view,
  agentProcess,
  hasEntries,
  cliState,
}: Pick<IResolveAgentBootDisplayInput, 'view' | 'agentProcess' | 'hasEntries' | 'cliState'>): boolean =>
  view === 'check'
  || (view === 'timeline' && agentProcess === true && !hasEntries && !hasReportedState(cliState));

// Decides what the agent panel shows while the agent boots. The trust card is drawn by the parent
// (it outlives the check view), so 'trust' only hides the progress.
export const resolveAgentBootDisplay = ({
  view,
  agentProcess,
  hasEntries,
  trustPrompt,
  bypassPrompt,
  startingPrompt,
  cliState,
  elapsedMs,
}: IResolveAgentBootDisplayInput): TAgentBootDisplay => {
  if (trustPrompt) return 'trust';
  if (view === 'check' && bypassPrompt) return 'bypass';
  if (view === 'check' && startingPrompt) return 'recover';
  if (view === 'timeline' && hasReportedState(cliState)) return null;
  if (elapsedMs >= AGENT_BOOT_RECOVER_MS && !hasEntries) return 'recover';
  if (view === 'check') return 'starting';
  if (view === 'timeline' && agentProcess === true && !hasEntries) return 'waiting-session';
  return null;
};

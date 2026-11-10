import type { TSessionView } from '@/hooks/use-tab-store';

export type TAgentBootDisplay = 'trust' | 'bypass' | 'starting' | 'waiting-session' | 'recover' | null;

export const AGENT_BOOT_RECOVER_MS = 60_000;

interface IResolveAgentBootDisplayInput {
  view: TSessionView;
  agentProcess: boolean | null;
  hasEntries: boolean;
  trustPrompt: boolean;
  bypassPrompt: boolean;
  elapsedMs: number;
}

// True while a boot display can be on screen, i.e. while the elapsed timer should run.
export const isAgentBootActive = ({
  view,
  agentProcess,
  hasEntries,
}: Pick<IResolveAgentBootDisplayInput, 'view' | 'agentProcess' | 'hasEntries'>): boolean =>
  view === 'check' || (view === 'timeline' && agentProcess === true && !hasEntries);

// Decides what the agent panel shows while the agent boots. The trust card is drawn by the parent
// (it outlives the check view), so 'trust' only hides the progress.
export const resolveAgentBootDisplay = ({
  view,
  agentProcess,
  hasEntries,
  trustPrompt,
  bypassPrompt,
  elapsedMs,
}: IResolveAgentBootDisplayInput): TAgentBootDisplay => {
  if (trustPrompt) return 'trust';
  if (view === 'check' && bypassPrompt) return 'bypass';
  if (elapsedMs >= AGENT_BOOT_RECOVER_MS && !hasEntries) return 'recover';
  if (view === 'check') return 'starting';
  if (view === 'timeline' && agentProcess === true && !hasEntries) return 'waiting-session';
  return null;
};

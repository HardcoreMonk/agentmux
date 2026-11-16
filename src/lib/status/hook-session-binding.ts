import type { IAgentProviderStatusBehavior } from '@/lib/providers';
import type { TEventName } from '@/types/status';
import type { TCliState } from '@/types/timeline';

export const decideHookSessionRebind = ({
  behavior,
  eventName,
  currentSessionId,
  currentJsonlPath = null,
  hookSessionId,
  transcriptPath,
}: {
  behavior: IAgentProviderStatusBehavior | null;
  eventName?: string;
  currentSessionId: string | null;
  currentJsonlPath?: string | null;
  hookSessionId?: string;
  transcriptPath?: string;
}): { rebind: false } | { rebind: true; sessionId: string; jsonlPath: string | null } => {
  if (!behavior?.bindSessionFromHook || !hookSessionId) return { rebind: false };
  if (behavior.bindSessionHookEvents && (!eventName || !behavior.bindSessionHookEvents.includes(eventName as TEventName))) {
    return { rebind: false };
  }
  const sameSession = hookSessionId === currentSessionId;
  // A relaunch keeps the id but may still point at an older transcript; follow the hook's.
  if (sameSession && (!transcriptPath || transcriptPath === currentJsonlPath)) return { rebind: false };
  return { rebind: true, sessionId: hookSessionId, jsonlPath: transcriptPath ?? null };
};

export const decideNeedsInputJsonlExit = ({
  behavior,
  cliState,
  needsInputSince,
  lastEntryTs,
  interrupted,
}: {
  behavior: IAgentProviderStatusBehavior | null;
  cliState: TCliState;
  needsInputSince: number | null;
  lastEntryTs: number | null;
  interrupted: boolean;
}): 'none' | 'busy' | 'idle' => {
  if (!behavior || cliState !== 'needs-input') return 'none';
  if (needsInputSince === null || lastEntryTs === null || lastEntryTs <= needsInputSince) return 'none';
  // An aborted turn ends the prompt for every provider (Codex: the human declined with Esc).
  if (interrupted) return 'idle';
  return behavior.leaveNeedsInputOnJsonlGrowth ? 'busy' : 'none';
};

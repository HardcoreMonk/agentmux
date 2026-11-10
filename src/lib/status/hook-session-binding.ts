import type { IAgentProviderStatusBehavior } from '@/lib/providers';
import type { TCliState } from '@/types/timeline';

export const decideHookSessionRebind = ({
  behavior,
  currentSessionId,
  currentJsonlPath = null,
  hookSessionId,
  transcriptPath,
}: {
  behavior: IAgentProviderStatusBehavior | null;
  currentSessionId: string | null;
  currentJsonlPath?: string | null;
  hookSessionId?: string;
  transcriptPath?: string;
}): { rebind: false } | { rebind: true; sessionId: string; jsonlPath: string | null } => {
  if (!behavior?.bindSessionFromHook || !hookSessionId) return { rebind: false };
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
  if (!behavior?.leaveNeedsInputOnJsonlGrowth || cliState !== 'needs-input') return 'none';
  if (needsInputSince === null || lastEntryTs === null || lastEntryTs <= needsInputSince) return 'none';
  return interrupted ? 'idle' : 'busy';
};

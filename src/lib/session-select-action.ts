import type { TAgentPanelType, TPanelType } from '@/types/terminal';

export type TSessionSelectAction = 'open' | 'resume-other-provider' | 'blocked-running';

// A running agent cannot be swapped for another provider's session, so that case is blocked.
export const decideSessionSelectAction = (input: {
  tabPanelType: TPanelType;
  itemProviderId: TAgentPanelType;
  agentProcess: boolean;
}): TSessionSelectAction => {
  if (input.tabPanelType === input.itemProviderId) return 'open';
  if (input.agentProcess) return 'blocked-running';
  return 'resume-other-provider';
};

export const buildSessionListQuery = (input: {
  tmuxSession: string;
  limit: number;
  offset: number;
  panelType: TPanelType;
  cwd?: string;
  providers?: TAgentPanelType[];
}): URLSearchParams => {
  const params = new URLSearchParams({
    tmuxSession: input.tmuxSession,
    limit: String(input.limit),
    offset: String(input.offset),
    panelType: input.panelType,
  });
  if (input.cwd) params.set('cwd', input.cwd);
  if (input.providers && input.providers.length > 0) params.set('providers', input.providers.join(','));
  return params;
};

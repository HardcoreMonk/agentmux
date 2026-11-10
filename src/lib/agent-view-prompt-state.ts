import type { TAgentPanelType, TPanelType } from '@/types/terminal';
import type { TSessionView } from '@/hooks/use-tab-store';

export interface IShouldOfferAgentViewInput {
  runtimeVersion?: number;
  panelType: TPanelType;
  providerPanelType: TAgentPanelType | null;
  dismissed: boolean;
}

// Offer the agent view only for a Runtime v1 plain terminal tab where an agent was detected.
export const shouldOfferAgentView = (input: IShouldOfferAgentViewInput): boolean =>
  input.runtimeVersion !== 2
  && input.panelType === 'terminal'
  && input.providerPanelType !== null
  && !input.dismissed;

export interface IAgentViewPromptRegistry {
  isDismissed: (tabId: string, provider: TAgentPanelType) => boolean;
  dismiss: (tabId: string, provider: TAgentPanelType) => void;
}

export const createAgentViewPromptRegistry = (): IAgentViewPromptRegistry => {
  const dismissed = new Set<string>();
  const key = (tabId: string, provider: TAgentPanelType) => `${tabId}:${provider}`;
  return {
    isDismissed: (tabId, provider) => dismissed.has(key(tabId, provider)),
    dismiss: (tabId, provider) => { dismissed.add(key(tabId, provider)); },
  };
};

const g = globalThis as unknown as { __agentViewPromptRegistry?: IAgentViewPromptRegistry };
export const agentViewPromptRegistry: IAgentViewPromptRegistry =
  g.__agentViewPromptRegistry ?? (g.__agentViewPromptRegistry = createAgentViewPromptRegistry());

export interface IAcceptAgentViewPromptDeps {
  updateTabPanelType: (paneId: string, tabId: string, panelType: TPanelType) => boolean;
  setSessionView: (tabId: string, view: TSessionView) => void;
}

// Switches the tab to the detected agent; the timeline view opens only if the switch was allowed.
export const acceptAgentViewPrompt = (
  deps: IAcceptAgentViewPromptDeps,
  input: { paneId: string; tabId: string; providerPanelType: TAgentPanelType },
): boolean => {
  const applied = deps.updateTabPanelType(input.paneId, input.tabId, input.providerPanelType);
  if (applied) deps.setSessionView(input.tabId, 'timeline');
  return applied;
};

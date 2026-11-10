import type { TAgentPanelType } from '@/types/terminal';
import { AGENT_PANEL_TYPES } from '@/lib/panel-type';
import { AGENT_PROVIDER_META } from '@/lib/agent-provider-meta';

export interface IAgentNewTabItem {
  key: string;
  type: TAgentPanelType;
  label: string;
  startAgent: true;
}

export const AGENT_NEW_TAB_ITEMS: readonly IAgentNewTabItem[] = AGENT_PANEL_TYPES.map((type) => ({
  key: AGENT_PROVIDER_META[type].newTabCommand,
  type,
  label: AGENT_PROVIDER_META[type].label,
  startAgent: true as const,
}));

export const findAgentNewTabItemByCommand = (command: string | undefined): IAgentNewTabItem | undefined =>
  command ? AGENT_NEW_TAB_ITEMS.find((item) => item.key === command) : undefined;

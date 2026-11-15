import { collectPanes, findPane } from '@/lib/layout-tree';
import { DEFAULT_AGENT_PANEL_TYPE, isAgentPanelType } from '@/lib/panel-type';
import type { ITab, TAgentPanelType, TLayoutNode, TPanelType } from '@/types/terminal';
import type { TCliState } from '@/types/timeline';

export interface IGitSidePanelTarget {
  paneId: string;
  tabId: string;
  sessionName: string;
  panelType: TPanelType;
}

const SESSION_PANEL_TYPES = new Set<TPanelType>(['terminal', 'codex', 'claude', 'diff']);

const normalizeTabPanelType = (tab: ITab): TPanelType => tab.panelType ?? 'terminal';

const isSessionBackedTab = (tab: ITab): boolean => {
  const panelType = normalizeTabPanelType(tab);
  return SESSION_PANEL_TYPES.has(panelType) && Boolean(tab.sessionName);
};

export const resolveGitSidePanelTarget = (input: {
  root: TLayoutNode;
  activePaneId: string | null;
  previous: IGitSidePanelTarget | null;
}): IGitSidePanelTarget | null => {
  const { root, activePaneId, previous } = input;
  if (activePaneId) {
    const pane = findPane(root, activePaneId);
    const activeTab = pane?.tabs.find((candidate) => candidate.id === pane.activeTabId);
    if (pane && activeTab && isSessionBackedTab(activeTab)) {
      return {
        paneId: pane.id,
        tabId: activeTab.id,
        sessionName: activeTab.sessionName,
        panelType: normalizeTabPanelType(activeTab),
      };
    }
  }

  if (previous) {
    for (const pane of collectPanes(root)) {
      const tab = pane.tabs.find((candidate) => candidate.id === previous.tabId);
      if (tab && isSessionBackedTab(tab)) {
        return {
          paneId: pane.id,
          tabId: tab.id,
          sessionName: tab.sessionName,
          panelType: normalizeTabPanelType(tab),
        };
      }
    }
  }

  return null;
};

export const canAskAgentFromSidePanel = (input: {
  root: TLayoutNode;
  target: IGitSidePanelTarget | null;
}): boolean => {
  const { root, target } = input;
  if (!target) return false;
  if (target.panelType === 'diff' || target.panelType === 'web-browser') return false;
  const pane = findPane(root, target.paneId);
  return pane?.activeTabId === target.tabId;
};

export const sidePanelAskAgentType = (target: IGitSidePanelTarget): TAgentPanelType =>
  isAgentPanelType(target.panelType) ? target.panelType : DEFAULT_AGENT_PANEL_TYPE;

export const isAgentTurnEnd = (
  previous: TCliState | undefined,
  next: TCliState | undefined,
): boolean =>
  previous === 'busy' && (next === 'ready-for-review' || next === 'idle');

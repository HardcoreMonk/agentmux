import { isAgentPanelType } from '@/lib/panel-type';
import type { TTabDisplayStatus } from '@/types/status';
import type { TPanelType } from '@/types/terminal';

export type TWorkspaceActivityStatus = TTabDisplayStatus | 'checking';

interface IWorkspaceActivityTab {
  status: TTabDisplayStatus;
  panelType?: TPanelType;
}

const STATUS_PRIORITY: Record<TTabDisplayStatus, number> = {
  'needs-input': 0,
  busy: 1,
  'ready-for-review': 2,
  unknown: 3,
  idle: 4,
};

export const getWorkspaceActivityStatus = (
  tabs: readonly IWorkspaceActivityTab[],
  statusReady: boolean,
): TWorkspaceActivityStatus => {
  if (!statusReady) return 'checking';

  let activity: TTabDisplayStatus = 'idle';
  for (const tab of tabs) {
    if (isAgentPanelType(tab.panelType) && STATUS_PRIORITY[tab.status] < STATUS_PRIORITY[activity]) {
      activity = tab.status;
    }
  }
  return activity;
};

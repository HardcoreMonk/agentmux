import type { TAgentPanelType } from '@/types/terminal';

export const requestAgentLaunch = async (input: {
  workspaceId: string;
  paneId: string;
  tabId: string;
  action?: 'launch' | 'resume';
  sessionId?: string;
  panelType?: TAgentPanelType;
}): Promise<boolean> => {
  const response = await fetch('/api/agent/launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'launch', ...input }),
  });
  return response.ok;
};

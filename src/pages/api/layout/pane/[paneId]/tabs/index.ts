import type { NextApiRequest, NextApiResponse } from 'next';
import { getActiveWorkspaceId } from '@/lib/workspace-store';
import { getProviderByPanelType } from '@/lib/providers';
import { createLogger } from '@/lib/logger';
import { DEFAULT_AGENT_PANEL_TYPE, isAgentPanelType, normalizePanelType } from '@/lib/panel-type';
import { createWorkspaceTab } from '@/lib/workspace-tab-service';

const log = createLogger('layout');

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const wsId = (req.query.workspace as string) || await getActiveWorkspaceId();
  if (!wsId) {
    return res.status(400).json({ error: 'No workspace found' });
  }

  const paneId = req.query.paneId as string;
  const { name, cwd, command, resumeSessionId, startAgent } = req.body ?? {};
  const panelType = normalizePanelType(req.body?.panelType);

  const rawPanelType = req.body?.panelType;
  if (resumeSessionId && rawPanelType !== undefined && rawPanelType !== null && rawPanelType !== ''
    && !isAgentPanelType(panelType)) {
    return res.status(400).json({ error: 'Unknown panel type for resume' });
  }

  if (resumeSessionId) {
    const provider = getProviderByPanelType(panelType ?? DEFAULT_AGENT_PANEL_TYPE);
    if (!provider) {
      return res.status(400).json({ error: 'Unknown panel type for resume' });
    }
    if (!provider.isValidSessionId(resumeSessionId)) {
      return res.status(400).json({ error: 'Invalid session ID format' });
    }
  }

  try {
    const tab = await createWorkspaceTab({
      workspaceId: wsId,
      paneId,
      name,
      cwd,
      panelType,
      command,
      resumeSessionId,
      startAgent,
    });
    if (!tab) {
      return res.status(404).json({ error: 'Pane not found' });
    }
    return res.status(200).json(tab);
  } catch (err) {
    log.error(`tab creation failed: ${err instanceof Error ? err.message : err}`);
    return res.status(500).json({ error: 'Failed to create tab' });
  }
};

export default handler;

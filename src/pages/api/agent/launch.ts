import type { NextApiRequest, NextApiResponse } from 'next';
import { launchAgentInTab } from '@/lib/agent-launch-service';
import { isAgentPanelType } from '@/lib/panel-type';
import { createLogger } from '@/lib/logger';

const log = createLogger('agent-launch');

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { workspaceId, paneId, tabId, action, sessionId, panelType } = req.body ?? {};
  if (typeof workspaceId !== 'string' || typeof paneId !== 'string' || typeof tabId !== 'string'
    || (action !== 'launch' && action !== 'resume')) {
    return res.status(400).json({ error: 'invalid-request' });
  }
  if (panelType !== undefined && !isAgentPanelType(panelType)) {
    return res.status(400).json({ error: 'invalid-request' });
  }

  try {
    const result = await launchAgentInTab({ workspaceId, paneId, tabId, action, sessionId, panelType });
    if (!result.ok) {
      const status = result.code === 'tab-not-found' ? 404 : result.code === 'unsafe-process' || result.code === 'runtime-v2-agent-unsupported' ? 409 : 400;
      return res.status(status).json(result);
    }
    return res.status(204).end();
  } catch (err) {
    log.warn('agent launch failed: %s', err instanceof Error ? err.message : String(err));
    return res.status(500).json({ error: 'agent-launch-failed' });
  }
};

export default handler;

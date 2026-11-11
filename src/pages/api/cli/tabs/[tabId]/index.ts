import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCliToken } from '@/lib/cli-token';
import { findTab } from '@/lib/cli-utils';
import { resolveCliCaller, sendCliError, sendCliServiceError } from '@/lib/cli-caller';
import { createLogger } from '@/lib/logger';
import { closeWorkspaceTab } from '@/lib/workspace-tab-service';

const log = createLogger('api:cli:tabs');

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (!verifyCliToken(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const tabId = req.query.tabId as string;
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;

  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  if (req.method === 'GET') {
    const found = await findTab(workspaceId, tabId);
    if (!found) return res.status(404).json({ error: 'Tab not found' });
    return res.status(200).json({
      tabId: found.tab.id,
      workspaceId: found.workspaceId,
      paneId: found.paneId,
      name: found.tab.name,
      sessionName: found.tab.sessionName,
      panelType: found.tab.panelType,
    });
  }

  if (req.method === 'DELETE') {
    try {
      const resolved = await resolveCliCaller(req);
      if (!resolved.ok) {
        return sendCliError(res, resolved.status, resolved.code, 'The calling tab was not found in any workspace');
      }
      const found = await findTab(workspaceId, tabId);
      if (!found) return res.status(404).json({ error: 'Tab not found' });
      if (resolved.caller && found.tab.createdByTabId !== resolved.caller.tab.id) {
        return sendCliError(res, 403, 'delegation-close-forbidden', 'An agent can close only the tabs it created');
      }
      const ok = await closeWorkspaceTab(workspaceId, found.paneId, tabId);
      return res.status(200).json({ ok });
    } catch (err) {
      log.error(`close tab failed: ${err instanceof Error ? err.message : err}`);
      return sendCliServiceError(res, err);
    }
  }

  res.setHeader('Allow', 'GET, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
};

export default handler;

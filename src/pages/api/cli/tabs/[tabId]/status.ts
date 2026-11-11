import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCliToken } from '@/lib/cli-token';
import { findTab } from '@/lib/cli-utils';
import { sendCliServiceError } from '@/lib/cli-caller';
import { createLogger } from '@/lib/logger';
import { getPaneCurrentCommand } from '@/lib/tmux';
import { readAgentSessionId } from '@/lib/agent-tab-fields';
import { getProviderByPanelType } from '@/lib/providers';
import { resolveTabRuntimeVersion } from '@/lib/runtime/terminal-mode';
import { isTabSessionAlive, readTabCliState } from '@/lib/workspace-tab-service';

const log = createLogger('api:cli:tabs');

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyCliToken(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const tabId = req.query.tabId as string;
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  const found = await findTab(workspaceId, tabId);
  if (!found) return res.status(404).json({ error: 'Tab not found' });
  const { tab } = found;

  try {
    const alive = await isTabSessionAlive(tab);
    const command = alive && resolveTabRuntimeVersion(tab) === 1
      ? await getPaneCurrentCommand(tab.sessionName)
      : null;
    return res.status(200).json({
      tabId,
      workspaceId,
      panelType: tab.panelType ?? null,
      providerId: getProviderByPanelType(tab.panelType)?.id ?? null,
      alive,
      command,
      cliState: await readTabCliState(tab),
      agentSessionId: readAgentSessionId(tab),
      createdByTabId: tab.createdByTabId ?? null,
    });
  } catch (err) {
    log.error(`read tab status failed: ${err instanceof Error ? err.message : err}`);
    return sendCliServiceError(res, err);
  }
};

export default handler;

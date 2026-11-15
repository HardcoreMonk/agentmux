import type { NextApiRequest, NextApiResponse } from 'next';
import { isAgentReportText } from '@/lib/agent-report';
import { verifyCliToken } from '@/lib/cli-token';
import { findTab } from '@/lib/cli-utils';
import { resolveCliCaller, sendCliError, sendCliServiceError } from '@/lib/cli-caller';
import { createLogger } from '@/lib/logger';
import { isAgentPanelType } from '@/lib/panel-type';
import {
  checkAgentInputTarget,
  isTabSessionAlive,
  readTabCliState,
  writeTabInput,
} from '@/lib/workspace-tab-service';

const log = createLogger('api:cli:tabs');

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
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

  const { content } = req.body as { content?: string };
  if (!content) {
    return res.status(400).json({ error: 'content is required' });
  }

  const found = await findTab(workspaceId, tabId);
  if (!found) return res.status(404).json({ error: 'Tab not found' });
  const { tab } = found;

  try {
    const resolved = await resolveCliCaller(req);
    if (!resolved.ok) {
      return sendCliError(res, resolved.status, resolved.code, 'The calling tab was not found in any workspace');
    }
    if (resolved.caller && isAgentReportText(content)) {
      return sendCliError(
        res,
        400,
        'reserved-report-prefix',
        'Agent calls cannot send text that starts with "[agentmux report"; that prefix is reserved for server reports',
      );
    }
    // Agents pre-allow `tab send`; typing into a shell tab would run commands without the agent's own approval.
    if (resolved.caller && !isAgentPanelType(tab.panelType)) {
      return sendCliError(res, 403, 'delegation-send-forbidden', 'An agent can send only to agent tabs');
    }

    const alive = await isTabSessionAlive(tab);
    if (!alive) return res.status(409).json({ error: 'Tab session is not running' });

    if (!isAgentPanelType(tab.panelType)) {
      await writeTabInput(tab, content);
      return res.status(200).json({ status: 'sent' });
    }

    const cliState = await readTabCliState(tab);
    const check = await checkAgentInputTarget(tab, cliState);
    if (!check.ok) {
      return sendCliError(res, 409, check.code, check.message);
    }

    const { followUpEnterSkipped } = await writeTabInput(tab, content, { guardFollowUpEnter: true });
    return res.status(200).json({ status: 'sent', cliState, followUpEnterSkipped });
  } catch (err) {
    log.error(`send to tab failed: ${err instanceof Error ? err.message : err}`);
    return sendCliServiceError(res, err);
  }
};

export default handler;

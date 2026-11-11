import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCliToken } from '@/lib/cli-token';
import { findTab } from '@/lib/cli-utils';
import { resolveCliCaller, sendCliError, sendCliServiceError } from '@/lib/cli-caller';
import { createLogger } from '@/lib/logger';
import { isAgentPanelType } from '@/lib/panel-type';
import { hasPermissionPrompt } from '@/lib/permission-prompt';
import { matchAgentStartupScreen } from '@/lib/agent-startup-screen';
import {
  isAgentProcessRunning,
  isTabSessionAlive,
  readTabCliState,
  readTabScreen,
  writeTabInput,
} from '@/lib/workspace-tab-service';
import type { TCliState } from '@/types/timeline';

const log = createLogger('api:cli:tabs');

const SENDABLE_STATES = new Set<TCliState>(['idle', 'busy', 'ready-for-review']);

const STARTUP_SCREEN_LABELS = {
  trust: 'folder trust',
  'codex-update': 'Codex update',
  'codex-hooks-review': 'Codex hook review',
} as const;

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
    if (cliState === 'needs-input') {
      return sendCliError(res, 409, 'target-needs-input', 'The target agent is waiting for the user to answer a prompt');
    }
    if (!cliState || !SENDABLE_STATES.has(cliState)) {
      return sendCliError(res, 409, 'target-not-ready', `The target agent is not ready (state: ${cliState ?? 'unknown'})`);
    }
    if (!(await isAgentProcessRunning(tab))) {
      return sendCliError(res, 409, 'target-not-ready', 'The agent is not running in the target tab');
    }
    const screen = await readTabScreen(tab);
    if (screen === null) {
      return sendCliError(res, 409, 'target-not-ready', 'The target tab screen could not be read');
    }
    // The trust screen's numbered choices also look like a permission prompt, so match it first.
    const startupScreen = matchAgentStartupScreen(screen);
    if (startupScreen) {
      return sendCliError(
        res,
        409,
        'target-not-ready',
        `The target tab shows the ${STARTUP_SCREEN_LABELS[startupScreen]} screen`,
      );
    }
    if (hasPermissionPrompt(screen)) {
      return sendCliError(res, 409, 'target-needs-input', 'The target tab shows a permission prompt');
    }

    const { followUpEnterSkipped } = await writeTabInput(tab, content, { guardFollowUpEnter: true });
    return res.status(200).json({ status: 'sent', cliState, followUpEnterSkipped });
  } catch (err) {
    log.error(`send to tab failed: ${err instanceof Error ? err.message : err}`);
    return sendCliServiceError(res, err);
  }
};

export default handler;

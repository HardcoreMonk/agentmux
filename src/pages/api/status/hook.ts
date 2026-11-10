import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCliToken } from '@/lib/cli-token';
import { getStatusManager } from '@/lib/status-manager';
import { createLogger } from '@/lib/logger';
import { getRuntimeStatusV2Mode } from '@/lib/runtime/status-mode';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';
import { verifyAgentHookCapability } from '@/lib/agent-hooks';
import { getProviderByPanelType } from '@/lib/providers';
import { isJsonlPathUnderRoots } from '@/lib/path-validation';
import { parseSessionName, readLayoutFile, resolveLayoutFile } from '@/lib/layout-store';
import { findPane } from '@/lib/layout-tree';
import { recordPerfCounter } from '@/lib/perf-metrics';
import type { ITab } from '@/types/terminal';

const log = createLogger('hooks');

const shouldUseRuntimeStatusLive = (): boolean =>
  process.env.AGENTMUX_RUNTIME_V2 === '1' && getRuntimeStatusV2Mode() === 'default';

const HOOK_SOURCES = new Set(['startup', 'resume', 'clear', 'compact', 'fork']);
const NOTIFICATION_TYPE_PATTERN = /^[a-z_]{1,64}$/;

interface IHookEventOptions {
  notificationType?: string;
  agentSessionId?: string;
  transcriptPath?: string;
  source?: string;
}

const findHookTarget = async (sessionName: string, capability: string): Promise<ITab | null> => {
  const parsed = parseSessionName(sessionName);
  const verified = verifyAgentHookCapability(capability, sessionName);
  if (!parsed || !verified || verified.tabId !== parsed.tabId) return null;
  const layout = await readLayoutFile(resolveLayoutFile(parsed.wsId));
  const pane = layout ? findPane(layout.root, parsed.paneId) : null;
  const tab = pane?.tabs.find((candidate) => candidate.id === parsed.tabId);
  return tab?.sessionName === sessionName ? tab : null;
};

const sanitizeHookOptions = (body: Record<string, unknown>, tab: ITab): IHookEventOptions => {
  const provider = getProviderByPanelType(tab.panelType);
  const options: IHookEventOptions = {};
  const { notificationType, agentSessionId, transcriptPath, source } = body;
  if (typeof notificationType === 'string' && NOTIFICATION_TYPE_PATTERN.test(notificationType)) {
    options.notificationType = notificationType;
  }
  if (provider && provider.isValidSessionId(agentSessionId)) options.agentSessionId = agentSessionId;
  // Only the tab's own provider roots: a Claude tab must not bind a Codex transcript (or vice versa).
  if (provider && typeof transcriptPath === 'string' && isJsonlPathUnderRoots(transcriptPath, provider.jsonlRoots())) {
    options.transcriptPath = transcriptPath;
  }
  if (typeof source === 'string' && HOOK_SOURCES.has(source)) options.source = source;
  return options;
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyCliToken(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const body: Record<string, unknown> = req.body ?? {};
  const { event, session, capability } = body;
  if (typeof event === 'string' && event !== 'poll' && typeof session === 'string' && session) {
    const tab = typeof capability === 'string' ? await findHookTarget(session, capability) : null;
    if (!tab) {
      recordPerfCounter('status.hook_bridge.rejected');
      log.warn({ event }, 'rejected status hook target');
      return res.status(403).json({ error: 'Invalid hook target' });
    }
    const options = sanitizeHookOptions(body, tab);
    const type = options.notificationType;
    log.debug({ event, session, notificationType: type, source: options.source }, `received ${event}${type ? `(${type})` : ''}`);
    if (shouldUseRuntimeStatusLive()) {
      try {
        await getRuntimeSupervisor().sendStatusLiveHookEvent({ tmuxSession: session, event, ...options });
        return res.status(204).end();
      } catch (err) {
        log.warn('runtime status hook failed, falling back: %s', err instanceof Error ? err.message : String(err));
      }
    }
    getStatusManager().updateTabFromHook(session, event, options);
  } else {
    log.debug('poll trigger');
    if (shouldUseRuntimeStatusLive()) {
      try {
        await getRuntimeSupervisor().pollStatusLive();
        return res.status(204).end();
      } catch (err) {
        log.warn('runtime status poll failed, falling back: %s', err instanceof Error ? err.message : String(err));
      }
    }
    getStatusManager().poll().catch((err) => {
      log.error({ err }, 'Poll trigger failed');
    });
  }

  return res.status(204).end();
};

export default handler;

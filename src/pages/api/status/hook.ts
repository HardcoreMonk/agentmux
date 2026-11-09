import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCliToken } from '@/lib/cli-token';
import { getStatusManager } from '@/lib/status-manager';
import { createLogger } from '@/lib/logger';
import { getRuntimeStatusV2Mode } from '@/lib/runtime/status-mode';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';
import { verifyCodexHookCapability } from '@/lib/providers/codex/session-hooks';
import { parseSessionName, readLayoutFile, resolveLayoutFile } from '@/lib/layout-store';
import { findPane } from '@/lib/layout-tree';
import { recordPerfCounter } from '@/lib/perf-metrics';

const log = createLogger('hooks');

const shouldUseRuntimeStatusLive = (): boolean =>
  process.env.AGENTMUX_RUNTIME_V2 === '1' && getRuntimeStatusV2Mode() === 'default';

const verifyHookTarget = async (sessionName: string, capability: string): Promise<boolean> => {
  const parsed = parseSessionName(sessionName);
  const verified = verifyCodexHookCapability(capability, sessionName);
  if (!parsed || !verified || verified.tabId !== parsed.tabId) return false;
  const layout = await readLayoutFile(resolveLayoutFile(parsed.wsId));
  const pane = layout ? findPane(layout.root, parsed.paneId) : null;
  const tab = pane?.tabs.find((candidate) => candidate.id === parsed.tabId);
  return tab?.sessionName === sessionName;
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyCliToken(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { event, session, capability, notificationType } = req.body ?? {};
  if (typeof event === 'string' && event !== 'poll' && typeof session === 'string' && session) {
    if (typeof capability !== 'string' || !await verifyHookTarget(session, capability)) {
      recordPerfCounter('status.hook_bridge.rejected');
      log.warn({ event }, 'rejected status hook target');
      return res.status(403).json({ error: 'Invalid hook target' });
    }
    const type = typeof notificationType === 'string' && notificationType ? notificationType : undefined;
    log.debug({ event, session, notificationType: type }, `received ${event}${type ? `(${type})` : ''}`);
    if (shouldUseRuntimeStatusLive()) {
      try {
        await getRuntimeSupervisor().sendStatusLiveHookEvent({ tmuxSession: session, event, ...(type ? { notificationType: type } : {}) });
        return res.status(204).end();
      } catch (err) {
        log.warn('runtime status hook failed, falling back: %s', err instanceof Error ? err.message : String(err));
      }
    }
    getStatusManager().updateTabFromHook(session, event, type);
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

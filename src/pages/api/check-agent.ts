import type { NextApiRequest, NextApiResponse } from 'next';
import { getSessionPanePid, hasSession } from '@/lib/tmux';
import { getChildPids } from '@/lib/session-detection';
import type { TAgentPanelType } from '@/types/terminal';
import { detectAnyActiveSession, isAnyAgentRunning } from '@/lib/providers';

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = req.query.session as string | undefined;
  if (!session) {
    return res.status(400).json({ error: 'session parameter required' });
  }

  const checkedAt = Date.now();

  const exists = await hasSession(session);
  if (!exists) {
    return res.status(200).json({ running: false, checkedAt, sessionId: null, providerPanelType: null });
  }

  const panePid = await getSessionPanePid(session);
  if (!panePid) {
    return res.status(200).json({ running: false, checkedAt, sessionId: null, providerPanelType: null });
  }

  const childPids = await getChildPids(panePid);
  const running = await isAnyAgentRunning(panePid, childPids);
  if (!running) {
    return res.status(200).json({ running: false, checkedAt, sessionId: null, providerPanelType: null });
  }

  const { provider, info } = await detectAnyActiveSession(panePid, childPids);
  return res.status(200).json({
    running: true, checkedAt, sessionId: info.sessionId, resumable: !!info.jsonlPath,
    providerPanelType: (provider?.id as TAgentPanelType | undefined) ?? null,
  });
};

export default handler;

import type { NextApiRequest, NextApiResponse } from 'next';
import { RUNTIME_SESSION_PREFIX } from '@/lib/runtime/session-name';
import { resolveSessionCwd } from '@/lib/session-cwd';
import { getLastCommand } from '@/lib/tmux';
import { createLogger } from '@/lib/logger';

const log = createLogger('layout');

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = req.query.session as string | undefined;
  if (!session) {
    return res.status(400).json({ error: 'session parameter required' });
  }

  try {
    const { exists, cwd } = await resolveSessionCwd(session);
    if (!exists) {
      return res.status(404).json({ error: 'Session not found' });
    }
    if (!cwd) {
      return res.status(500).json({ error: 'Failed to get CWD' });
    }
    const lastCommand = session.startsWith(RUNTIME_SESSION_PREFIX)
      ? null
      : await getLastCommand(session);
    return res.status(200).json({ cwd, lastCommand });
  } catch (err) {
    log.error(`cwd query failed: ${err instanceof Error ? err.message : err}`);
    return res.status(500).json({ error: 'Failed to get CWD' });
  }
};

export default handler;

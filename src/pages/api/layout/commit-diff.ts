import type { NextApiRequest, NextApiResponse } from 'next';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { resolveSessionCwd } from '@/lib/session-cwd';
import { createLogger } from '@/lib/logger';

const execFile = promisify(execFileCb);
const log = createLogger('commit-diff');
const CMD_TIMEOUT = 10000;
const MAX_BUFFER = 10 * 1024 * 1024;

const FIELD = '\x1f';
const HASH_RE = /^[0-9a-f]{4,40}$/i;

interface ICommitMeta {
  hash: string;
  shortHash: string;
  subject: string;
  body: string;
  author: string;
  email: string;
  timestamp: number;
  parents: string[];
}

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = req.query.session as string | undefined;
  const hash = req.query.hash as string | undefined;

  if (!session || !hash) {
    return res.status(400).json({ error: 'session and hash parameters required' });
  }
  if (!HASH_RE.test(hash)) {
    return res.status(400).json({ error: 'Invalid hash format' });
  }

  const { exists, cwd } = await resolveSessionCwd(session);
  if (!exists) {
    return res.status(404).json({ error: 'Session not found' });
  }
  if (!cwd) {
    return res.status(500).json({ error: 'Failed to get CWD' });
  }

  try {
    const metaFormat = `%H${FIELD}%P${FIELD}%an${FIELD}%ae${FIELD}%at${FIELD}%s${FIELD}%b`;
    const { stdout: metaOut } = await execFile(
      'git',
      ['-C', cwd, 'log', '-1', `--format=${metaFormat}`, hash],
      { timeout: CMD_TIMEOUT },
    );

    const parts = metaOut.replace(/\n$/, '').split(FIELD);
    if (parts.length < 7) {
      return res.status(404).json({ error: 'Commit not found' });
    }
    const [fullHash, parentsStr, author, email, ts, subject, ...bodyParts] = parts;
    const parents = parentsStr.trim() ? parentsStr.trim().split(/\s+/) : [];

    const meta: ICommitMeta = {
      hash: fullHash,
      shortHash: fullHash.slice(0, 7),
      subject,
      body: bodyParts.join(FIELD).trim(),
      author,
      email,
      timestamp: parseInt(ts, 10) * 1000,
      parents,
    };

    const diffArgs = parents.length === 0
      ? ['-C', cwd, 'show', '--format=', fullHash]
      : ['-C', cwd, 'diff', `${fullHash}^..${fullHash}`];

    const { stdout: diff } = await execFile('git', diffArgs, {
      timeout: CMD_TIMEOUT,
      maxBuffer: MAX_BUFFER,
    });

    return res.status(200).json({ commit: meta, diff });
  } catch (err) {
    log.error(`commit-diff failed: ${err instanceof Error ? err.message : err}`);
    return res.status(500).json({ error: 'Failed to get commit diff' });
  }
};

export default handler;

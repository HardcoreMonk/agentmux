import type { NextApiRequest, NextApiResponse } from 'next';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { resolve, sep } from 'path';
import { resolveSessionCwd } from '@/lib/session-cwd';
import { createLogger } from '@/lib/logger';

const execFile = promisify(execFileCb);
const log = createLogger('file-content');

const CMD_TIMEOUT = 10_000;
const MAX_BYTES = 1_000_000;
const WORKTREE = 'WORKTREE';
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9_\-/.^~]{0,200}$/;

interface ISideResult {
  content: string;
  truncated: boolean;
  binary: boolean;
}

const EMPTY_SIDE: ISideResult = { content: '', truncated: false, binary: false };

const sanitizeRepoPath = (p: string | undefined | string[]): string | null => {
  if (!p || Array.isArray(p)) return null;
  if (p === '/dev/null') return null;
  if (p.includes('\0')) return null;
  if (p.startsWith('/')) return null;

  let depth = 0;
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      depth -= 1;
      if (depth < 0) return null;
    } else {
      depth += 1;
    }
  }
  return p;
};

const sanitizeRef = (r: string | string[] | undefined, fallback: string): string | null => {
  const v = Array.isArray(r) ? r[0] : r;
  if (!v) return fallback;
  if (v === WORKTREE) return WORKTREE;
  if (!REF_RE.test(v)) return null;
  return v;
};

const fromBuffer = (buf: Buffer): ISideResult => {
  if (buf.length > MAX_BYTES) return { content: '', truncated: true, binary: false };
  if (buf.includes(0)) return { content: '', truncated: false, binary: true };
  return { content: buf.toString('utf8'), truncated: false, binary: false };
};

const readFromRef = async (cwd: string, ref: string, relPath: string): Promise<ISideResult> => {
  try {
    const { stdout } = await execFile(
      'git',
      ['-C', cwd, 'show', `${ref}:${relPath}`],
      { timeout: CMD_TIMEOUT, maxBuffer: MAX_BYTES + 1024, encoding: 'buffer' },
    );
    return fromBuffer(stdout as unknown as Buffer);
  } catch {
    return EMPTY_SIDE;
  }
};

const readFromWorktree = async (cwd: string, relPath: string): Promise<ISideResult> => {
  try {
    const resolved = resolve(cwd, relPath);
    if (resolved !== cwd && !resolved.startsWith(cwd + sep)) return EMPTY_SIDE;
    const buf = await readFile(resolved);
    return fromBuffer(buf);
  } catch {
    return EMPTY_SIDE;
  }
};

const loadSide = (cwd: string, ref: string, relPath: string | null): Promise<ISideResult> => {
  if (!relPath) return Promise.resolve(EMPTY_SIDE);
  return ref === WORKTREE ? readFromWorktree(cwd, relPath) : readFromRef(cwd, ref, relPath);
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = typeof req.query.session === 'string' ? req.query.session : undefined;
  if (!session) return res.status(400).json({ error: 'session parameter required' });

  const oldPath = sanitizeRepoPath(req.query.oldPath);
  const newPath = sanitizeRepoPath(req.query.newPath);
  const oldRef = sanitizeRef(req.query.oldRef, 'HEAD');
  const newRef = sanitizeRef(req.query.newRef, WORKTREE);

  if (!oldRef || !newRef) return res.status(400).json({ error: 'Invalid ref' });
  if (!oldPath && !newPath) return res.status(400).json({ error: 'oldPath or newPath required' });

  const { exists, cwd } = await resolveSessionCwd(session);
  if (!exists) return res.status(404).json({ error: 'Session not found' });
  if (!cwd) return res.status(500).json({ error: 'Failed to get CWD' });

  try {
    const [oldSide, newSide] = await Promise.all([
      loadSide(cwd, oldRef, oldPath),
      loadSide(cwd, newRef, newPath),
    ]);

    const truncated = oldSide.truncated || newSide.truncated;
    const binary = oldSide.binary || newSide.binary;

    return res.status(200).json({
      oldContent: truncated || binary ? '' : oldSide.content,
      newContent: truncated || binary ? '' : newSide.content,
      truncated,
      binary,
    });
  } catch (err) {
    log.error(`file-content failed: ${err instanceof Error ? err.message : err}`);
    return res.status(500).json({ error: 'Failed to get file content' });
  }
};

export default handler;

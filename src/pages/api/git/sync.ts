import type { NextApiRequest, NextApiResponse } from 'next';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { resolveSessionCwd } from '@/lib/session-cwd';
import { createLogger } from '@/lib/logger';

const execFile = promisify(execFileCb);
const log = createLogger('git-sync');
const CMD_TIMEOUT = 30_000;

type TStepName = 'fetch' | 'pull' | 'push';
export type TSyncErrorKind = 'no-upstream' | 'auth' | 'diverged' | 'rejected' | 'local-changes' | 'timeout' | 'unknown';

interface IStep {
  name: TStepName;
  ok: boolean;
  skipped: boolean;
  stdout: string;
  stderr: string;
}

interface IGitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  killed: boolean;
}

const runGit = async (cwd: string, args: string[]): Promise<IGitResult> => {
  try {
    const { stdout, stderr } = await execFile('git', ['-C', cwd, ...args], {
      timeout: CMD_TIMEOUT,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { ok: true, stdout, stderr, killed: false };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
    return {
      ok: false,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? '',
      killed: Boolean(e.killed),
    };
  }
};

const classifyError = (step: IGitResult): TSyncErrorKind => {
  if (step.killed) return 'timeout';
  const s = (step.stderr + '\n' + step.stdout).toLowerCase();
  if (s.includes('no upstream') || s.includes("no tracking information")) return 'no-upstream';
  if (
    s.includes('authentication failed') ||
    s.includes('permission denied') ||
    s.includes('could not read from remote') ||
    s.includes('invalid credentials')
  ) return 'auth';
  if (
    s.includes('would be overwritten by merge') ||
    s.includes('would be overwritten by checkout') ||
    s.includes('commit your changes or stash them')
  ) return 'local-changes';
  if (s.includes('divergent') || s.includes('not possible to fast-forward') || s.includes('non-fast-forward')) {
    return step.stderr.toLowerCase().includes('push') ? 'rejected' : 'diverged';
  }
  if (s.includes('rejected') || s.includes('updates were rejected')) return 'rejected';
  return 'unknown';
};

const getAheadBehind = async (cwd: string): Promise<{ ahead: number; behind: number }> => {
  const res = await runGit(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
  if (!res.ok) return { ahead: 0, behind: 0 };
  const parts = res.stdout.trim().split(/\s+/);
  return {
    ahead: parseInt(parts[0], 10) || 0,
    behind: parseInt(parts[1], 10) || 0,
  };
};

const makeSkipped = (name: TStepName): IStep => ({
  name, ok: false, skipped: true, stdout: '', stderr: '',
});

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = req.query.session as string | undefined;
  if (!session) {
    return res.status(400).json({ error: 'session parameter required' });
  }

  const { exists, cwd } = await resolveSessionCwd(session);
  if (!exists) {
    return res.status(404).json({ error: 'Session not found' });
  }
  if (!cwd) {
    return res.status(500).json({ error: 'Failed to get CWD' });
  }

  const isRepo = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (!isRepo.ok) {
    return res.status(400).json({ error: 'Not a git repository' });
  }

  const upstreamRes = await runGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  const upstream = upstreamRes.ok ? upstreamRes.stdout.trim() : null;
  if (!upstream) {
    const branchRes = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const branch = branchRes.ok ? branchRes.stdout.trim() : 'HEAD';
    return res.status(200).json({
      ok: false,
      steps: [],
      summary: { pulled: 0, pushed: 0 },
      upstream: null,
      branch,
      errorKind: 'no-upstream' as TSyncErrorKind,
    });
  }

  const steps: IStep[] = [];

  const fetchRes = await runGit(cwd, ['fetch', '--prune']);
  steps.push({ name: 'fetch', ok: fetchRes.ok, skipped: false, stdout: fetchRes.stdout, stderr: fetchRes.stderr });
  if (!fetchRes.ok) {
    log.warn(`fetch failed: ${fetchRes.stderr}`);
    steps.push(makeSkipped('pull'));
    steps.push(makeSkipped('push'));
    return res.status(200).json({
      ok: false,
      steps,
      summary: { pulled: 0, pushed: 0 },
      upstream,
      errorKind: classifyError(fetchRes),
    });
  }

  const { behind } = await getAheadBehind(cwd);
  let pulled = 0;
  if (behind > 0) {
    const pullRes = await runGit(cwd, ['pull', '--ff-only']);
    steps.push({ name: 'pull', ok: pullRes.ok, skipped: false, stdout: pullRes.stdout, stderr: pullRes.stderr });
    if (!pullRes.ok) {
      log.warn(`pull failed: ${pullRes.stderr}`);
      steps.push(makeSkipped('push'));
      return res.status(200).json({
        ok: false,
        steps,
        summary: { pulled: 0, pushed: 0 },
        upstream,
        errorKind: classifyError(pullRes),
      });
    }
    pulled = behind;
  } else {
    steps.push(makeSkipped('pull'));
  }

  const { ahead } = await getAheadBehind(cwd);
  let pushed = 0;
  if (ahead > 0) {
    const pushRes = await runGit(cwd, ['push']);
    steps.push({ name: 'push', ok: pushRes.ok, skipped: false, stdout: pushRes.stdout, stderr: pushRes.stderr });
    if (!pushRes.ok) {
      log.warn(`push failed: ${pushRes.stderr}`);
      return res.status(200).json({
        ok: false,
        steps,
        summary: { pulled, pushed: 0 },
        upstream,
        errorKind: classifyError(pushRes),
      });
    }
    pushed = ahead;
  } else {
    steps.push(makeSkipped('push'));
  }

  return res.status(200).json({
    ok: true,
    steps,
    summary: { pulled, pushed },
    upstream,
  });
};

export default handler;

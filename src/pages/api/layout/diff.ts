import type { NextApiRequest, NextApiResponse } from 'next';
import { execFile as execFileCb } from 'child_process';
import { createHash } from 'crypto';
import { promisify } from 'util';
import { readFile, stat } from 'fs/promises';
import { resolve, sep } from 'path';
import { buildChangedFilesSignature, listPorcelainZPaths } from '@/lib/diff-hash-input';
import { resolveSessionCwd } from '@/lib/session-cwd';
import { createLogger } from '@/lib/logger';
import { getPerfNow, recordPerfCounter, recordPerfDuration } from '@/lib/perf-metrics';

const execFile = promisify(execFileCb);
const log = createLogger('diff');
const CMD_TIMEOUT = 10000;
const FETCH_TIMEOUT = 20000;
const MAX_DIFF_BYTES = 5 * 1024 * 1024;
const MAX_UNTRACKED_FILES = 50;
const MAX_UNTRACKED_TEXT_BYTES = 256 * 1024;
const MAX_UNTRACKED_DIFF_BYTES = 2 * 1024 * 1024;
const BINARY_SAMPLE_BYTES = 8192;
const DIFF_CACHE_TTL_MS = 60_000;
const MAX_DIFF_CACHE_ENTRIES = 32;

interface IDiffContentCacheEntry {
  diff: string;
  untrackedIncluded: number;
  untrackedSkipped: number;
  untrackedTotal: number;
  updatedAt: number;
}

const g = globalThis as unknown as {
  __ptDiffContentCache?: Map<string, IDiffContentCacheEntry>;
};

const diffContentCache = g.__ptDiffContentCache ??= new Map<string, IDiffContentCacheEntry>();

const makeDiffCacheKey = (cwd: string, hash: string): string =>
  createHash('sha1').update(`${cwd}\0${hash}`).digest('hex');

const readDiffCache = (key: string): IDiffContentCacheEntry | null => {
  const cached = diffContentCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.updatedAt > DIFF_CACHE_TTL_MS) {
    diffContentCache.delete(key);
    return null;
  }
  diffContentCache.delete(key);
  diffContentCache.set(key, cached);
  return cached;
};

const writeDiffCache = (key: string, entry: Omit<IDiffContentCacheEntry, 'updatedAt'>): void => {
  diffContentCache.set(key, { ...entry, updatedAt: Date.now() });
  while (diffContentCache.size > MAX_DIFF_CACHE_ENTRIES) {
    const oldest = diffContentCache.keys().next().value;
    if (!oldest) break;
    diffContentCache.delete(oldest);
  }
};

const getAheadBehind = async (cwd: string): Promise<{ ahead: number; behind: number }> => {
  const startedAt = getPerfNow();
  try {
    const { stdout } = await execFile(
      'git',
      ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'],
      { cwd, timeout: CMD_TIMEOUT },
    );
    const parts = stdout.trim().split(/\s+/);
    return {
      ahead: parseInt(parts[0], 10) || 0,
      behind: parseInt(parts[1], 10) || 0,
    };
  } catch {
    return { ahead: 0, behind: 0 };
  } finally {
    recordPerfDuration('diff.ahead_behind', getPerfNow() - startedAt);
  }
};

interface IHeadCommit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  timestamp: number;
}

interface IRepoMeta {
  branch: string;
  upstream: string | null;
  isDetached: boolean;
  stash: number;
  headCommit: IHeadCommit | null;
}

interface IUntrackedDiffResult {
  diff: string;
  included: number;
  skipped: number;
  total: number;
}

const FIELD = '\x1f';

const getRepoMeta = async (cwd: string): Promise<IRepoMeta> => {
  const [branchRes, upstreamRes, stashRes, headRes] = await Promise.allSettled([
    execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: CMD_TIMEOUT }),
    execFile('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { cwd, timeout: CMD_TIMEOUT }),
    execFile('git', ['stash', 'list'], { cwd, timeout: CMD_TIMEOUT }),
    execFile('git', ['log', '-1', `--format=%H${FIELD}%s${FIELD}%an${FIELD}%at`], { cwd, timeout: CMD_TIMEOUT }),
  ]);

  const branch = branchRes.status === 'fulfilled' ? branchRes.value.stdout.trim() : '';
  const upstream = upstreamRes.status === 'fulfilled' ? upstreamRes.value.stdout.trim() : null;
  const stashOut = stashRes.status === 'fulfilled' ? stashRes.value.stdout.trim() : '';
  const stash = stashOut ? stashOut.split('\n').length : 0;

  let headCommit: IHeadCommit | null = null;
  if (headRes.status === 'fulfilled') {
    const parts = headRes.value.stdout.trim().split(FIELD);
    if (parts.length >= 4) {
      const [hash, subject, author, ts] = parts;
      headCommit = {
        hash,
        shortHash: hash.slice(0, 7),
        subject,
        author,
        timestamp: parseInt(ts, 10) * 1000,
      };
    }
  }

  return {
    branch,
    upstream,
    isDetached: branch === 'HEAD',
    stash,
    headCommit,
  };
};

const getMeasuredRepoMeta = async (cwd: string): Promise<IRepoMeta> => {
  const startedAt = getPerfNow();
  try {
    return await getRepoMeta(cwd);
  } finally {
    recordPerfDuration('diff.repo_meta', getPerfNow() - startedAt);
  }
};

const computeDiffHash = async (cwd: string) => {
  const startedAt = getPerfNow();
  try {
    const [{ stdout: headOut }, { stdout: statusOut }, { stdout: shortstatOut }, { stdout: topOut }] = await Promise.all([
      execFile('git', ['rev-parse', 'HEAD'], { cwd, timeout: CMD_TIMEOUT }),
      execFile('git', ['status', '--porcelain', '-z', '-uall'], { cwd, timeout: CMD_TIMEOUT }),
      execFile('git', ['diff', '--no-ext-diff', 'HEAD', '--shortstat'], { cwd, timeout: CMD_TIMEOUT }),
      execFile('git', ['rev-parse', '--show-toplevel'], { cwd, timeout: CMD_TIMEOUT }),
    ]);
    // Porcelain paths are relative to the repository root, not to the session's folder.
    const signature = await buildChangedFilesSignature(topOut.trim() || cwd, listPorcelainZPaths(statusOut));
    return createHash('sha1')
      .update(`${headOut.trim()}\n${statusOut}\n${shortstatOut}\n${signature}`)
      .digest('hex')
      .slice(0, 16);
  } finally {
    recordPerfDuration('diff.compute_hash', getPerfNow() - startedAt);
  }
};

const resolveRepoPath = (cwd: string, file: string): string | null => {
  const resolved = resolve(/* turbopackIgnore: true */ cwd, file);
  if (resolved === cwd || resolved.startsWith(cwd + sep)) return resolved;
  return null;
};

const buildBinaryPlaceholder = (file: string): string => [
  `diff --git a/${file} b/${file}`,
  'new file mode 100644',
  `Binary files /dev/null and b/${file} differ`,
  '',
].join('\n');

const buildTextFileDiff = (file: string, content: string): string => {
  const lines = content.split('\n');
  if (lines.at(-1) === '') lines.pop();

  return [
    `diff --git a/${file} b/${file}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${file}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    '',
  ].join('\n');
};

const listUntrackedFiles = async (cwd: string): Promise<string[]> => {
  const { stdout } = await execFile(
    'git',
    ['ls-files', '--others', '--exclude-standard', '-z'],
    { cwd, timeout: CMD_TIMEOUT, maxBuffer: 1024 * 1024 },
  );
  return stdout.split('\0').filter(Boolean);
};

const buildUntrackedDiff = async (cwd: string): Promise<IUntrackedDiffResult> => {
  const files = await listUntrackedFiles(cwd);
  let diff = '';
  let included = 0;
  let skipped = 0;

  for (const file of files) {
    if (included >= MAX_UNTRACKED_FILES || Buffer.byteLength(diff, 'utf8') >= MAX_UNTRACKED_DIFF_BYTES) {
      skipped++;
      continue;
    }

    const resolved = resolveRepoPath(cwd, file);
    if (!resolved) {
      skipped++;
      continue;
    }

    try {
      const info = await stat(/* turbopackIgnore: true */ resolved);
      if (!info.isFile()) {
        skipped++;
        continue;
      }

      let fileDiff = '';
      if (info.size > MAX_UNTRACKED_TEXT_BYTES) {
        fileDiff = buildBinaryPlaceholder(file);
      } else {
        const content = await readFile(/* turbopackIgnore: true */ resolved);
        const sample = content.subarray(0, BINARY_SAMPLE_BYTES);
        fileDiff = sample.includes(0)
          ? buildBinaryPlaceholder(file)
          : buildTextFileDiff(file, content.toString('utf8'));
      }

      if (Buffer.byteLength(diff, 'utf8') + Buffer.byteLength(fileDiff, 'utf8') > MAX_UNTRACKED_DIFF_BYTES) {
        skipped++;
        continue;
      }

      diff += fileDiff;
      included++;
    } catch {
      skipped++;
    }
  }

  return {
    diff,
    included,
    skipped,
    total: files.length,
  };
};

const buildMeasuredUntrackedDiff = async (cwd: string): Promise<IUntrackedDiffResult> => {
  const startedAt = getPerfNow();
  try {
    const result = await buildUntrackedDiff(cwd);
    recordPerfCounter('diff.untracked.files', result.total);
    recordPerfCounter('diff.untracked.included', result.included);
    recordPerfCounter('diff.untracked.skipped', result.skipped);
    return result;
  } finally {
    recordPerfDuration('diff.untracked_build', getPerfNow() - startedAt);
  }
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = req.query.session as string | undefined;
  const hashOnly = req.query.hashOnly === 'true';
  const doFetch = req.query.fetch === 'true';

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

  try {
    await execFile('git', ['rev-parse', '--is-inside-work-tree'], { cwd, timeout: CMD_TIMEOUT });
  } catch {
    return res.status(200).json({ isGitRepo: false, diff: '', hash: '' });
  }

  let fetched = false;
  if (doFetch) {
    try {
      await execFile('git', ['fetch', '--prune'], { cwd, timeout: FETCH_TIMEOUT });
      fetched = true;
    } catch (err) {
      log.warn(`silent fetch failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  try {
    if (hashOnly) {
      const [hash, aheadBehind] = await Promise.all([
        computeDiffHash(cwd),
        getAheadBehind(cwd),
      ]);
      return res.status(200).json({
        isGitRepo: true,
        hash,
        ahead: aheadBehind.ahead,
        behind: aheadBehind.behind,
        fetched,
      });
    }

    const [hash, aheadBehind, meta] = await Promise.all([
      computeDiffHash(cwd),
      getAheadBehind(cwd),
      getMeasuredRepoMeta(cwd),
    ]);
    const cacheKey = makeDiffCacheKey(cwd, hash);
    const cached = readDiffCache(cacheKey);
    if (cached) {
      recordPerfCounter('diff.cache_hit');
      return res.status(200).json({
        isGitRepo: true,
        diff: cached.diff,
        hash,
        ahead: aheadBehind.ahead,
        behind: aheadBehind.behind,
        branch: meta.branch,
        upstream: meta.upstream,
        isDetached: meta.isDetached,
        stash: meta.stash,
        headCommit: meta.headCommit,
        fetched,
        untrackedIncluded: cached.untrackedIncluded,
        untrackedSkipped: cached.untrackedSkipped,
        untrackedTotal: cached.untrackedTotal,
      });
    }

    recordPerfCounter('diff.cache_miss');
    const trackedStartedAt = getPerfNow();
    const [{ stdout: diff }, untracked] = await Promise.all([
      execFile('git', ['diff', '--no-ext-diff', 'HEAD'], { cwd, timeout: CMD_TIMEOUT, maxBuffer: MAX_DIFF_BYTES })
        .finally(() => recordPerfDuration('diff.tracked_build', getPerfNow() - trackedStartedAt)),
      buildMeasuredUntrackedDiff(cwd),
    ]);

    const fullDiff = diff + untracked.diff;
    writeDiffCache(cacheKey, {
      diff: fullDiff,
      untrackedIncluded: untracked.included,
      untrackedSkipped: untracked.skipped,
      untrackedTotal: untracked.total,
    });

    return res.status(200).json({
      isGitRepo: true,
      diff: fullDiff,
      hash,
      ahead: aheadBehind.ahead,
      behind: aheadBehind.behind,
      branch: meta.branch,
      upstream: meta.upstream,
      isDetached: meta.isDetached,
      stash: meta.stash,
      headCommit: meta.headCommit,
      fetched,
      untrackedIncluded: untracked.included,
      untrackedSkipped: untracked.skipped,
      untrackedTotal: untracked.total,
    });
  } catch (err) {
    log.error(`git diff failed: ${err instanceof Error ? err.message : err}`);
    return res.status(500).json({ error: 'Failed to get diff' });
  }
};

export default handler;

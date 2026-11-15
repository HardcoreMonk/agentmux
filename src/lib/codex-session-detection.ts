import fs from 'fs/promises';
import { watch, type FSWatcher } from 'fs';
import path from 'path';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import type { ISessionInfo } from '@/types/timeline';
import type { ISessionWatcher } from '@/lib/session-detection';
import { getChildPids, getDescendantPids, getProcessCommandLine, getProcessCwd, getProcessStartTime, isProcessRunning } from '@/lib/session-detection';
import { getShellPath } from '@/lib/preflight';
import { getCodexHomeDir } from '@/lib/path-validation';
import { findIndexedCodexSessionJsonl } from '@/lib/session-index';
import { parseCodexJsonlContent } from '@/lib/codex-session-parser';
import type { IAgentPromptClaim } from '@/lib/providers/types';

const execFile = promisify(execFileCb);

const getCodexSessionsRoot = (): string => path.join(getCodexHomeDir(), 'sessions');
const SESSION_SCAN_LIMIT = 100;
const WATCH_POLL_INTERVAL = 1500;
const INSTALL_CHECK_INTERVAL = 60_000;
const PROCESS_SESSION_START_TOLERANCE_MS = 120_000;
const PROMPT_CLAIM_PAST_TOLERANCE_MS = 10_000;
const PROMPT_CLAIM_FUTURE_WINDOW_MS = 5 * 60_000;
const PROMPT_CLAIM_TAIL_BYTES = 256_000;

interface ICodexProcess {
  pid: number;
  cwd: string | null;
  sessionId: string | null;
  startedAt: number | null;
}

export interface ICodexSessionMeta {
  sessionId: string;
  jsonlPath: string;
  cwd: string | null;
  startedAt: number | null;
  mtimeMs: number;
}

const THREAD_ID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

interface IFindCodexSessionJsonlOptions {
  processStartedAt?: number | null;
  allowCwdFallback?: boolean;
}

const extractThreadId = (value: string | null | undefined): string | null =>
  value?.match(THREAD_ID_RE)?.[1] ?? null;

const normalizePromptClaimText = (value: string): string =>
  value.replace(/\r\n/g, '\n').trim();

const readTailContent = async (filePath: string, maxBytes: number): Promise<string> => {
  const stat = await fs.stat(filePath);
  const from = Math.max(0, stat.size - maxBytes);
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(stat.size - from);
    await handle.read(buffer, 0, buffer.length, from);
    const raw = buffer.toString('utf-8');
    if (from === 0) return raw;
    const firstNewline = raw.indexOf('\n');
    return firstNewline >= 0 ? raw.slice(firstNewline + 1) : '';
  } finally {
    await handle.close();
  }
};

const collectProcessTree = async (panePid: number, preloadedChildPids?: number[]): Promise<number[]> => {
  const direct = preloadedChildPids ?? await getChildPids(panePid);
  const descendants = (await Promise.all(direct.map(getDescendantPids))).flat();
  return [...new Set([...direct, ...descendants])];
};

const findCodexProcess = async (
  panePid: number,
  preloadedChildPids?: number[],
): Promise<ICodexProcess | null> => {
  const pids = await collectProcessTree(panePid, preloadedChildPids);
  for (const pid of pids) {
    try {
      const commandLine = await getProcessCommandLine(pid);
      if (!commandLine || !/\bcodex\b/.test(commandLine.raw)) continue;
      return {
        pid,
        cwd: await getProcessCwd(pid),
        sessionId: extractThreadId(commandLine.raw),
        startedAt: await getProcessStartTime(pid),
      };
    } catch {
      continue;
    }
  }
  return null;
};

const isCodexInstalled = async (): Promise<boolean> => {
  try {
    await execFile('codex', ['--version'], {
      timeout: 5000,
      env: { ...process.env, PATH: await getShellPath() },
    });
    return true;
  } catch {
    return false;
  }
};

const collectJsonlFiles = async (dir: string, depth = 0): Promise<string[]> => {
  if (depth > 4) return [];
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectJsonlFiles(fullPath, depth + 1));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(fullPath);
    }
  }
  return files;
};

const readSessionMeta = async (jsonlPath: string): Promise<ICodexSessionMeta | null> => {
  let stat: import('fs').Stats;
  try {
    stat = await fs.stat(jsonlPath);
  } catch {
    return null;
  }

  const fallbackId = extractThreadId(path.basename(jsonlPath, '.jsonl'));
  let sessionId = fallbackId;
  let cwd: string | null = null;
  let startedAt: number | null = null;

  try {
    const handle = await fs.open(jsonlPath, 'r');
    try {
      const readSize = Math.min(stat.size, 64 * 1024);
      const buffer = Buffer.alloc(readSize);
      await handle.read(buffer, 0, readSize, 0);
      for (const line of buffer.toString('utf-8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line);
          if (!record.payload || typeof record.payload !== 'object') continue;
          const payload = record.payload as Record<string, unknown>;

          if (record.type === 'session_meta') {
            if (typeof payload.id === 'string') sessionId = payload.id;
            if (typeof payload.cwd === 'string') cwd = payload.cwd;
            const ts = typeof payload.timestamp === 'string'
              ? Date.parse(payload.timestamp)
              : Date.parse(record.timestamp);
            if (Number.isFinite(ts)) startedAt = ts;
            continue;
          }

          if (record.type === 'turn_context') {
            if (typeof payload.cwd === 'string') cwd = payload.cwd;
            continue;
          }

          if (record.type === 'event_msg' && payload.type === 'task_started') {
            const startedAtSeconds = payload.started_at;
            if (typeof startedAtSeconds === 'number' && Number.isFinite(startedAtSeconds)) {
              startedAt = startedAtSeconds * 1000;
            }
          }
        } catch {
          continue;
        }
      }
    } finally {
      await handle.close();
    }
  } catch {
    // keep fallback id
  }

  if (!sessionId) return null;
  return { sessionId, jsonlPath, cwd, startedAt, mtimeMs: stat.mtimeMs };
};

export const findCodexSessionJsonl = async (
  sessionId?: string | null,
  cwd?: string | null,
  options: IFindCodexSessionJsonlOptions = {},
): Promise<ICodexSessionMeta | null> => {
  const indexed = await findIndexedCodexSessionJsonl(sessionId, cwd, options);
  if (indexed) return indexed;

  const files = await collectJsonlFiles(getCodexSessionsRoot());
  const metas = (await Promise.all(files.map(readSessionMeta)))
    .filter((meta): meta is ICodexSessionMeta => !!meta)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const normalizedSessionId = extractThreadId(sessionId) ?? sessionId;
  if (normalizedSessionId) {
    const byId = metas.find((meta) => meta.sessionId === normalizedSessionId);
    if (byId) return byId;
  }

  if (cwd && options.processStartedAt !== undefined && options.processStartedAt !== null) {
    const candidates = metas
      .filter((meta) => meta.cwd === cwd && meta.startedAt !== null)
      .map((meta) => ({
        meta,
        delta: Math.abs(meta.startedAt! - options.processStartedAt!),
      }))
      .filter((candidate) => candidate.delta <= PROCESS_SESSION_START_TOLERANCE_MS)
      .sort((a, b) => a.delta - b.delta || b.meta.mtimeMs - a.meta.mtimeMs);
    if (candidates[0]) return candidates[0].meta;
  }

  if (!options.allowCwdFallback) return null;

  const candidates = cwd
    ? metas.filter((meta) => meta.cwd === cwd)
    : metas;
  return candidates.slice(0, SESSION_SCAN_LIMIT)[0] ?? null;
};

export const findCodexSessionJsonlByPromptClaim = async (
  cwd: string | null | undefined,
  claim: IAgentPromptClaim,
): Promise<ICodexSessionMeta | null> => {
  const message = normalizePromptClaimText(claim.message);
  if (!cwd || !message || !Number.isFinite(claim.sentAt)) return null;

  const lowerBound = claim.sentAt - PROMPT_CLAIM_PAST_TOLERANCE_MS;
  const upperBound = claim.sentAt + PROMPT_CLAIM_FUTURE_WINDOW_MS;
  const files = await collectJsonlFiles(getCodexSessionsRoot());
  const metas = (await Promise.all(files.map(readSessionMeta)))
    .filter((meta): meta is ICodexSessionMeta => !!meta && meta.cwd === cwd)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, SESSION_SCAN_LIMIT);

  const matches: Array<{ meta: ICodexSessionMeta; timestamp: number }> = [];
  for (const meta of metas) {
    let content = '';
    try {
      content = await readTailContent(meta.jsonlPath, PROMPT_CLAIM_TAIL_BYTES);
    } catch {
      continue;
    }

    const userMessages = parseCodexJsonlContent(content)
      .filter((entry) => entry.type === 'user-message')
      .filter((entry) => normalizePromptClaimText(entry.text) === message)
      .filter((entry) => entry.timestamp >= lowerBound && entry.timestamp <= upperBound)
      .sort((a, b) => b.timestamp - a.timestamp);

    if (userMessages[0]) {
      matches.push({ meta, timestamp: userMessages[0].timestamp });
    }
  }

  if (matches.length !== 1) return null;
  return matches[0].meta;
};

export const isCodexRunning = async (
  panePid: number,
  preloadedChildPids?: number[],
): Promise<boolean> => !!(await findCodexProcess(panePid, preloadedChildPids));

export const detectActiveCodexSession = async (
  panePid: number,
  preloadedChildPids?: number[],
): Promise<ISessionInfo> => {
  try {
    await fs.access(getCodexHomeDir());
  } catch {
    const installed = await isCodexInstalled();
    return {
      status: installed ? 'not-initialized' : 'not-installed',
      sessionId: null,
      jsonlPath: null,
      pid: null,
      startedAt: null,
      cwd: null,
    };
  }

  const codexProcess = await findCodexProcess(panePid, preloadedChildPids);
  if (!codexProcess) {
    return { status: 'not-running', sessionId: null, jsonlPath: null, pid: null, startedAt: null, cwd: null };
  }

  const session = await findCodexSessionJsonl(
    codexProcess.sessionId,
    codexProcess.cwd,
    {
      processStartedAt: codexProcess.startedAt,
    },
  );
  return {
    status: 'running',
    sessionId: session?.sessionId ?? null,
    jsonlPath: session?.jsonlPath ?? null,
    pid: codexProcess.pid,
    startedAt: session?.startedAt ?? null,
    cwd: codexProcess.cwd,
  };
};

const sameSessionInfo = (a: ISessionInfo | null, b: ISessionInfo): boolean =>
  !!a
  && a.status === b.status
  && a.sessionId === b.sessionId
  && a.jsonlPath === b.jsonlPath
  && a.pid === b.pid
  && a.cwd === b.cwd;

export const watchCodexSessions = (
  panePid: number,
  onChange: (info: ISessionInfo) => void,
  options?: { skipInitial?: boolean },
): ISessionWatcher => {
  let sessionWatcher: FSWatcher | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let installCheckTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let lastInfo: ISessionInfo | null = null;

  const emitIfChanged = async () => {
    if (stopped) return;
    const info = await detectActiveCodexSession(panePid);
    if (stopped || sameSessionInfo(lastInfo, info)) return;
    lastInfo = info;
    onChange(info);
  };

  const tryWatch = () => {
    if (stopped) return;
    try {
      sessionWatcher = watch(getCodexSessionsRoot(), { recursive: true }, () => {
        emitIfChanged().catch(() => {});
      });
      sessionWatcher.on('error', () => {});
      if (installCheckTimer) {
        clearInterval(installCheckTimer);
        installCheckTimer = null;
      }
    } catch {
      if (!installCheckTimer) {
        installCheckTimer = setInterval(async () => {
          try {
            await fs.access(getCodexSessionsRoot());
            tryWatch();
            await emitIfChanged();
          } catch {
            // not initialized yet
          }
        }, INSTALL_CHECK_INTERVAL);
      }
    }
  };

  tryWatch();
  pollTimer = setInterval(async () => {
    if (lastInfo?.pid && !(await isProcessRunning(lastInfo.pid))) {
      lastInfo = null;
    }
    emitIfChanged().catch(() => {});
  }, WATCH_POLL_INTERVAL);

  if (!options?.skipInitial) {
    emitIfChanged().catch(() => {});
  }

  return {
    stop: () => {
      stopped = true;
      if (sessionWatcher) sessionWatcher.close();
      if (pollTimer) clearInterval(pollTimer);
      if (installCheckTimer) clearInterval(installCheckTimer);
    },
  };
};

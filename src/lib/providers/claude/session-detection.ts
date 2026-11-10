import fs from 'fs/promises';
import { watch, type FSWatcher } from 'fs';
import os from 'os';
import path from 'path';
import type { ISessionInfo } from '@/types/timeline';
import type { ISessionWatcher } from '@/lib/session-detection';
import {
  getChildPids,
  getDescendantPids,
  getProcessCommandLine,
  getProcessCwd,
  getProcessStartTime,
  isProcessRunning,
} from '@/lib/session-detection';
import { getClaudeProjectsDir } from '@/lib/path-validation';
import { isValidClaudeSessionId } from '@/lib/claude-command';
import type { IAgentSessionWatchOptions } from '@/lib/providers/types';

const MAX_PROJECT_NAME_LENGTH = 200;
const CLAUDE_COMMAND_RE = /(^|\/)claude(\s|$)/;
const SESSION_ARG_RE = /--(?:session-id|resume)[ =]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const WATCH_DEBOUNCE_MS = 200;
const LIVENESS_POLL_MS = 10_000;
const DIRECTORY_RETRY_MS = 60_000;

interface IClaudeProcess {
  pid: number;
  cwd: string | null;
  startedAt: number | null;
  argSessionId: string | null;
}

const simpleHash = (value: string): string => {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
};

export const toClaudeProjectName = (dirPath: string): string => {
  const name = dirPath.replace(/[^a-zA-Z0-9]/g, '-');
  if (name.length <= MAX_PROJECT_NAME_LENGTH) return name;
  return `${name.slice(0, MAX_PROJECT_NAME_LENGTH)}-${simpleHash(dirPath)}`;
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

export const resolveClaudeJsonlPath = async (
  sessionId: string,
  cwd: string,
  homeDir?: string,
): Promise<string | null> => {
  const projectsDir = getClaudeProjectsDir(homeDir ?? os.homedir());
  const projectName = toClaudeProjectName(cwd);
  const direct = path.join(projectsDir, projectName, `${sessionId}.jsonl`);
  if (await fileExists(direct)) return direct;

  if (cwd.replace(/[^a-zA-Z0-9]/g, '-').length <= MAX_PROJECT_NAME_LENGTH) return null;
  const prefix = projectName.slice(0, MAX_PROJECT_NAME_LENGTH);
  let entries: string[];
  try {
    entries = await fs.readdir(projectsDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    const candidate = path.join(projectsDir, entry, `${sessionId}.jsonl`);
    if (await fileExists(candidate)) return candidate;
  }
  return null;
};

const collectProcessTree = async (panePid: number, preloadedChildPids?: number[]): Promise<number[]> => {
  const direct = preloadedChildPids ?? await getChildPids(panePid);
  const descendants = (await Promise.all(direct.map(getDescendantPids))).flat();
  return [...new Set([...direct, ...descendants])];
};

const findClaudeProcess = async (
  panePid: number,
  preloadedChildPids?: number[],
): Promise<{ process: IClaudeProcess | null; tree: number[] }> => {
  const tree = await collectProcessTree(panePid, preloadedChildPids);
  for (const pid of tree) {
    try {
      const commandLine = await getProcessCommandLine(pid);
      if (!commandLine || !CLAUDE_COMMAND_RE.test(commandLine.raw)) continue;
      return {
        tree,
        process: {
          pid,
          cwd: await getProcessCwd(pid),
          startedAt: await getProcessStartTime(pid),
          argSessionId: commandLine.raw.match(SESSION_ARG_RE)?.[1] ?? null,
        },
      };
    } catch {
      continue;
    }
  }
  return { process: null, tree };
};

export const isClaudeRunning = async (panePid: number, childPids?: number[]): Promise<boolean> =>
  !!(await findClaudeProcess(panePid, childPids)).process;

const readPidfileSessionId = async (pid: number): Promise<string | null> => {
  try {
    const file = path.join(os.homedir(), '.claude', 'sessions', `${pid}.json`);
    const data: unknown = JSON.parse(await fs.readFile(file, 'utf-8'));
    if (!data || typeof data !== 'object') return null;
    const { sessionId } = data as { sessionId?: unknown };
    return isValidClaudeSessionId(sessionId) ? sessionId : null;
  } catch {
    return null;
  }
};

const findPidfileSessionId = async (claudePid: number, tree: number[]): Promise<string | null> => {
  for (const pid of [claudePid, ...tree.filter((candidate) => candidate !== claudePid)]) {
    const sessionId = await readPidfileSessionId(pid);
    if (sessionId) return sessionId;
  }
  return null;
};

const findNewestJsonlSince = async (
  cwd: string,
  startedAt: number | null,
): Promise<{ sessionId: string; jsonlPath: string } | null> => {
  const dir = path.join(getClaudeProjectsDir(), toClaudeProjectName(cwd));
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return null;
  }
  let best: { sessionId: string; jsonlPath: string; mtimeMs: number } | null = null;
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const sessionId = name.slice(0, -'.jsonl'.length);
    if (!isValidClaudeSessionId(sessionId)) continue;
    try {
      const jsonlPath = path.join(dir, name);
      const { mtimeMs } = await fs.stat(jsonlPath);
      if (startedAt !== null && mtimeMs < startedAt) continue;
      if (!best || mtimeMs > best.mtimeMs) best = { sessionId, jsonlPath, mtimeMs };
    } catch {
      continue;
    }
  }
  return best;
};

export const detectActiveClaudeSession = async (
  panePid: number,
  childPids?: number[],
): Promise<ISessionInfo> => {
  const { process: claudeProcess, tree } = await findClaudeProcess(panePid, childPids);
  if (!claudeProcess) {
    return { status: 'not-running', sessionId: null, jsonlPath: null, pid: null, startedAt: null, cwd: null };
  }

  const { cwd, pid, startedAt } = claudeProcess;
  let sessionId = await findPidfileSessionId(pid, tree) ?? claudeProcess.argSessionId;
  let jsonlPath: string | null = null;
  if (sessionId && cwd) {
    jsonlPath = await resolveClaudeJsonlPath(sessionId, cwd);
  } else if (!sessionId && cwd) {
    const newest = await findNewestJsonlSince(cwd, startedAt);
    sessionId = newest?.sessionId ?? null;
    jsonlPath = newest?.jsonlPath ?? null;
  }

  return { status: 'running', sessionId, jsonlPath, pid, startedAt, cwd };
};

const sameSessionInfo = (a: ISessionInfo | null, b: ISessionInfo): boolean =>
  !!a
  && a.status === b.status
  && a.sessionId === b.sessionId
  && a.jsonlPath === b.jsonlPath
  && a.pid === b.pid
  && a.cwd === b.cwd;

export const watchClaudeSessions = (
  panePid: number,
  onChange: (info: ISessionInfo) => void,
  options?: IAgentSessionWatchOptions,
): ISessionWatcher => {
  const sessionsDir = path.join(os.homedir(), '.claude', 'sessions');
  let sessionWatcher: FSWatcher | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let lastInfo: ISessionInfo | null = null;
  let stopped = false;

  const emitIfChanged = async (): Promise<void> => {
    const info = await detectActiveClaudeSession(panePid);
    if (stopped || sameSessionInfo(lastInfo, info)) return;
    lastInfo = info;
    onChange(info);
  };

  const tryWatch = (): void => {
    if (stopped) return;
    try {
      sessionWatcher = watch(sessionsDir, () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          emitIfChanged().catch(() => {});
        }, WATCH_DEBOUNCE_MS);
      });
      sessionWatcher.on('error', () => {});
    } catch {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        tryWatch();
      }, DIRECTORY_RETRY_MS);
    }
  };

  tryWatch();
  const pollTimer = setInterval(async () => {
    if (lastInfo?.pid && !(await isProcessRunning(lastInfo.pid))) lastInfo = null;
    emitIfChanged().catch(() => {});
  }, LIVENESS_POLL_MS);

  if (!options?.skipInitial) {
    emitIfChanged().catch(() => {});
  }

  return {
    stop: () => {
      stopped = true;
      sessionWatcher?.close();
      clearInterval(pollTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
      if (retryTimer) clearTimeout(retryTimer);
    },
  };
};

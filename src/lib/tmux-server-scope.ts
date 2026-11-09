import { execFile as execFileCb } from 'child_process';
import fs from 'fs/promises';
import { promisify } from 'util';
import { TMUX_SOCKETS } from '@/lib/tmux-sockets';

const execFile = promisify(execFileCb);
const CMD_TIMEOUT_MS = 5_000;
const CGROUP_POLL_INTERVAL_MS = 100;
const CGROUP_POLL_MAX_ATTEMPTS = 50;
const SCOPE_START_RETRY_INTERVAL_MS = 200;
const SCOPE_START_MAX_ATTEMPTS = 10;

export { TMUX_SOCKETS };

export type TAdoptResult = {
  status: 'adopted' | 'already-isolated' | 'skipped' | 'failed';
  pid?: number;
  reason?: string;
};

export interface ITmuxScopeDeps {
  getServerPid(socket: string): Promise<number | null>;
  readCgroup(pid: number): Promise<string | null>;
  startTransientScope(unit: string, pid: number): Promise<void>;
}

export const shouldIsolateTmuxServer = (
  env: Partial<NodeJS.ProcessEnv> = process.env,
): boolean =>
  Boolean(env.INVOCATION_ID && env.NODE_ENV === 'production' && env.AGENTMUX_TMUX_SCOPE !== 'off');

export const tmuxScopeUnitName = (socketName: string): string =>
  `agentmux-tmux-${socketName}.scope`;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const extractStdout = (result: unknown): string => {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object' && 'stdout' in result) {
    const stdout = (result as { stdout?: unknown }).stdout;
    return typeof stdout === 'string' ? stdout : String(stdout ?? '');
  }
  return '';
};

export const defaultTmuxScopeDeps: ITmuxScopeDeps = {
  async getServerPid(socket: string): Promise<number | null> {
    try {
      const result = await execFile(
        'tmux',
        ['-L', socket, 'display-message', '-p', '#{pid}'],
        { timeout: CMD_TIMEOUT_MS },
      );
      const parsed = Number.parseInt(extractStdout(result).trim(), 10);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    } catch {
      return null;
    }
  },

  async readCgroup(pid: number): Promise<string | null> {
    try {
      const raw = await fs.readFile(`/proc/${pid}/cgroup`, 'utf-8');
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('0::')) {
          const cgroupPath = trimmed.slice(3).trim();
          return cgroupPath || null;
        }
      }
      return null;
    } catch {
      return null;
    }
  },

  async startTransientScope(unit: string, pid: number): Promise<void> {
    await execFile(
      'busctl',
      [
        '--user',
        'call',
        'org.freedesktop.systemd1',
        '/org/freedesktop/systemd1',
        'org.freedesktop.systemd1.Manager',
        'StartTransientUnit',
        'ssa(sv)a(sa(sv))',
        unit,
        'fail',
        '2',
        'PIDs',
        'au',
        '1',
        String(pid),
        'CollectMode',
        's',
        'inactive-or-failed',
        '0',
      ],
      { timeout: CMD_TIMEOUT_MS },
    );
  },
};

const isIsolatedInUnit = (cgroup: string | null, unit: string): boolean =>
  Boolean(cgroup && cgroup.endsWith(`/${unit}`));

const toReason = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export const adoptTmuxServerIntoScope = async (
  socketName: string,
  deps?: Partial<ITmuxScopeDeps>,
): Promise<TAdoptResult> => {
  const resolvedDeps: ITmuxScopeDeps = {
    ...defaultTmuxScopeDeps,
    ...deps,
  };
  const unit = tmuxScopeUnitName(socketName);

  let pid: number | null = null;
  try {
    pid = await resolvedDeps.getServerPid(socketName);
    if (!pid) {
      return { status: 'skipped', reason: 'no-server' };
    }

    const initialCgroup = await resolvedDeps.readCgroup(pid);
    if (!initialCgroup) {
      return { status: 'failed', pid, reason: 'cgroup-unreadable' };
    }
    if (isIsolatedInUnit(initialCgroup, unit)) {
      return { status: 'already-isolated', pid };
    }

    let scopeError: unknown = null;
    let scopeStarted = false;
    for (let attempt = 0; attempt < SCOPE_START_MAX_ATTEMPTS; attempt += 1) {
      try {
        await resolvedDeps.startTransientScope(unit, pid);
        scopeStarted = true;
        break;
      } catch (err) {
        scopeError = err;
        const cgroupAfterReject = await resolvedDeps.readCgroup(pid).catch(() => null);
        if (isIsolatedInUnit(cgroupAfterReject, unit)) {
          return { status: 'already-isolated', pid };
        }
        if (attempt < SCOPE_START_MAX_ATTEMPTS - 1) {
          await sleep(SCOPE_START_RETRY_INTERVAL_MS);
        }
      }
    }
    if (!scopeStarted) {
      return {
        status: 'failed',
        pid,
        reason: toReason(scopeError),
      };
    }

    let latestCgroup: string | null = initialCgroup;
    for (let attempt = 0; attempt < CGROUP_POLL_MAX_ATTEMPTS; attempt += 1) {
      latestCgroup = await resolvedDeps.readCgroup(pid).catch(() => null);
      if (isIsolatedInUnit(latestCgroup, unit)) {
        return { status: 'adopted', pid };
      }
      await sleep(CGROUP_POLL_INTERVAL_MS);
    }

    latestCgroup = await resolvedDeps.readCgroup(pid).catch(() => null);
    if (isIsolatedInUnit(latestCgroup, unit)) {
      return { status: 'adopted', pid };
    }

    return {
      status: 'failed',
      pid,
      reason: `Timed out waiting for pid ${pid} to enter ${unit} (last cgroup: ${latestCgroup ?? 'unknown'})`,
    };
  } catch (err) {
    return {
      status: 'failed',
      ...(pid ? { pid } : {}),
      reason: toReason(err),
    };
  }
};

export const ensureTmuxServerIsolation = async (
  deps?: Partial<ITmuxScopeDeps>,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): Promise<TAdoptResult[]> => {
  if (!shouldIsolateTmuxServer(env)) {
    return [];
  }
  return Promise.all(TMUX_SOCKETS.map((socket) => adoptTmuxServerIntoScope(socket, deps)));
};

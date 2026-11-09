import { execFile as execFileCb } from 'child_process';
import * as pty from 'node-pty';
import { promisify } from 'util';
import { parseRuntimeSessionName } from '@/lib/runtime/session-name';
import type { ITerminalWorkerRuntime } from '@/lib/runtime/terminal/terminal-worker-service';
import { resolveRuntimeTmuxConfigPath } from '@/lib/runtime/worker-paths';
import { buildShellEnv, buildShellLaunchCommand } from '@/lib/shell-env';
import { PRISTINE_ENV } from '@/lib/pristine-env';
import { adoptTmuxServerIntoScope, shouldIsolateTmuxServer } from '@/lib/tmux-server-scope';
import { RUNTIME_TMUX_SOCKET } from '@/lib/tmux-sockets';

const execFile = promisify(execFileCb);
const CMD_TIMEOUT = 5000;

interface IAttachedPty {
  pty: pty.IPty;
  disposables: pty.IDisposable[];
}

const assertRuntimeSessionName = (sessionName: string): void => {
  parseRuntimeSessionName(sessionName);
};

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const createRuntimeError = (
  code: string,
  message: string,
  err: unknown,
): Error & { code: string; retryable: false } => (
  Object.assign(new Error(`${message}: ${errorMessage(err)}`), {
    code,
    retryable: false as const,
  })
);

const isMissingTmuxSessionError = (err: unknown): boolean =>
  /can't find session|missing session|no server running|failed to connect to server/i.test(errorMessage(err));

const sourceRuntimeTmuxConfig = async (): Promise<void> => {
  const tmuxConfigPath = resolveRuntimeTmuxConfigPath();
  try {
    await execFile('tmux', ['-L', RUNTIME_TMUX_SOCKET, 'source-file', tmuxConfigPath], {
      timeout: CMD_TIMEOUT,
    });
  } catch (err) {
    throw createRuntimeError(
      'runtime-v2-tmux-config-source-failed',
      `Runtime v2 tmux config could not be sourced: ${tmuxConfigPath}`,
      err,
    );
  }
};

const killRuntimeSession = async (sessionName: string): Promise<void> => {
  assertRuntimeSessionName(sessionName);
  await execFile('tmux', ['-L', RUNTIME_TMUX_SOCKET, 'kill-session', '-t', sessionName], {
    timeout: CMD_TIMEOUT,
  }).catch(() => undefined);
};

const createRuntimeSession = async (input: {
  sessionName: string;
  cols: number;
  rows: number;
  cwd?: string;
}): Promise<void> => {
  assertRuntimeSessionName(input.sessionName);
  await execFile(
    'tmux',
    [
      '-u',
      '-L',
      RUNTIME_TMUX_SOCKET,
      '-f',
      resolveRuntimeTmuxConfigPath(),
      'new-session',
      '-d',
      '-s',
      input.sessionName,
      '-x',
      String(input.cols),
      '-y',
      String(input.rows),
      buildShellLaunchCommand(),
    ],
    {
      timeout: CMD_TIMEOUT,
      cwd: input.cwd || PRISTINE_ENV.HOME || '/',
    },
  );
  try {
    await sourceRuntimeTmuxConfig();
  } catch (err) {
    await killRuntimeSession(input.sessionName);
    throw err;
  }
  if (shouldIsolateTmuxServer(process.env)) {
    const scopeResult = await adoptTmuxServerIntoScope(RUNTIME_TMUX_SOCKET);
    if (scopeResult.status === 'failed') {
      console.warn(
        `[terminal-worker-runtime] tmux scope adoption failed for ${RUNTIME_TMUX_SOCKET}: ${scopeResult.reason ?? 'unknown'}`,
      );
    }
  }
};

const assertRuntimeSessionExists = async (sessionName: string): Promise<void> => {
  assertRuntimeSessionName(sessionName);
  try {
    await execFile('tmux', ['-L', RUNTIME_TMUX_SOCKET, 'has-session', '-t', sessionName], {
      timeout: CMD_TIMEOUT,
    });
  } catch (err) {
    throw createRuntimeError(
      'runtime-v2-terminal-session-not-found',
      `Runtime v2 tmux session not found: ${sessionName}`,
      err,
    );
  }
};

const hasRuntimeSession = async (sessionName: string): Promise<boolean> => {
  assertRuntimeSessionName(sessionName);
  try {
    await execFile('tmux', ['-L', RUNTIME_TMUX_SOCKET, 'has-session', '-t', sessionName], {
      timeout: CMD_TIMEOUT,
    });
    return true;
  } catch (err) {
    if (isMissingTmuxSessionError(err)) return false;
    throw createRuntimeError(
      'runtime-v2-terminal-presence-check-failed',
      `Runtime v2 tmux session presence check failed: ${sessionName}`,
      err,
    );
  }
};

const parseRuntimeSessionInfo = (sessionName: string, raw: string) => {
  const [cwdRaw, commandRaw, pidRaw, createdRaw] = raw.trimEnd().split('\t');
  const pid = Number.parseInt(pidRaw ?? '', 10);
  const created = Number.parseInt(createdRaw ?? '', 10);
  return {
    sessionName,
    exists: true,
    cwd: cwdRaw || null,
    command: commandRaw || null,
    pid: Number.isFinite(pid) ? pid : null,
    startedAt: Number.isFinite(created) ? created * 1000 : null,
    metadataSource: 'terminal-runtime' as const,
  };
};

const missingRuntimeSessionInfo = (sessionName: string) => ({
  sessionName,
  exists: false,
  cwd: null,
  command: null,
  pid: null,
  startedAt: null,
  metadataSource: 'unavailable' as const,
});

const getRuntimeSessionInfo = async (sessionName: string) => {
  assertRuntimeSessionName(sessionName);
  if (!await hasRuntimeSession(sessionName)) return missingRuntimeSessionInfo(sessionName);

  try {
    const { stdout } = await execFile(
      'tmux',
      [
        '-L',
        RUNTIME_TMUX_SOCKET,
        'display-message',
        '-p',
        '-t',
        sessionName,
        '#{pane_current_path}\t#{pane_current_command}\t#{pane_pid}\t#{session_created}',
      ],
      { timeout: CMD_TIMEOUT },
    );
    return parseRuntimeSessionInfo(sessionName, stdout);
  } catch (err) {
    if (isMissingTmuxSessionError(err)) return missingRuntimeSessionInfo(sessionName);
    throw createRuntimeError(
      'runtime-v2-terminal-metadata-failed',
      `Runtime v2 tmux session metadata failed: ${sessionName}`,
      err,
    );
  }
};

export const createTerminalWorkerRuntime = (): ITerminalWorkerRuntime => {
  const attached = new Map<string, IAttachedPty>();

  const cleanupAttachedPty = (sessionName: string, ptyProcess: pty.IPty): void => {
    const current = attached.get(sessionName);
    if (!current || current.pty !== ptyProcess) return;
    current.disposables.forEach((disposable) => disposable.dispose());
    attached.delete(sessionName);
  };

  const detachSession = async (sessionName: string) => {
    const current = attached.get(sessionName);
    if (!current) return { sessionName, detached: false };
    current.disposables.forEach((disposable) => disposable.dispose());
    current.pty.kill();
    attached.delete(sessionName);
    return { sessionName, detached: true };
  };

  return {
    async health() {
      return { ok: true, attached: attached.size };
    },

    async createSession(input) {
      await createRuntimeSession(input);
      return { sessionName: input.sessionName };
    },

    async attach(sessionName, cols, rows, onData) {
      assertRuntimeSessionName(sessionName);
      if (attached.has(sessionName)) return { sessionName, attached: true };
      await assertRuntimeSessionExists(sessionName);
      const ptyProcess = pty.spawn('tmux', ['-u', '-L', RUNTIME_TMUX_SOCKET, 'attach-session', '-t', sessionName], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: PRISTINE_ENV.HOME || '/',
        env: buildShellEnv(),
      });
      const disposables = [
        ptyProcess.onData(onData),
        ptyProcess.onExit(() => cleanupAttachedPty(sessionName, ptyProcess)),
      ];
      attached.set(sessionName, { pty: ptyProcess, disposables });
      return { sessionName, attached: true };
    },

    async detach(sessionName) {
      return detachSession(sessionName);
    },

    async killSession(sessionName) {
      await detachSession(sessionName);
      await killRuntimeSession(sessionName);
      return { sessionName, killed: true };
    },

    async hasSession(sessionName) {
      return { sessionName, exists: await hasRuntimeSession(sessionName) };
    },

    async getSessionInfo(sessionName) {
      return getRuntimeSessionInfo(sessionName);
    },

    async writeStdin(sessionName, data) {
      const current = attached.get(sessionName);
      if (!current) throw new Error(`session is not attached: ${sessionName}`);
      current.pty.write(data);
      return { written: data.length };
    },

    async resize(sessionName, cols, rows) {
      const current = attached.get(sessionName);
      if (!current) throw new Error(`session is not attached: ${sessionName}`);
      current.pty.resize(cols, rows);
      return { sessionName, cols, rows };
    },
  };
};

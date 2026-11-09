import path from 'path';
import * as pty from 'node-pty';
import { parseRuntimeSessionName } from '@/lib/runtime/session-name';
import type {
  ITerminalRuntimeAdapter,
  ITerminalRuntimeCreateInput,
} from '@/lib/runtime/terminal/terminal-runtime-contract';

interface IWindowsTerminalSession {
  pty: pty.IPty;
  cwd: string | null;
  createdAt: number;
  dataDisposable: pty.IDisposable | null;
  exitDisposable: pty.IDisposable;
}

export interface IWindowsTerminalRuntimeOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  shell?: string;
  shellArgs?: string[] | string;
  spawnPty?: typeof pty.spawn;
  now?: () => number;
}

const createWindowsTerminalRuntimeError = (
  code: string,
  message: string,
): Error & { code: string; retryable: false } => Object.assign(
  new Error(message),
  { code, retryable: false as const },
);

const createPlatformMismatchError = (): Error & { code: string; retryable: false } =>
  createWindowsTerminalRuntimeError(
    'runtime-v2-windows-terminal-platform-mismatch',
    'Windows terminal runtime can only run on win32.',
  );

const createSessionNotFoundError = (sessionName: string): Error & { code: string; retryable: false } =>
  createWindowsTerminalRuntimeError(
    'runtime-v2-terminal-session-not-found',
    `Runtime v2 Windows terminal session not found: ${sessionName}`,
  );

const resolveShell = (env: NodeJS.ProcessEnv, explicitShell?: string): string =>
  explicitShell
  || env.AGENTMUX_WINDOWS_SHELL
  || env.ComSpec
  || env.COMSPEC
  || 'powershell.exe';

const resolveShellArgs = (shell: string, explicitArgs?: string[] | string): string[] | string => {
  if (explicitArgs !== undefined) return explicitArgs;
  const basename = path.basename(shell).toLowerCase();
  if (basename === 'powershell.exe' || basename === 'pwsh.exe' || basename === 'pwsh') {
    return ['-NoLogo'];
  }
  return [];
};

const resolveCwd = (input: ITerminalRuntimeCreateInput, env: NodeJS.ProcessEnv): string =>
  input.cwd || env.USERPROFILE || env.HOME || process.cwd();

export const createWindowsTerminalRuntime = ({
  platform = process.platform,
  env = process.env,
  shell: explicitShell,
  shellArgs: explicitShellArgs,
  spawnPty = pty.spawn,
  now = Date.now,
}: IWindowsTerminalRuntimeOptions = {}): ITerminalRuntimeAdapter => {
  const sessions = new Map<string, IWindowsTerminalSession>();

  const assertWindowsPlatform = (): void => {
    if (platform !== 'win32') throw createPlatformMismatchError();
  };

  const getSession = (sessionName: string): IWindowsTerminalSession => {
    parseRuntimeSessionName(sessionName);
    const session = sessions.get(sessionName);
    if (!session) throw createSessionNotFoundError(sessionName);
    return session;
  };

  const detachSession = (sessionName: string): boolean => {
    const session = sessions.get(sessionName);
    if (!session?.dataDisposable) return false;
    session.dataDisposable.dispose();
    session.dataDisposable = null;
    return true;
  };

  const removeSession = (sessionName: string): void => {
    const session = sessions.get(sessionName);
    if (!session) return;
    session.dataDisposable?.dispose();
    session.exitDisposable.dispose();
    sessions.delete(sessionName);
  };

  return {
    async health() {
      assertWindowsPlatform();
      let attached = 0;
      for (const session of sessions.values()) {
        if (session.dataDisposable) attached++;
      }
      return {
        ok: true,
        adapter: 'windows',
        sessions: sessions.size,
        attached,
      };
    },

    async createSession(input) {
      assertWindowsPlatform();
      parseRuntimeSessionName(input.sessionName);
      if (sessions.has(input.sessionName)) return { sessionName: input.sessionName };

      const shell = resolveShell(env, explicitShell);
      const shellArgs = resolveShellArgs(shell, explicitShellArgs);
      const cwd = resolveCwd(input, env);
      const ptyProcess = spawnPty(shell, shellArgs, {
        name: 'xterm-256color',
        cols: input.cols,
        rows: input.rows,
        cwd,
        env,
        useConpty: true,
      });
      const exitDisposable = ptyProcess.onExit(() => {
        removeSession(input.sessionName);
      });
      sessions.set(input.sessionName, {
        pty: ptyProcess,
        cwd,
        createdAt: now(),
        dataDisposable: null,
        exitDisposable,
      });
      return { sessionName: input.sessionName };
    },

    async attach(sessionName, cols, rows, onData) {
      assertWindowsPlatform();
      const session = getSession(sessionName);
      if (session.dataDisposable) return { sessionName, attached: true };
      session.pty.resize(cols, rows);
      session.dataDisposable = session.pty.onData(onData);
      return { sessionName, attached: true };
    },

    async detach(sessionName) {
      assertWindowsPlatform();
      parseRuntimeSessionName(sessionName);
      return { sessionName, detached: detachSession(sessionName) };
    },

    async killSession(sessionName) {
      assertWindowsPlatform();
      parseRuntimeSessionName(sessionName);
      const session = sessions.get(sessionName);
      if (!session) return { sessionName, killed: false };
      detachSession(sessionName);
      session.pty.kill();
      removeSession(sessionName);
      return { sessionName, killed: true };
    },

    async hasSession(sessionName) {
      assertWindowsPlatform();
      parseRuntimeSessionName(sessionName);
      return { sessionName, exists: sessions.has(sessionName) };
    },

    async getSessionInfo(sessionName) {
      assertWindowsPlatform();
      parseRuntimeSessionName(sessionName);
      const session = sessions.get(sessionName);
      if (!session) {
        return {
          sessionName,
          exists: false,
          cwd: null,
          command: null,
          pid: null,
          startedAt: null,
          metadataSource: 'unavailable',
        };
      }
      return {
        sessionName,
        exists: true,
        cwd: session.cwd,
        command: session.pty.process || null,
        pid: session.pty.pid,
        startedAt: session.createdAt,
        metadataSource: 'terminal-runtime',
      };
    },

    async writeStdin(sessionName, data) {
      assertWindowsPlatform();
      const session = getSession(sessionName);
      session.pty.write(data);
      return { written: data.length };
    },

    async resize(sessionName, cols, rows) {
      assertWindowsPlatform();
      const session = getSession(sessionName);
      session.pty.resize(cols, rows);
      return { sessionName, cols, rows };
    },
  };
};

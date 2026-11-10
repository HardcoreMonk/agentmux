import { execFile as execFileCb } from 'child_process';
import { access } from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import type {
  IPreflightResult,
  IRuntimePreflightResult,
  TTerminalRuntimePreflightStatus,
} from '@/types/preflight';
import { buildShellEnv, defaultShell as resolveDefaultShell } from '@/lib/shell-env';
import { PRISTINE_ENV } from '@/lib/pristine-env';

const execFile = promisify(execFileCb);
const CMD_TIMEOUT = 5000;

let shellPathCache: string | null = null;
let shellPathPromise: Promise<string> | null = null;

const defaultShell = () => os.userInfo().shell || resolveDefaultShell();

const resolveShellPathAsync = async (): Promise<string> => {
  if (process.platform === 'win32') {
    return process.env.PATH || process.env.Path || PRISTINE_ENV.PATH || '';
  }

  const shell = defaultShell();
  try {
    const { stdout } = await execFile(shell, ['-ilc', 'echo -n "$PATH"'], {
      timeout: CMD_TIMEOUT,
      env: {
        ...buildShellEnv(),
        SHELL: shell,
        DISABLE_AUTO_UPDATE: 'true',
        ZSH_TMUX_AUTOSTARTED: 'true',
      },
    });
    return stdout.toString().trim();
  } catch {
    return PRISTINE_ENV.PATH || '';
  }
};

export const initShellPath = async (): Promise<void> => {
  shellPathCache = await resolveShellPathAsync();
};

export const getShellPath = async (): Promise<string> => {
  if (shellPathCache) return shellPathCache;
  if (!shellPathPromise) {
    shellPathPromise = resolveShellPathAsync().then((result) => {
      shellPathCache = result;
      shellPathPromise = null;
      return result;
    });
  }
  return shellPathPromise;
};
const MIN_TMUX_VERSION = 2.9;
export const MIN_CODEX_VERSION = '0.144.1';
export const MIN_CLAUDE_VERSION = '2.0.0';

interface IToolStatus {
  installed: boolean;
  version: string | null;
}

type TToolStatusWithCompat = IToolStatus & {
  compatible: boolean;
  minimumVersion: string;
  binaryPath?: string | null;
};

const checkTool = async (
  cmd: string,
  args: string[],
  parseVersion: (stdout: string) => string | null,
): Promise<IToolStatus> => {
  try {
    const resolvedPath = await getShellPath();
    const { stdout } = await execTool(cmd, args, resolvedPath);
    return { installed: true, version: parseVersion(stdout) };
  } catch {
    return { installed: false, version: null };
  }
};

const psQuote = (value: string): string =>
  `'${value.replace(/'/g, "''")}'`;

const execTool = async (
  cmd: string,
  args: string[],
  resolvedPath: string,
): Promise<{ stdout: string }> => {
  const env = { ...process.env, PATH: resolvedPath, Path: resolvedPath };
  try {
    return await execFile(cmd, args, { timeout: CMD_TIMEOUT, env });
  } catch (err) {
    if (process.platform !== 'win32') throw err;

    const command = [
      "$ErrorActionPreference = 'Stop'",
      `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)`,
      `& ${psQuote(cmd)} ${args.map(psQuote).join(' ')}`,
    ].join('; ');
    return execFile('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      command,
    ], {
      timeout: CMD_TIMEOUT,
      env,
      windowsHide: true,
    });
  }
};

export const parseToolSemanticVersion = (stdout: string): string | null =>
  stdout.trim().match(/(\d+(?:\.\d+)+)/)?.[1] ?? null;

export const isSemanticVersionAtLeast = (version: string | null, minimum: string): boolean => {
  if (!version) return false;
  const left = version.split('.').map((part) => Number.parseInt(part, 10));
  const right = minimum.split('.').map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;
    if (leftPart !== rightPart) return leftPart > rightPart;
  }
  return true;
};

const withCodexCompatibility = <T extends IToolStatus>(status: T): T & {
  compatible: boolean;
  minimumVersion: string;
} => ({
  ...status,
  compatible: status.installed && isSemanticVersionAtLeast(status.version, MIN_CODEX_VERSION),
  minimumVersion: MIN_CODEX_VERSION,
});

const CLAUDE_KNOWN_DIRS = [path.join(os.homedir(), '.local', 'bin')];

const findClaudeBinary = async (): Promise<string | null> => {
  for (const dir of CLAUDE_KNOWN_DIRS) {
    try {
      await access(path.join(dir, 'claude'));
      return dir;
    } catch {
      // not found
    }
  }
  return null;
};

// When the binary exists outside PATH, binaryPath carries its directory so the
// install flow can offer the claude-path step instead of a reinstall.
export const checkClaudeTool = async (): Promise<TToolStatusWithCompat> => {
  const tool = await checkTool('claude', ['--version'], parseToolSemanticVersion);
  if (!tool.installed) {
    return {
      ...tool,
      compatible: false,
      minimumVersion: MIN_CLAUDE_VERSION,
      binaryPath: await findClaudeBinary(),
    };
  }
  return {
    ...tool,
    compatible: isSemanticVersionAtLeast(tool.version, MIN_CLAUDE_VERSION),
    minimumVersion: MIN_CLAUDE_VERSION,
  };
};

const CODEX_KNOWN_DIRS = [path.join(os.homedir(), '.local', 'bin')];

const findCodexBinary = async (): Promise<string | null> => {
  for (const dir of CODEX_KNOWN_DIRS) {
    try {
      await access(path.join(dir, 'codex'));
      return dir;
    } catch {
      // not found
    }
  }
  return null;
};

const isTmuxCompatible = (tool: IToolStatus): boolean =>
  tool.installed && tool.version !== null && parseFloat(tool.version) >= MIN_TMUX_VERSION;

export const createTerminalRuntimePreflightStatus = ({
  platform,
  tmux,
}: {
  platform: NodeJS.Platform;
  tmux: IToolStatus & { compatible: boolean };
}): TTerminalRuntimePreflightStatus => {
  if (platform === 'win32') {
    return {
      adapter: 'windows',
      installed: true,
      compatible: true,
      version: null,
    };
  }

  return {
    ...tmux,
    adapter: 'tmux',
  };
};

const checkClt = async (): Promise<{ installed: boolean }> => {
  try {
    await execFile('xcode-select', ['-p'], { timeout: CMD_TIMEOUT });
    return { installed: true };
  } catch {
    return { installed: false };
  }
};

export const getPreflightStatus = async (): Promise<IPreflightResult> => {
  shellPathCache = await resolveShellPathAsync();
  const platform = process.platform;
  const [tmux, git, codex, claude] = await Promise.all([
    platform === 'win32'
      ? Promise.resolve({ installed: false, version: null })
      : checkTool('tmux', ['-V'], parseToolSemanticVersion),
    checkTool('git', ['--version'], parseToolSemanticVersion),
    checkTool('codex', ['--version'], parseToolSemanticVersion),
    checkClaudeTool(),
  ]);

  const tmuxStatus = { ...tmux, compatible: isTmuxCompatible(tmux) };
  const terminalRuntime = createTerminalRuntimePreflightStatus({ platform, tmux: tmuxStatus });
  const compatibleCodex = withCodexCompatibility(codex);
  const coreReady = terminalRuntime.installed && terminalRuntime.compatible
    && git.installed
    && [compatibleCodex, claude].some((agent) => agent.installed && agent.compatible);

  const codexBinaryPath = codex.installed ? null : await findCodexBinary();
  let codexLoggedIn = false;
  if (codex.installed || codexBinaryPath) {
    try {
      await access(path.join(os.homedir(), '.codex'));
      codexLoggedIn = true;
    } catch {
      // not logged in yet
    }
  }

  const codexStatus = { ...compatibleCodex, binaryPath: codexBinaryPath, loggedIn: codexLoggedIn };

  // Existence checks only: the credential files are never opened or read.
  let claudeLoggedIn = false;
  if (claude.installed || claude.binaryPath) {
    const home = os.homedir();
    for (const file of [path.join(home, '.claude', '.credentials.json'), path.join(home, '.claude.json')]) {
      try {
        await access(file);
        claudeLoggedIn = true;
        break;
      } catch {
        // try the next location
      }
    }
  }
  const result: IPreflightResult = {
    platform,
    tmux: tmuxStatus,
    terminalRuntime,
    git,
    agent: codexStatus,
    agents: {
      codex: codexStatus,
      claude: { ...claude, loggedIn: claudeLoggedIn },
    },
  };

  if (!coreReady) {
    if (process.platform === 'darwin') {
      const [brew, clt] = await Promise.all([
        checkTool('brew', ['--version'], parseToolSemanticVersion),
        checkClt(),
      ]);
      result.brew = brew;
      result.clt = clt;
    }
  }

  return result;
};

const RUNTIME_CACHE_TTL = 30_000;
let runtimeCache: { result: IRuntimePreflightResult; checkedAt: number } | null = null;
let inflightRequest: Promise<IRuntimePreflightResult> | null = null;

const PREFLIGHT_CACHE_TTL = 1_000;
let preflightCache: { result: IPreflightResult; checkedAt: number } | null = null;
let preflightInflight: Promise<IPreflightResult> | null = null;

export const getCachedPreflightStatus = async (): Promise<IPreflightResult> => {
  if (preflightCache && Date.now() - preflightCache.checkedAt < PREFLIGHT_CACHE_TTL) {
    return preflightCache.result;
  }
  if (preflightInflight) return preflightInflight;

  preflightInflight = getPreflightStatus()
    .then((result) => {
      preflightCache = { result, checkedAt: Date.now() };
      preflightInflight = null;
      return result;
    })
    .catch((err) => {
      preflightInflight = null;
      throw err;
    });

  return preflightInflight;
};

export const getRuntimePreflightStatus = async (): Promise<IRuntimePreflightResult> => {
  shellPathCache = await resolveShellPathAsync();
  const platform = process.platform;
  const [tmux, git, codex, claude] = await Promise.all([
    platform === 'win32'
      ? Promise.resolve({ installed: false, version: null })
      : checkTool('tmux', ['-V'], parseToolSemanticVersion),
    checkTool('git', ['--version'], parseToolSemanticVersion),
    checkTool('codex', ['--version'], parseToolSemanticVersion),
    checkClaudeTool(),
  ]);
  const tmuxStatus = { ...tmux, compatible: isTmuxCompatible(tmux) };
  const codexStatus = withCodexCompatibility(codex);

  return {
    platform,
    tmux: tmuxStatus,
    terminalRuntime: createTerminalRuntimePreflightStatus({ platform, tmux: tmuxStatus }),
    git,
    agent: codexStatus,
    agents: { codex: codexStatus, claude },
  };
};

export const getCachedRuntimePreflight = async (): Promise<IRuntimePreflightResult> => {
  if (runtimeCache && Date.now() - runtimeCache.checkedAt < RUNTIME_CACHE_TTL) {
    return runtimeCache.result;
  }
  if (inflightRequest) return inflightRequest;

  inflightRequest = getRuntimePreflightStatus()
    .then((result) => {
      runtimeCache = { result, checkedAt: Date.now() };
      inflightRequest = null;
      return result;
    })
    .catch((err) => {
      inflightRequest = null;
      throw err;
    });

  return inflightRequest;
};

export const invalidateRuntimeCache = (): void => {
  runtimeCache = null;
  inflightRequest = null;
};

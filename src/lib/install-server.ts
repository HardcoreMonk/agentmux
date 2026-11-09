import type { IncomingMessage } from 'http';
import os from 'os';
import * as pty from 'node-pty';
import WebSocket from 'ws';
import { buildShellEnv } from '@/lib/shell-env';
import { PRISTINE_ENV } from '@/lib/pristine-env';
import {
  createInstallRequestAuthorizer,
  createInstallSetupLeaseChecker,
  type TAuthorizeInstallRequest,
  type TInstallAuthorizationMode,
  type TInstallSetupLeaseState,
} from '@/lib/install-request-auth';
import {
  MSG_RESIZE,
  MSG_STDIN,
  encodeStdout,
  textDecoder,
} from '@/lib/terminal-protocol';
import { createLogger } from '@/lib/logger';

const log = createLogger('install');

const RUNTIME_INSTALL_COMMANDS = new Set([
  'tmux-install',
  'tmux-upgrade',
  'git',
  'codex',
  'codex-path',
  'codex-login',
]);

const MAC_INSTALL_COMMANDS: Readonly<Record<string, string>> = Object.freeze({
  clt: 'xcode-select --install 2>&1; sleep 1; open -b com.apple.dt.CommandLineTools.installondemand 2>/dev/null; echo ""; echo "Waiting for installation..."; while ! xcode-select -p &>/dev/null; do sleep 3; done; echo ""; echo "Command Line Tools installed."',
  brew: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
  'tmux-install': 'brew install tmux',
  'tmux-upgrade': 'brew upgrade tmux',
  git: 'brew install git',
  codex: 'npm install -g @openai/codex',
  'codex-path': 'echo "Ensure the npm global bin directory is in PATH, then restart agentmux."; echo ""; codex --version',
  'codex-login': 'codex login',
});

const LINUX_INSTALL_COMMANDS: Readonly<Record<string, string>> = Object.freeze({
  'tmux-install': 'echo "Install tmux using your package manager:"; echo "  Ubuntu/Debian: sudo apt install tmux"; echo "  Fedora: sudo dnf install tmux"; echo "  Arch: sudo pacman -S tmux"; echo ""; echo "After installing, refresh this page."',
  'tmux-upgrade': 'echo "Upgrade tmux using your package manager:"; echo "  Ubuntu/Debian: sudo apt install --only-upgrade tmux"; echo "  Fedora: sudo dnf upgrade tmux"; echo "  Arch: sudo pacman -Syu tmux"; echo ""; echo "After upgrading, refresh this page."',
  git: 'echo "Install git using your package manager:"; echo "  Ubuntu/Debian: sudo apt install git"; echo "  Fedora: sudo dnf install git"; echo "  Arch: sudo pacman -S git"; echo ""; echo "After installing, refresh this page."',
  codex: 'npm install -g @openai/codex',
  'codex-path': 'echo "Ensure the npm global bin directory is in PATH, then restart agentmux."; echo ""; codex --version',
  'codex-login': 'codex login',
});

const MAX_TERMINAL_COLS = 500;
const MAX_TERMINAL_ROWS = 200;
const MAX_QUEUED_INSTALL_FRAMES = 256;
const MAX_QUEUED_INSTALL_BYTES = 1024 * 1024;
const DECIMAL_DIMENSION_RE = /^[1-9]\d*$/;

export const INSTALL_MAX_FRAME_BYTES = 64 * 1024;
export const INSTALL_MAX_BUFFERED_OUTPUT_BYTES = 1024 * 1024;

export interface IInstallConnectionContext {
  url: URL;
  admittedMode: TInstallAuthorizationMode;
}

export interface IInstallScheduledTask {
  cancel(): void;
}

export interface IInstallServerDependencies {
  authorizeRequest: TAuthorizeInstallRequest;
  checkSetupLease: () => Promise<TInstallSetupLeaseState>;
  spawnPty: (
    shell: string,
    args: string[] | string,
    options: pty.IPtyForkOptions | pty.IWindowsPtyForkOptions,
  ) => pty.IPty | Promise<pty.IPty>;
  scheduleTask: (
    name: 'command' | 'lease',
    callback: () => void | Promise<void>,
    delayMs: number,
  ) => IInstallScheduledTask;
  platform: NodeJS.Platform;
}

export interface IInstallServer {
  handleConnection(
    ws: WebSocket,
    request: IncomingMessage,
    context: IInstallConnectionContext | null | undefined,
  ): Promise<void>;
  shutdown(): void;
}

interface IActiveInstallConnection {
  owner: symbol;
  ws: WebSocket;
  pty: pty.IPty;
  disposables: pty.IDisposable[];
  commandTask: IInstallScheduledTask | null;
  leaseTask: IInstallScheduledTask | null;
  cleaned: boolean;
  mode: TInstallAuthorizationMode;
}

type TInstallSlot =
  | { state: 'idle' }
  | {
      state: 'starting';
      owner: symbol;
      ws: WebSocket;
      closed: boolean;
      pty: pty.IPty | null;
      exitDisposable: pty.IDisposable | null;
    }
  | { state: 'active'; owner: symbol; connection: IActiveInstallConnection };

const defaultScheduleTask: IInstallServerDependencies['scheduleTask'] = (
  _name,
  callback,
  delayMs,
) => {
  let canceled = false;
  const timer = setTimeout(() => {
    if (canceled) return;
    Promise.resolve().then(callback).catch(() => undefined);
  }, delayMs);
  return {
    cancel: () => {
      if (canceled) return;
      canceled = true;
      clearTimeout(timer);
    },
  };
};

const getInstallCommands = (
  platform: NodeJS.Platform,
): Readonly<Record<string, string>> | null => {
  if (platform === 'darwin') return MAC_INSTALL_COMMANDS;
  if (platform === 'linux') return LINUX_INSTALL_COMMANDS;
  return null;
};

const parseDimension = (raw: string | null, fallback: number, max: number): number => {
  if (raw === null || !DECIMAL_DIMENSION_RE.test(raw)) return fallback;
  return Math.min(Number.parseInt(raw, 10), max);
};

const rawByteLength = (raw: WebSocket.RawData): number => {
  if (raw instanceof ArrayBuffer) return raw.byteLength;
  if (Buffer.isBuffer(raw)) return raw.byteLength;
  return raw.reduce((total, chunk) => total + chunk.byteLength, 0);
};

const copyRawData = (raw: WebSocket.RawData): Uint8Array => {
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw.slice(0));
  if (Buffer.isBuffer(raw)) return Uint8Array.from(raw);
  return Uint8Array.from(Buffer.concat(raw));
};

const destroyPty = (ptyProcess: pty.IPty): void => {
  try {
    if ('destroy' in ptyProcess && typeof ptyProcess.destroy === 'function') {
      ptyProcess.destroy();
    } else {
      ptyProcess.kill();
    }
  } catch {
    // The PTY may already have exited.
  }
};

const closeSocket = (ws: WebSocket, code: number, reason: string): void => {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.close(code, reason);
  } catch {
    // Socket errors are handled by the permanent error listener.
  }
};

const leaseClose = (state: Exclude<TInstallSetupLeaseState, 'valid'>) => (
  state === 'completed'
    ? { code: 1000, reason: 'Setup completed' }
    : { code: 1011, reason: 'Setup state unavailable' }
);

export const createInstallServer = (
  dependencies: Partial<IInstallServerDependencies> = {},
): IInstallServer => {
  const defaultAuthorizeRequest = createInstallRequestAuthorizer();
  const defaultCheckSetupLease = createInstallSetupLeaseChecker();
  const deps: IInstallServerDependencies = {
    authorizeRequest: dependencies.authorizeRequest ?? defaultAuthorizeRequest,
    checkSetupLease: dependencies.checkSetupLease ?? defaultCheckSetupLease,
    spawnPty: dependencies.spawnPty ?? pty.spawn,
    scheduleTask: dependencies.scheduleTask ?? defaultScheduleTask,
    platform: dependencies.platform ?? process.platform,
  };
  const commands = getInstallCommands(deps.platform);

  let slot: TInstallSlot = { state: 'idle' };
  let shuttingDown = false;

  const ownsStartingSlot = (owner: symbol): boolean =>
    slot.state === 'starting' && slot.owner === owner;

  const getStartingSlot = (owner: symbol): Extract<TInstallSlot, { state: 'starting' }> | null =>
    slot.state === 'starting' && slot.owner === owner ? slot : null;

  const ownsActiveSlot = (connection: IActiveInstallConnection): boolean =>
    slot.state === 'active'
    && slot.owner === connection.owner
    && slot.connection === connection;

  const cleanupStarting = (
    starting: Extract<TInstallSlot, { state: 'starting' }>,
    options: { destroy: boolean } = { destroy: true },
  ): void => {
    const ptyProcess = starting.pty;
    starting.pty = null;
    try {
      starting.exitDisposable?.dispose();
    } catch {
      // Listener disposal is best effort during teardown.
    }
    starting.exitDisposable = null;
    if (slot === starting) slot = { state: 'idle' };
    if (options.destroy && ptyProcess) destroyPty(ptyProcess);
  };

  const releaseStarting = (owner: symbol): void => {
    const starting = getStartingSlot(owner);
    if (starting) cleanupStarting(starting);
  };

  const cleanupActive = (
    connection: IActiveInstallConnection,
    options: { destroy: boolean } = { destroy: true },
  ): void => {
    if (connection.cleaned) return;
    connection.cleaned = true;
    connection.commandTask?.cancel();
    connection.leaseTask?.cancel();
    connection.commandTask = null;
    connection.leaseTask = null;
    for (const disposable of connection.disposables) {
      try {
        disposable.dispose();
      } catch {
        // Listener disposal is best effort during teardown.
      }
    }
    connection.disposables.length = 0;
    if (ownsActiveSlot(connection)) slot = { state: 'idle' };
    if (options.destroy) destroyPty(connection.pty);
  };

  const failActive = (
    connection: IActiveInstallConnection,
    code: number,
    reason: string,
  ): void => {
    cleanupActive(connection);
    closeSocket(connection.ws, code, reason);
  };

  const readLease = async (): Promise<TInstallSetupLeaseState> => {
    try {
      return await deps.checkSetupLease();
    } catch {
      return 'unavailable';
    }
  };

  const handleConnection: IInstallServer['handleConnection'] = async (
    ws,
    request,
    context,
  ) => {
    ws.on('error', () => undefined);

    if (
      !context
      || !(context.url instanceof URL)
      || (context.url.protocol !== 'http:' && context.url.protocol !== 'https:')
      || context.url.pathname !== '/api/install'
      || (context.admittedMode !== 'setup-local' && context.admittedMode !== 'authenticated')
    ) {
      closeSocket(ws, 1008, 'Invalid install context');
      return;
    }

    let resolveReady!: (connection: IActiveInstallConnection | null) => void;
    const ready = new Promise<IActiveInstallConnection | null>((resolve) => {
      resolveReady = resolve;
    });
    let readySettled = false;
    const settleReady = (connection: IActiveInstallConnection | null): void => {
      if (readySettled) return;
      readySettled = true;
      resolveReady(connection);
    };

    let owner: symbol | null = null;
    let aborted = ws.readyState !== WebSocket.OPEN;
    let queuedFrames = 0;
    let queuedBytes = 0;
    let inputQueue = Promise.resolve();

    const cleanupOwnedSlot = (): void => {
      if (!owner) return;
      if (slot.state === 'starting' && slot.owner === owner) {
        slot.closed = true;
        cleanupStarting(slot);
        return;
      }
      if (slot.state === 'active' && slot.owner === owner) {
        cleanupActive(slot.connection);
      }
    };

    const abort = (code?: number, reason?: string): void => {
      if (aborted) return;
      aborted = true;
      settleReady(null);
      cleanupOwnedSlot();
      if (code !== undefined && reason !== undefined) closeSocket(ws, code, reason);
    };

    const processInput = async (frame: Uint8Array): Promise<void> => {
      const connection = await ready;
      if (
        aborted
        || !connection
        || connection.cleaned
        || !ownsActiveSlot(connection)
      ) {
        return;
      }

      const type = frame[0];
      if (type !== MSG_STDIN && type !== MSG_RESIZE) return;

      if (connection.mode === 'setup-local') {
        const lease = await readLease();
        if (
          aborted
          || connection.cleaned
          || !ownsActiveSlot(connection)
        ) {
          return;
        }
        if (lease !== 'valid') {
          const close = leaseClose(lease);
          aborted = true;
          failActive(connection, close.code, close.reason);
          return;
        }
      }

      const payload = frame.subarray(1);
      if (type === MSG_STDIN) {
        connection.pty.write(textDecoder.decode(payload));
        return;
      }
      if (payload.byteLength < 4) return;
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const cols = view.getUint16(0);
      const rows = view.getUint16(2);
      if (cols > 0 && rows > 0) {
        connection.pty.resize(
          Math.min(cols, MAX_TERMINAL_COLS),
          Math.min(rows, MAX_TERMINAL_ROWS),
        );
      }
    };

    ws.on('close', () => abort());
    ws.on('error', () => abort());
    ws.on('message', (raw: WebSocket.RawData) => {
      if (aborted) return;

      let byteLength: number;
      try {
        byteLength = rawByteLength(raw);
      } catch {
        abort(1009, 'Invalid install frame');
        return;
      }
      if (byteLength > INSTALL_MAX_FRAME_BYTES) {
        abort(1009, 'Install frame too large');
        return;
      }
      if (
        queuedFrames >= MAX_QUEUED_INSTALL_FRAMES
        || queuedBytes + byteLength > MAX_QUEUED_INSTALL_BYTES
      ) {
        abort(1011, 'Install input backpressure');
        return;
      }

      let frame: Uint8Array;
      try {
        frame = copyRawData(raw);
      } catch {
        abort(1009, 'Invalid install frame');
        return;
      }
      queuedFrames += 1;
      queuedBytes += byteLength;
      inputQueue = inputQueue
        .then(() => processInput(frame))
        .catch(() => abort(1011, 'Install input failed'))
        .finally(() => {
          queuedFrames -= 1;
          queuedBytes -= byteLength;
        });
    });

    if (aborted) {
      settleReady(null);
      return;
    }
    if (shuttingDown) {
      abort(1013, 'Install server unavailable');
      return;
    }

    let activeConnection: IActiveInstallConnection | null = null;
    try {
      const freshAuthorization = await deps.authorizeRequest(request);
      if (aborted) {
        settleReady(null);
        return;
      }

      if (
        !freshAuthorization.authorized
        || freshAuthorization.mode !== context.admittedMode
      ) {
        if (context.admittedMode === 'setup-local') {
          const lease = await readLease();
          if (aborted) {
            settleReady(null);
            return;
          }
          if (lease !== 'valid') {
            const close = leaseClose(lease);
            abort(close.code, close.reason);
            return;
          }
        }
        abort(1008, 'Install authorization changed');
        return;
      }

      const commandValues = context.url.searchParams.getAll('command');
      const command = commandValues.length === 1 ? commandValues[0] : null;
      if (
        !commands
        || !command
        || !Object.hasOwn(commands, command)
        || (
          context.admittedMode === 'authenticated'
          && !RUNTIME_INSTALL_COMMANDS.has(command)
        )
      ) {
        abort(1008, 'Invalid install command');
        return;
      }

      if (shuttingDown || slot.state !== 'idle') {
        abort(1013, 'Install session busy');
        return;
      }

      owner = Symbol('install-owner');
      const startingSlot: Extract<TInstallSlot, { state: 'starting' }> = {
        state: 'starting',
        owner,
        ws,
        closed: false,
        pty: null,
        exitDisposable: null,
      };
      slot = startingSlot;

      if (context.admittedMode === 'setup-local') {
        const lease = await readLease();
        if (aborted || !ownsStartingSlot(owner)) {
          settleReady(null);
          return;
        }
        if (lease !== 'valid') {
          const close = leaseClose(lease);
          releaseStarting(owner);
          abort(close.code, close.reason);
          return;
        }
      }

      const shell = os.userInfo().shell
        || PRISTINE_ENV.SHELL
        || (deps.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
      const cols = parseDimension(context.url.searchParams.get('cols'), 80, MAX_TERMINAL_COLS);
      const rows = parseDimension(context.url.searchParams.get('rows'), 24, MAX_TERMINAL_ROWS);

      const spawnedPty = await deps.spawnPty(shell, ['-il'], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: PRISTINE_ENV.HOME || '/',
        env: {
          ...buildShellEnv(),
          SHELL: shell,
        },
      });

      if (aborted || shuttingDown || !ownsStartingSlot(owner)) {
        destroyPty(spawnedPty);
        releaseStarting(owner);
        settleReady(null);
        return;
      }

      startingSlot.pty = spawnedPty;
      startingSlot.exitDisposable = spawnedPty.onExit(() => {
        if (slot !== startingSlot) return;
        startingSlot.closed = true;
        cleanupStarting(startingSlot, { destroy: false });
        aborted = true;
        settleReady(null);
        closeSocket(ws, 1000, 'Process exited');
      });

      if (context.admittedMode === 'setup-local') {
        const lease = await readLease();
        if (aborted || shuttingDown || !ownsStartingSlot(owner)) {
          releaseStarting(owner);
          settleReady(null);
          return;
        }
        if (lease !== 'valid') {
          const close = leaseClose(lease);
          releaseStarting(owner);
          abort(close.code, close.reason);
          return;
        }
      }

      const connection: IActiveInstallConnection = {
        owner,
        ws,
        pty: spawnedPty,
        disposables: [],
        commandTask: null,
        leaseTask: null,
        cleaned: false,
        mode: context.admittedMode,
      };
      try {
        startingSlot.exitDisposable?.dispose();
      } catch {
        // Listener disposal is best effort during ownership transfer.
      }
      startingSlot.exitDisposable = null;
      startingSlot.pty = null;
      activeConnection = connection;
      slot = { state: 'active', owner, connection };

      connection.disposables.push(connection.pty.onData((data) => {
        if (connection.cleaned || !ownsActiveSlot(connection)) return;
        try {
          const frame = encodeStdout(data);
          if (ws.bufferedAmount + frame.byteLength > INSTALL_MAX_BUFFERED_OUTPUT_BYTES) {
            failActive(connection, 1011, 'Install output backpressure');
            return;
          }
          if (ws.readyState === WebSocket.OPEN) ws.send(frame);
        } catch {
          failActive(connection, 1011, 'Install output failed');
        }
      }));
      connection.disposables.push(connection.pty.onExit(() => {
        if (connection.cleaned || !ownsActiveSlot(connection)) return;
        cleanupActive(connection, { destroy: false });
        closeSocket(ws, 1000, 'Process exited');
      }));

      settleReady(connection);

      connection.commandTask = deps.scheduleTask('command', async () => {
        try {
          if (connection.cleaned || !ownsActiveSlot(connection)) return;
          if (connection.mode === 'setup-local') {
            const lease = await readLease();
            if (connection.cleaned || !ownsActiveSlot(connection)) return;
            if (lease !== 'valid') {
              const close = leaseClose(lease);
              aborted = true;
              failActive(connection, close.code, close.reason);
              return;
            }
          }
          connection.pty.write(`${commands[command]}\n`);
        } catch {
          aborted = true;
          failActive(connection, 1011, 'Install command failed');
        }
      }, 300);

      const scheduleLeaseWatcher = (): void => {
        if (connection.cleaned || !ownsActiveSlot(connection)) return;
        connection.leaseTask = deps.scheduleTask('lease', async () => {
          if (connection.cleaned || !ownsActiveSlot(connection)) return;
          const lease = await readLease();
          if (connection.cleaned || !ownsActiveSlot(connection)) return;
          if (lease !== 'valid') {
            const close = leaseClose(lease);
            aborted = true;
            failActive(connection, close.code, close.reason);
            return;
          }
          scheduleLeaseWatcher();
        }, 500);
      };
      if (connection.mode === 'setup-local') scheduleLeaseWatcher();

      log.info('install session started');
    } catch {
      if (activeConnection) cleanupActive(activeConnection);
      else if (owner) releaseStarting(owner);
      settleReady(null);
      aborted = true;
      closeSocket(ws, 1011, 'Install server error');
      log.error('install session failed');
    }
  };

  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (slot.state === 'starting') {
      const starting = slot;
      starting.closed = true;
      cleanupStarting(starting);
      closeSocket(starting.ws, 1001, 'Server shutting down');
      return;
    }
    if (slot.state === 'active') {
      const connection = slot.connection;
      cleanupActive(connection);
      closeSocket(connection.ws, 1001, 'Server shutting down');
    }
  };

  return { handleConnection, shutdown };
};

import './src/lib/legacy-env-bootstrap';
if (!process.env.AGENTMUX_CLI) process.env.AGENTMUX_CLI = '1';
import './src/lib/pristine-env';
import { createServer, request as httpRequest } from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import { createConnection } from 'net';
import type { Duplex } from 'stream';
import os from 'os';
import path from 'path';
import next from 'next';
import { WebSocketServer } from 'ws';
import {
  DATA_DIR_NAME,
  LEGACY_DATA_DIR_NAME,
  prepareDataDir,
  type IDataDirConflictError,
} from './src/lib/app-identity';
import {
  buildCookieHeader,
  signSessionToken,
  verifySessionCookies,
} from './src/lib/auth';
import { handleConnection, gracefulShutdown } from './src/lib/terminal-server';
import { createInstallServer, INSTALL_MAX_FRAME_BYTES } from './src/lib/install-server';
import {
  createInstallRequestAuthorizer,
  createInstallSetupLeaseChecker,
} from './src/lib/install-request-auth';
import { handleTimelineConnection, gracefulTimelineShutdown } from './src/lib/timeline-server';
import { handleSyncConnection, gracefulSyncShutdown } from './src/lib/sync-server';
import { handleStatusConnection, gracefulStatusShutdown } from './src/lib/status-server';
import { getStatusManager } from './src/lib/status-manager';
import { ensureHookSettings, removePortFile } from './src/lib/hook-settings';
import { getCliToken } from './src/lib/cli-token';
import { acquireLock, releaseLock, registerLockCleanup } from './src/lib/lock';
import { scanSessions, applyConfig } from './src/lib/tmux';
import { initWorkspaceStore } from './src/lib/workspace-store';
import { autoResumeOnStartup } from './src/lib/auto-resume';
import { listInterfaceIps, resolveBindPlan } from './src/lib/network-access';
import { getCurrentSpec, isRequestAllowed, setBoundHost } from './src/lib/access-filter';
import { validateOuterBootstrapRequest } from './src/lib/bootstrap-request-guard';
import { initializeServerBootstrap } from './src/lib/server-bootstrap';
import {
  cleanupExpiredUploads,
  cleanupStaleUploadParts,
  streamUploadArtifact,
} from './src/lib/uploads-store';
import { createUploadAdmissionService } from './src/lib/upload-admission';
import { authorizeUploadRequest } from './src/lib/upload-request-auth';
import { createUploadServer, type IUploadServer } from './src/lib/upload-server';
import {
  createOuterServerLifecycle,
  createServerHttpDispatcher,
  listenWithFallback,
} from './src/lib/server-http-dispatcher';
import { cleanupOrphanSessionStats } from './src/lib/session-stats';
import {
  initSessionIndexService,
  shouldPrewarmSessionIndexOnStartup,
  shutdownSessionIndexService,
} from './src/lib/session-index';
import { getRuntimeSupervisor } from './src/lib/runtime/supervisor';
import { getRuntimeStatusV2Mode } from './src/lib/runtime/status-mode';
import { runRuntimeStartupDiagnostic } from './src/lib/runtime/startup-diagnostic';
import { handleRuntimeTerminalConnection } from './src/lib/runtime/terminal-ws';
import {
  createWebSocketUpgradeHandler,
  type IRuntimeTerminalUpgradeContext,
  type TUpgradeRequestGuardResult,
} from './src/lib/runtime/server-ws-upgrade';
import { createLogger } from './src/lib/logger';
import pkg from './package.json';

const log = createLogger('server');
const dev = process.env.NODE_ENV !== 'production';

const verifyWebSocketAuth = async (request: IncomingMessage): Promise<boolean> => {
  return !!(await verifySessionCookies(request.headers.cookie));
};

const WS_PATHS = new Set(['/api/terminal', '/api/timeline', '/api/sync', '/api/status', '/api/v2/terminal']);

const createWsServers = () => {
  const authorizeInstallRequest = createInstallRequestAuthorizer();
  const installServer = createInstallServer({
    authorizeRequest: authorizeInstallRequest,
    checkSetupLease: createInstallSetupLeaseChecker(),
  });
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', handleConnection);

  const timelineWss = new WebSocketServer({ noServer: true });
  timelineWss.on('connection', handleTimelineConnection);

  const syncWss = new WebSocketServer({ noServer: true });
  syncWss.on('connection', handleSyncConnection);

  const statusWss = new WebSocketServer({ noServer: true });
  statusWss.on('connection', handleStatusConnection);

  const installWss = new WebSocketServer({
    noServer: true,
    maxPayload: INSTALL_MAX_FRAME_BYTES,
  });

  const runtimeTerminalWss = new WebSocketServer({ noServer: true });
  runtimeTerminalWss.on('connection', (ws: import('ws').WebSocket, _request: IncomingMessage, context: unknown) => {
    void handleRuntimeTerminalConnection(
      ws,
      context as IRuntimeTerminalUpgradeContext,
      getRuntimeSupervisor(),
    );
  });

  return {
    wss,
    timelineWss,
    syncWss,
    statusWss,
    installWss,
    installServer,
    authorizeInstallRequest,
    runtimeTerminalWss,
  };
};

const handleWsUpgrade = (
  { wss, timelineWss, syncWss, statusWss }: ReturnType<typeof createWsServers>,
  request: IncomingMessage,
  socket: import('stream').Duplex,
  head: Buffer,
  url: URL,
) => {
  if (url.pathname === '/api/terminal') {
    const sessionId = url.searchParams.get('session');
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, sessionId);
    });
  } else if (url.pathname === '/api/timeline') {
    timelineWss.handleUpgrade(request, socket, head, (ws) => {
      timelineWss.emit('connection', ws, request);
    });
  } else if (url.pathname === '/api/sync') {
    syncWss.handleUpgrade(request, socket, head, (ws) => {
      syncWss.emit('connection', ws);
    });
  } else if (url.pathname === '/api/status') {
    statusWss.handleUpgrade(request, socket, head, (ws) => {
      statusWss.emit('connection', ws);
    });
  }
};

const runShutdownOperations = async (
  operations: Array<() => void | Promise<void>>,
): Promise<void> => {
  let firstError: unknown;
  let hasError = false;
  for (const operation of operations) {
    try {
      await operation();
    } catch (error) {
      if (hasError) continue;
      hasError = true;
      firstError = error;
    }
  }
  if (hasError) throw firstError;
};

const shutdownWs = async (servers: ReturnType<typeof createWsServers>): Promise<void> => {
  await runShutdownOperations([
    () => servers.installServer.shutdown(),
    () => shutdownSessionIndexService(),
    () => gracefulTimelineShutdown(),
    () => gracefulSyncShutdown(),
    () => gracefulStatusShutdown(),
    () => gracefulShutdown(),
  ]);
};

const terminateWsClients = (servers: ReturnType<typeof createWsServers>): void => {
  const webSocketServers = [
    servers.wss,
    servers.timelineWss,
    servers.syncWss,
    servers.statusWss,
    servers.installWss,
    servers.runtimeTerminalWss,
  ];
  for (const webSocketServer of webSocketServers) {
    for (const client of [...webSocketServer.clients]) {
      try {
        client.terminate();
      } catch {
        // WebSocket shutdown is best effort after the grace period.
      }
    }
  }
};

// --- Production: HTTP proxy to Next.js standalone ---

const proxyRequest = (req: IncomingMessage, res: ServerResponse, internalPort: number) => {
  const proxyReq = httpRequest(
    {
      hostname: '127.0.0.1',
      port: internalPort,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode!, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502);
      res.end('Bad Gateway');
    }
  });
  req.pipe(proxyReq);
};

const proxyUpgrade = (req: IncomingMessage, socket: import('stream').Duplex, head: Buffer, internalPort: number) => {
  const proxySocket = createConnection({ host: '127.0.0.1', port: internalPort }, () => {
    const reqLine = `${req.method} ${req.url} HTTP/1.1\r\n`;
    const headers = Object.entries(req.headers)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join('\r\n');
    proxySocket.write(reqLine + headers + '\r\n\r\n');
    if (head.length > 0) proxySocket.write(head);
    socket.pipe(proxySocket).pipe(socket);
  });
  proxySocket.on('error', () => socket.destroy());
  socket.on('error', () => proxySocket.destroy());
};

const getFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });

const waitForPort = (port: number, timeoutMs = 10_000): Promise<void> =>
  new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (Date.now() > deadline) {
        reject(new Error(`Standalone server failed to start on port ${port}`));
        return;
      }
      const sock = createConnection({ host: '127.0.0.1', port });
      sock.on('connect', () => {
        sock.destroy();
        resolve();
      });
      sock.on('error', () => setTimeout(check, 50));
    };
    check();
  });

// --- Start ---

interface IStartOptions {
  port?: number;
}

interface IStartResult {
  port: number;
  shutdown: () => Promise<void>;
}

type TFallbackRequest = (
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>;
type TFallbackUpgrade = (
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) => void | Promise<void>;

interface IStartOuterServerOptions {
  port: number;
  bindHost: string;
  uploadServer: IUploadServer;
  fallbackRequest: TFallbackRequest;
  fallbackUpgrade: TFallbackUpgrade;
}

const validateServerRequest = (request: IncomingMessage): TUpgradeRequestGuardResult => {
  if (!isRequestAllowed(request.socket.remoteAddress)) {
    return { allowed: false, statusCode: 403, reason: 'source-forbidden' };
  }
  return validateOuterBootstrapRequest(request);
};

const createWsUpgradeFallback = (
  port: number,
  wsServers: ReturnType<typeof createWsServers>,
  fallbackUpgrade: TFallbackUpgrade,
): TFallbackUpgrade => createWebSocketUpgradeHandler({
  port,
  wsPaths: WS_PATHS,
  authorizeInstallRequest: wsServers.authorizeInstallRequest,
  handleInstallUpgrade: (context, req, upgradeSocket, upgradeHead) => {
    wsServers.installWss.handleUpgrade(req, upgradeSocket, upgradeHead, (ws) => {
      void wsServers.installServer.handleConnection(ws, req, {
        url: context.url,
        admittedMode: context.authorization.mode,
      }).catch(() => ws.close(1011, 'Install server error'));
    });
  },
  verifyGenericAuth: verifyWebSocketAuth,
  handleKnownUpgrade: (url, req, upgradeSocket, upgradeHead) => {
    handleWsUpgrade(wsServers, req, upgradeSocket, upgradeHead, url);
  },
  handleRuntimeTerminalUpgrade: (context, req, upgradeSocket, upgradeHead) => {
    wsServers.runtimeTerminalWss.handleUpgrade(req, upgradeSocket, upgradeHead, (ws) => {
      wsServers.runtimeTerminalWss.emit('connection', ws, req, context);
    });
  },
  fallbackUpgrade,
  validateUpgradeRequest: () => ({ allowed: true }),
  onUpgradeError: () => log.error('websocket-upgrade-failed'),
});

const waitForUpgradeGrace = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 250));

const shutdownRuntimeResources = async (): Promise<void> => {
  await runShutdownOperations([
    () => releaseLock(),
    () => removePortFile(),
    () => {
      if (process.env.AGENTMUX_RUNTIME_V2 === '1') {
        getRuntimeSupervisor().shutdown();
      }
    },
  ]);
};

const startOuterServer = async ({
  port,
  bindHost,
  uploadServer,
  fallbackRequest,
  fallbackUpgrade,
}: IStartOuterServerOptions): Promise<IStartResult> => {
  const server = createServer();
  const wsServers = createWsServers();
  const dispatcher = createServerHttpDispatcher({
    validateRequest: validateServerRequest,
    uploadServer,
    fallbackRequest,
    fallbackUpgrade: createWsUpgradeFallback(port, wsServers, fallbackUpgrade),
  });
  server.on('request', dispatcher.handleRequest);
  server.on('checkContinue', dispatcher.handleCheckContinue);
  server.on('checkExpectation', dispatcher.handleCheckExpectation);
  server.on('upgrade', dispatcher.handleUpgrade);

  const lifecycle = createOuterServerLifecycle({
    server,
    uploadServer,
    listen: () => listenWithFallback(
      server,
      port,
      bindHost,
      () => log.warn(`Port ${port} is in use, finding an available port...`),
    ),
    shutdownRuntime: shutdownRuntimeResources,
    shutdownWebSockets: () => shutdownWs(wsServers),
    waitForUpgradeGrace,
    terminateWebSocketClients: () => terminateWsClients(wsServers),
    terminateUpgradedSockets: dispatcher.terminateUpgradedSockets,
  });

  const removeSignalListeners = (): void => {
    process.off('SIGTERM', exitGracefully);
    process.off('SIGINT', exitGracefully);
  };
  let serverShutdownPromise: Promise<void> | null = null;
  const shutdown = (): Promise<void> => {
    serverShutdownPromise ??= lifecycle.shutdown().finally(removeSignalListeners);
    return serverShutdownPromise;
  };
  const exitGracefully = (): void => {
    void shutdown().then(
      () => process.exit(0),
      () => {
        log.error('server-shutdown-failed');
        process.exit(1);
      },
    );
  };

  const actualPort = await lifecycle.start();
  process.on('SIGTERM', exitGracefully);
  process.on('SIGINT', exitGracefully);
  return { port: actualPort, shutdown };
};

const startDev = async (
  port: number,
  appDir: string,
  bindHost: string,
  uploadServer: IUploadServer,
): Promise<IStartResult> => {
  const app = next({ dev: true, dir: appDir });
  const handle = app.getRequestHandler();
  await app.prepare();

  return startOuterServer({
    port,
    bindHost,
    uploadServer,
    fallbackRequest: handle,
    fallbackUpgrade: app.getUpgradeHandler(),
  });
};

const startProd = async (
  port: number,
  appDir: string,
  bindHost: string,
  uploadServer: IUploadServer,
): Promise<IStartResult> => {
  const internalPort = await getFreePort();

  const savedPort = process.env.PORT;
  process.env.PORT = String(internalPort);
  process.env.HOSTNAME = '127.0.0.1';
  // The outer lifecycle must drain uploads before the embedded Next server can exit.
  process.env.NEXT_MANUAL_SIG_HANDLE = 'true';

  const standaloneDir = process.env.__CMUX_APP_DIR_UNPACKED || appDir;
  const standalonePath = path.join(standaloneDir, '.next', 'standalone', 'server.js');
  require(standalonePath); // eslint-disable-line @typescript-eslint/no-require-imports

  process.env.PORT = savedPort;
  await waitForPort(internalPort);

  return startOuterServer({
    port,
    bindHost,
    uploadServer,
    fallbackRequest: (request, response) => proxyRequest(request, response, internalPort),
    fallbackUpgrade: (request, socket, head) => proxyUpgrade(request, socket, head, internalPort),
  });
};

export const DEFAULT_PORT = 8122;



export const start = async (opts?: IStartOptions): Promise<IStartResult> => {
  try {
    prepareDataDir();
  } catch (err) {
    const conflict = err as Partial<IDataDirConflictError>;
    if (conflict?.code === 'data-dir-conflict') {
      const homeDir = os.homedir();
      const agentmuxPath = conflict.agentmuxPath ?? path.join(homeDir, DATA_DIR_NAME);
      const legacyPath = conflict.legacyPath ?? path.join(homeDir, LEGACY_DATA_DIR_NAME);
      process.stderr.write(
        `[agentmux] Fatal data directory conflict (${conflict.reason}): agentmux=${agentmuxPath}, legacy=${legacyPath}\n`,
      );
      process.exit(1);
    }
    throw err;
  }

  const port = opts?.port ?? parseInt(process.env.PORT || String(DEFAULT_PORT), 10);
  const appDir = process.env.__CMUX_APP_DIR || process.cwd();

  await acquireLock(port);
  registerLockCleanup();

  const bootstrap = await initializeServerBootstrap();

  await scanSessions();
  await applyConfig();
  await initWorkspaceStore();
  await autoResumeOnStartup();
  if (shouldPrewarmSessionIndexOnStartup()) {
    await initSessionIndexService();
  }
  if (process.env.AGENTMUX_RUNTIME_V2 === '1') {
    runRuntimeStartupDiagnostic(getRuntimeSupervisor(), log);
  }
  if (process.env.AGENTMUX_RUNTIME_V2 === '1' && getRuntimeStatusV2Mode() === 'default') {
    try {
      await getRuntimeSupervisor().startStatusLive();
    } catch (err) {
      log.warn(`Runtime status live startup failed, falling back: ${err instanceof Error ? err.message : err}`);
      await getStatusManager().init();
    }
  } else {
    await getStatusManager().init();
  }

  const { envHost } = bootstrap.network;
  const accessSpec = getCurrentSpec();
  const bindPlan = resolveBindPlan(accessSpec);
  setBoundHost(bindPlan.host);

  const uploadServer = createUploadServer({
    authorizeRequest: authorizeUploadRequest,
    admission: createUploadAdmissionService(),
    streamArtifact: streamUploadArtifact,
    createSessionRefreshHeader: async (secure) =>
      buildCookieHeader(await signSessionToken(), secure),
    cleanupStaleParts: cleanupStaleUploadParts,
    clock: {
      now: Date.now,
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (timer) => clearTimeout(timer),
    },
    disabled: process.env.AGENTMUX_UPLOADS_DISABLED === '1',
  });
  const result = dev
    ? await startDev(port, appDir, bindPlan.host, uploadServer)
    : await startProd(port, appDir, bindPlan.host, uploadServer);

  process.env.PORT = String(result.port);

  await ensureHookSettings(result.port);
  getCliToken();

  cleanupExpiredUploads()
    .then((r) => {
      if (r.deleted > 0) log.info(`uploads cleanup: removed ${r.deleted} files (${r.freedBytes} bytes)`);
    })
    .catch(() => log.warn('uploads-cleanup-failed'));

  cleanupOrphanSessionStats().catch((err) =>
    log.warn(`session-stats cleanup failed: ${err instanceof Error ? err.message : err}`),
  );

  const mode = dev ? 'development' : process.env.NODE_ENV;
  const urls = listInterfaceIps(accessSpec, result.port);
  console.log('');
  console.log(`  \x1b[1m\x1b[35m⚡ codexmux\x1b[0m  \x1b[2mv${pkg.version}\x1b[0m`);
  console.log(`  \x1b[2m➜\x1b[0m  Available on:`);
  for (const url of urls) {
    console.log(`       \x1b[36m${url}\x1b[0m`);
  }
  if (bootstrap.network.setupRestrictedAtStartup) {
    console.log(`  \x1b[2m➜\x1b[0m  Security: \x1b[33msetup mode, loopback-only\x1b[0m`);
    if (envHost) {
      console.log(`  \x1b[2m➜\x1b[0m  Deferred: \x1b[33mHOST=${envHost} applies after setup and restart\x1b[0m`);
    }
  } else if (envHost) {
    console.log(`  \x1b[2m➜\x1b[0m  Access: \x1b[33mHOST=${envHost}\x1b[0m`);
  }
  console.log(`  \x1b[2m➜\x1b[0m  Mode:   \x1b[33m${mode}\x1b[0m`);
  const authStatus = bootstrap.authBootstrap.mode === 'setup-open'
    ? `\x1b[33mwaiting for onboarding\x1b[0m \x1b[2m(${urls[0]}/login)\x1b[0m`
    : bootstrap.authBootstrap.mode === 'init-password'
      ? `\x1b[33minit password\x1b[0m \x1b[2m(onboarding required)\x1b[0m`
      : `\x1b[32mconfigured\x1b[0m`;
  console.log(`  \x1b[2m➜\x1b[0m  Auth:   ${authStatus}`);
  console.log('');

  return result;
};

if (!process.env.__CMUX_ELECTRON) {
  start();
}

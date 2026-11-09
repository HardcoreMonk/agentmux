import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import type {
  TAuthorizeInstallRequest,
  TInstallAuthorizationMode,
} from '@/lib/install-request-auth';
import type { TBootstrapRequestRejectionReason } from '@/lib/bootstrap-request-guard';
import { verifyRuntimeV2WebSocketAuth } from '@/lib/runtime/api-auth';
import { parseRuntimeSessionName } from '@/lib/runtime/session-name';

const MAX_TERMINAL_COLS = 500;
const MAX_TERMINAL_ROWS = 200;
const DECIMAL_DIMENSION_RE = /^[1-9]\d*$/;

export interface IRuntimeTerminalUpgradeContext {
  sessionName: string;
  cols: number;
  rows: number;
}

export interface IInstallWebSocketUpgradeContext {
  readonly route: 'install';
  readonly url: URL;
  readonly authorization: {
    readonly authorized: true;
    readonly mode: TInstallAuthorizationMode;
  };
}

export const parseTerminalDimension = (value: string | null, fallback: number, max: number): number => {
  if (value === null) return fallback;
  if (!DECIMAL_DIMENSION_RE.test(value)) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Math.min(parsed, max);
};

export interface IRouteWebSocketUpgradeOptions {
  request: IncomingMessage;
  socket: Duplex;
  head: Buffer;
  port: number;
  wsPaths: ReadonlySet<string>;
  authorizeInstallRequest: TAuthorizeInstallRequest;
  handleInstallUpgrade: (
    context: IInstallWebSocketUpgradeContext,
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => void;
  handleKnownUpgrade: (url: URL, request: IncomingMessage, socket: Duplex, head: Buffer) => void;
  handleRuntimeTerminalUpgrade: (
    context: IRuntimeTerminalUpgradeContext,
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => void;
  fallbackUpgrade: (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => void | Promise<void>;
  verifyRuntimeAuth?: typeof verifyRuntimeV2WebSocketAuth;
  verifyGenericAuth: (request: IncomingMessage) => Promise<boolean>;
  runtimeEnabled?: () => boolean;
}

export interface ICreateWebSocketUpgradeHandlerOptions {
  port: number;
  wsPaths: ReadonlySet<string>;
  authorizeInstallRequest: IRouteWebSocketUpgradeOptions['authorizeInstallRequest'];
  handleInstallUpgrade: IRouteWebSocketUpgradeOptions['handleInstallUpgrade'];
  handleKnownUpgrade: IRouteWebSocketUpgradeOptions['handleKnownUpgrade'];
  handleRuntimeTerminalUpgrade: IRouteWebSocketUpgradeOptions['handleRuntimeTerminalUpgrade'];
  fallbackUpgrade: IRouteWebSocketUpgradeOptions['fallbackUpgrade'];
  verifyGenericAuth: IRouteWebSocketUpgradeOptions['verifyGenericAuth'];
  validateUpgradeRequest: (request: IncomingMessage) => TUpgradeRequestGuardResult;
  onUpgradeError?: (error: unknown) => void;
  routeUpgrade?: (options: IRouteWebSocketUpgradeOptions) => void | Promise<void>;
}

export type TUpgradeRequestGuardResult =
  | { allowed: true }
  | {
      allowed: false;
      statusCode: 400 | 403 | 415 | 503;
      reason: TBootstrapRequestRejectionReason | 'source-forbidden';
    };

const safeDestroySocket = (socket: Duplex): void => {
  try {
    if (!socket.destroyed) socket.destroy();
  } catch {
    // best-effort socket cleanup
  }
};

const writeUpgradeJsonError = (
  socket: Duplex,
  statusCode: number,
  reason: string,
  body: Record<string, string>,
): void => {
  const payload = JSON.stringify(body);
  const headers = [
    `HTTP/1.1 ${statusCode} ${reason}`,
    'Content-Type: application/json',
    `Content-Length: ${Buffer.byteLength(payload, 'utf8')}`,
    'Connection: close',
  ];
  const response = `${headers.join('\r\n')}\r\n\r\n${payload}`;
  try {
    socket.end(response);
  } catch {
    safeDestroySocket(socket);
  }
};

const verifyUpgradeAuth = async (
  verifyAuth: (request: IncomingMessage) => Promise<boolean>,
  request: IncomingMessage,
): Promise<boolean> => {
  try {
    return await verifyAuth(request);
  } catch {
    return false;
  }
};

const getUpgradeStatusReason = (statusCode: 400 | 401 | 403 | 415 | 503): string => {
  switch (statusCode) {
    case 400:
      return 'Bad Request';
    case 401:
      return 'Unauthorized';
    case 403:
      return 'Forbidden';
    case 415:
      return 'Unsupported Media Type';
    case 503:
      return 'Service Unavailable';
  }
};

const hasInvalidRawRequestTargetChars = (rawUrl: string): boolean => /[#\u0000-\u0020\u007f-\u{10ffff}]/u.test(rawUrl);
const hasMalformedPercentEncoding = (rawUrl: string): boolean => /%(?![0-9A-Fa-f]{2})/.test(rawUrl);
const hasEncodedPathDelimiter = (rawUrl: string): boolean => /%(?:2[fF]|5[cC])/.test(rawUrl.split('?')[0] ?? '');
const isOriginFormRequestTarget = (rawUrl: string): boolean => rawUrl.startsWith('/') && !rawUrl.startsWith('//');
const isRuntimeV2WebSocketNamespace = (pathname: string): boolean => pathname === '/api/v2' || pathname.startsWith('/api/v2/');

const getSingleSearchParam = (searchParams: URLSearchParams, name: string): string | null => {
  const values = searchParams.getAll(name);
  return values.length === 1 ? values[0] : null;
};

export const routeWebSocketUpgrade = async ({
  request,
  socket,
  head,
  port,
  wsPaths,
  authorizeInstallRequest,
  handleInstallUpgrade,
  handleKnownUpgrade,
  handleRuntimeTerminalUpgrade,
  fallbackUpgrade,
  verifyRuntimeAuth = verifyRuntimeV2WebSocketAuth,
  verifyGenericAuth,
  runtimeEnabled = () => process.env.AGENTMUX_RUNTIME_V2 === '1',
}: IRouteWebSocketUpgradeOptions): Promise<void> => {
  const rawUrl = typeof request.url === 'string' ? request.url : '';
  if (
    rawUrl.length === 0
    || hasInvalidRawRequestTargetChars(rawUrl)
    || hasMalformedPercentEncoding(rawUrl)
    || hasEncodedPathDelimiter(rawUrl)
    || !isOriginFormRequestTarget(rawUrl)
  ) {
    writeUpgradeJsonError(socket, 400, 'Bad Request', { error: 'invalid-websocket-url' });
    return;
  }

  let url: URL;
  try {
    url = new URL(rawUrl, `http://localhost:${port}`);
  } catch {
    writeUpgradeJsonError(socket, 400, 'Bad Request', { error: 'invalid-websocket-url' });
    return;
  }

  if (isRuntimeV2WebSocketNamespace(url.pathname) && url.pathname !== '/api/v2/terminal') {
    writeUpgradeJsonError(socket, 404, 'Not Found', { error: 'runtime-v2-upgrade-not-found' });
    return;
  }

  if (url.pathname === '/api/v2/terminal') {
    if (!runtimeEnabled()) {
      writeUpgradeJsonError(socket, 404, 'Not Found', { error: 'runtime-v2-disabled' });
      return;
    }
    if (!(await verifyUpgradeAuth(verifyRuntimeAuth, request))) {
      writeUpgradeJsonError(socket, 401, 'Unauthorized', { error: 'Unauthorized' });
      return;
    }

    const rawSessionName = getSingleSearchParam(url.searchParams, 'session');
    if (!rawSessionName) {
      writeUpgradeJsonError(socket, 400, 'Bad Request', { error: 'invalid-runtime-v2-terminal-session' });
      return;
    }

    let sessionName: string;
    try {
      sessionName = parseRuntimeSessionName(rawSessionName);
    } catch {
      writeUpgradeJsonError(socket, 400, 'Bad Request', { error: 'invalid-runtime-v2-terminal-session' });
      return;
    }

    handleRuntimeTerminalUpgrade({
      sessionName,
      cols: parseTerminalDimension(getSingleSearchParam(url.searchParams, 'cols'), 80, MAX_TERMINAL_COLS),
      rows: parseTerminalDimension(getSingleSearchParam(url.searchParams, 'rows'), 24, MAX_TERMINAL_ROWS),
    }, request, socket, head);
    return;
  }

  if (url.pathname === '/api/install') {
    let authorization;
    try {
      authorization = await authorizeInstallRequest(request);
    } catch {
      writeUpgradeJsonError(socket, 503, 'Service Unavailable', {
        error: 'install-auth-unavailable',
      });
      return;
    }
    if (!authorization.authorized) {
      writeUpgradeJsonError(
        socket,
        authorization.statusCode,
        getUpgradeStatusReason(authorization.statusCode),
        { error: authorization.reason },
      );
      return;
    }

    const admittedAuthorization = Object.freeze({
      authorized: true as const,
      mode: authorization.mode,
    });
    const context: IInstallWebSocketUpgradeContext = Object.freeze({
      route: 'install' as const,
      url,
      authorization: admittedAuthorization,
    });
    handleInstallUpgrade(context, request, socket, head);
    return;
  }

  if (!(await verifyUpgradeAuth(verifyGenericAuth, request))) {
    writeUpgradeJsonError(socket, 401, 'Unauthorized', { error: 'Unauthorized' });
    return;
  }

  if (wsPaths.has(url.pathname)) {
    handleKnownUpgrade(url, request, socket, head);
    return;
  }

  await fallbackUpgrade(request, socket, head);
};

export const createWebSocketUpgradeHandler = ({
  port,
  wsPaths,
  authorizeInstallRequest,
  handleInstallUpgrade,
  handleKnownUpgrade,
  handleRuntimeTerminalUpgrade,
  fallbackUpgrade,
  verifyGenericAuth,
  validateUpgradeRequest,
  onUpgradeError,
  routeUpgrade = routeWebSocketUpgrade,
}: ICreateWebSocketUpgradeHandlerOptions) => {
  return async (request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> => {
    try {
      const requestAdmission = validateUpgradeRequest(request);
      if (!requestAdmission.allowed) {
        writeUpgradeJsonError(
          socket,
          requestAdmission.statusCode,
          getUpgradeStatusReason(requestAdmission.statusCode),
          { error: requestAdmission.reason },
        );
        return;
      }

      await routeUpgrade({
        request,
        socket,
        head,
        port,
        wsPaths,
        authorizeInstallRequest,
        handleInstallUpgrade,
        verifyGenericAuth,
        handleKnownUpgrade,
        handleRuntimeTerminalUpgrade,
        fallbackUpgrade,
      });
    } catch (err) {
      try {
        onUpgradeError?.(err);
      } catch {
        // keep upgrade failure handling fail-closed
      }
      safeDestroySocket(socket);
    }
  };
};

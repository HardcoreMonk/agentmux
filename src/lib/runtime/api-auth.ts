import type { IncomingMessage } from 'http';
import type { NextApiRequest } from 'next';
import {
  LEGACY_SESSION_COOKIE,
  SESSION_COOKIE,
  verifySessionCookies,
  verifySessionToken,
} from '@/lib/auth';
import {
  CLI_TOKEN_HEADER,
  LEGACY_CLI_TOKEN_HEADER,
  readCliTokenHeader,
  verifyTokenValue,
} from '@/lib/cli-token';
import {
  validateBrowserRequestAuthority,
  validateSingleRequestHost,
} from '@/lib/request-authority';

export type TRuntimeApiCredential = { kind: 'cli' } | { kind: 'session' };

export type TRuntimeApiAuthorization =
  | { authorized: true; credential: TRuntimeApiCredential }
  | {
      authorized: false;
      statusCode: 400 | 401 | 403 | 503;
      reason: 'invalid-auth-request' | 'invalid-credential' | 'origin-forbidden' | 'auth-unavailable';
    };

const hasForbiddenQueryCredential = (rawUrl: string | undefined): boolean => {
  const forbidden = new Set([
    'token',
    CLI_TOKEN_HEADER,
    LEGACY_CLI_TOKEN_HEADER,
    'authorization',
    'auth',
    'api_key',
    'apikey',
    'access_token',
    SESSION_COOKIE.toLowerCase(),
    LEGACY_SESSION_COOKIE.toLowerCase(),
    'session-token',
  ]);
  try {
    const url = new URL(rawUrl ?? '/', 'http://localhost');
    return Array.from(url.searchParams.keys()).some((key) => forbidden.has(key.toLowerCase()));
  } catch {
    return true;
  }
};

const validateMutationAuthority = (
  req: NextApiRequest,
  credential: TRuntimeApiCredential,
): boolean => {
  if (!Array.isArray(req.rawHeaders)) return false;
  const host = validateSingleRequestHost(req);
  if (!host.valid) return false;
  const originCount = req.rawHeaders.reduce((count, header, index) =>
    index % 2 === 0 && header.toLowerCase() === 'origin' ? count + 1 : count, 0);
  if (credential.kind === 'cli' && originCount === 0) return true;
  if (originCount !== 1) return false;
  return validateBrowserRequestAuthority(req, { requireLoopbackHost: false }).valid;
};

export const authorizeRuntimeV2ApiRequest = async (
  req: NextApiRequest,
  options: { mutation?: boolean } = {},
): Promise<TRuntimeApiAuthorization> => {
  if (hasForbiddenQueryCredential(req.url)) {
    return { authorized: false, statusCode: 401, reason: 'invalid-credential' };
  }

  if (
    Array.isArray(req.headers[CLI_TOKEN_HEADER]) ||
    Array.isArray(req.headers[LEGACY_CLI_TOKEN_HEADER])
  ) {
    return { authorized: false, statusCode: 400, reason: 'invalid-auth-request' };
  }
  const cliToken = readCliTokenHeader(req.headers);
  try {
    if (typeof cliToken === 'string' && verifyTokenValue(cliToken)) {
      const credential = { kind: 'cli' } as const;
      if (options.mutation && !validateMutationAuthority(req, credential)) {
        return { authorized: false, statusCode: 403, reason: 'origin-forbidden' };
      }
      return { authorized: true, credential };
    }

    const cookieHeader = req.headers.cookie;
    if (Array.isArray(cookieHeader)) {
      return { authorized: false, statusCode: 400, reason: 'invalid-auth-request' };
    }
    if (!(await verifySessionCookies(cookieHeader, verifySessionToken))) {
      return { authorized: false, statusCode: 401, reason: 'invalid-credential' };
    }
    const credential = { kind: 'session' } as const;
    if (options.mutation && !validateMutationAuthority(req, credential)) {
      return { authorized: false, statusCode: 403, reason: 'origin-forbidden' };
    }
    return { authorized: true, credential };
  } catch {
    return { authorized: false, statusCode: 503, reason: 'auth-unavailable' };
  }
};

export const verifyRuntimeV2ApiAuth = async (req: NextApiRequest): Promise<boolean> => {
  const result = await authorizeRuntimeV2ApiRequest(req);
  return result.authorized;
};

export const verifyRuntimeV2WebSocketAuth = async (request: IncomingMessage): Promise<boolean> => {
  if (hasForbiddenQueryCredential(request.url)) return false;

  const cliToken = readCliTokenHeader(request.headers);
  if (typeof cliToken === 'string' && verifyTokenValue(cliToken)) return true;

  return !!(await verifySessionCookies(request.headers.cookie, verifySessionToken));
};

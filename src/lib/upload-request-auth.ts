import type { IncomingMessage } from 'http';
import {
  LEGACY_SESSION_COOKIE,
  MAX_AGE,
  readSessionTokenCandidates,
  SESSION_COOKIE,
  verifySessionCookies,
  verifySessionToken as verifySessionJwt,
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

export interface IUploadRequestAuthorizationInput {
  headers: IncomingMessage['headers'];
  rawHeaders: IncomingMessage['rawHeaders'];
}

interface IUploadSessionPayload {
  exp?: unknown;
}

export interface IUploadRequestAuthDependencies {
  verifyCliToken: (value: string) => boolean;
  verifySessionToken: (value: string) => Promise<IUploadSessionPayload | null>;
  hasSessionSecret: () => boolean;
  nowEpochSeconds: () => number;
}

export type TUploadCredentialKind = { kind: 'cli' } | { kind: 'session' };

export type TUploadRequestAuthorization =
  | { authorized: true; credential: { kind: 'cli' }; refreshSession: false }
  | {
      authorized: true;
      credential: { kind: 'session'; expiresAtEpochSeconds: number };
      refreshSession: boolean;
    }
  | {
      authorized: false;
      statusCode: 400 | 401 | 503;
      reason: 'invalid-upload-request' | 'invalid-credential' | 'auth-unavailable';
    };

export type TUploadOriginResult =
  | { valid: true; secure: boolean }
  | { valid: false; statusCode: 403; reason: 'origin-forbidden' };

const defaultDependencies: IUploadRequestAuthDependencies = {
  verifyCliToken: verifyTokenValue,
  verifySessionToken: verifySessionJwt,
  hasSessionSecret: () => {
    const secret = process.env.NEXTAUTH_SECRET;
    return typeof secret === 'string' && secret.trim().length > 0;
  },
  nowEpochSeconds: () => Math.floor(Date.now() / 1000),
};

const getRawHeaderValues = (
  input: Pick<IUploadRequestAuthorizationInput, 'rawHeaders'>,
  name: string,
): string[] => {
  const values: string[] = [];
  for (let index = 0; index < input.rawHeaders.length; index += 2) {
    if (input.rawHeaders[index]?.toLowerCase() === name) {
      values.push(input.rawHeaders[index + 1] ?? '');
    }
  }
  return values;
};

const countCookiePairs = (header: string, name: string): number => {
  let count = 0;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf('=');
    if (separator !== -1 && trimmed.slice(0, separator) === name) count += 1;
  }
  return count;
};

const invalidUploadRequest = (): TUploadRequestAuthorization => ({
  authorized: false,
  statusCode: 400,
  reason: 'invalid-upload-request',
});

const invalidCredential = (): TUploadRequestAuthorization => ({
  authorized: false,
  statusCode: 401,
  reason: 'invalid-credential',
});

const authUnavailable = (): TUploadRequestAuthorization => ({
  authorized: false,
  statusCode: 503,
  reason: 'auth-unavailable',
});

export const authorizeUploadRequest = async (
  input: IUploadRequestAuthorizationInput,
  dependencies: Partial<IUploadRequestAuthDependencies> = {},
): Promise<TUploadRequestAuthorization> => {
  const cliTokens = getRawHeaderValues(input, CLI_TOKEN_HEADER);
  const legacyCliTokens = getRawHeaderValues(input, LEGACY_CLI_TOKEN_HEADER);
  const cookies = getRawHeaderValues(input, 'cookie');
  if (cliTokens.length > 1 || legacyCliTokens.length > 1 || cookies.length > 1) {
    return invalidUploadRequest();
  }

  const cookieHeader = cookies[0] ?? '';
  if (
    countCookiePairs(cookieHeader, SESSION_COOKIE) > 1 ||
    countCookiePairs(cookieHeader, LEGACY_SESSION_COOKIE) > 1
  ) {
    return invalidUploadRequest();
  }

  const deps = { ...defaultDependencies, ...dependencies };
  try {
    const cliToken = readCliTokenHeader(input.headers) ?? cliTokens[0] ?? legacyCliTokens[0];
    if (cliToken !== undefined && deps.verifyCliToken(cliToken)) {
      return {
        authorized: true,
        credential: { kind: 'cli' },
        refreshSession: false,
      };
    }

    const sessionCandidates = readSessionTokenCandidates(cookieHeader);
    if (sessionCandidates.length === 0) return invalidCredential();
    if (!deps.hasSessionSecret()) return authUnavailable();

    const payload = await verifySessionCookies(cookieHeader, deps.verifySessionToken);
    if (!payload || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      return invalidCredential();
    }

    const now = deps.nowEpochSeconds();
    if (!Number.isFinite(now)) return authUnavailable();
    if (payload.exp <= now) return invalidCredential();

    return {
      authorized: true,
      credential: {
        kind: 'session',
        expiresAtEpochSeconds: payload.exp,
      },
      refreshSession: payload.exp - now < MAX_AGE / 2,
    };
  } catch {
    return authUnavailable();
  }
};

const originForbidden = (): TUploadOriginResult => ({
  valid: false,
  statusCode: 403,
  reason: 'origin-forbidden',
});

export const validateUploadRequestOrigin = (
  input: IUploadRequestAuthorizationInput,
  credential: TUploadCredentialKind,
): TUploadOriginResult => {
  const host = validateSingleRequestHost(input);
  if (!host.valid) return originForbidden();

  const origins = getRawHeaderValues(input, 'origin');
  if (credential.kind === 'cli' && origins.length === 0) {
    return { valid: true, secure: false };
  }
  if (origins.length !== 1) return originForbidden();

  const authority = validateBrowserRequestAuthority(input, {
    requireLoopbackHost: false,
  });
  if (!authority.valid) return originForbidden();
  return { valid: true, secure: authority.protocol === 'https:' };
};

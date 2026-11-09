import type { IncomingMessage } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_AGE } from '@/lib/auth';
import {
  authorizeUploadRequest,
  validateUploadRequestOrigin,
  type IUploadRequestAuthDependencies,
} from '@/lib/upload-request-auth';

const NOW_EPOCH_SECONDS = 2_000_000_000;

interface IRequestOptions {
  host?: string | null;
  additionalHosts?: string[];
  origins?: string[];
  cliTokens?: string[];
  legacyCliTokens?: string[];
  cookies?: string[];
}

const request = ({
  host = 'localhost:8122',
  additionalHosts = [],
  origins = [],
  cliTokens = [],
  legacyCliTokens = [],
  cookies = [],
}: IRequestOptions = {}): Pick<IncomingMessage, 'headers' | 'rawHeaders'> => {
  const rawHeaders: string[] = [];
  const headers: IncomingMessage['headers'] = {};

  if (host !== null) {
    rawHeaders.push('Host', host);
    headers.host = host;
  }
  for (const additionalHost of additionalHosts) rawHeaders.push('Host', additionalHost);

  for (const origin of origins) rawHeaders.push('Origin', origin);
  if (origins.length === 1) headers.origin = origins[0];

  for (const token of cliTokens) rawHeaders.push('x-agentmux-token', token);
  if (cliTokens.length === 1) headers['x-agentmux-token'] = cliTokens[0];

  for (const token of legacyCliTokens) rawHeaders.push('x-cmux-token', token);
  if (legacyCliTokens.length === 1) headers['x-cmux-token'] = legacyCliTokens[0];

  for (const cookie of cookies) rawHeaders.push('Cookie', cookie);
  if (cookies.length === 1) headers.cookie = cookies[0];

  return { headers, rawHeaders };
};

const dependencies = (): IUploadRequestAuthDependencies => ({
  verifyCliToken: vi.fn((value) => value === 'valid-cli'),
  verifySessionToken: vi.fn(async (value) => {
    if (value !== 'valid-session') return null;
    return { exp: NOW_EPOCH_SECONDS + MAX_AGE };
  }),
  hasSessionSecret: vi.fn(() => true),
  nowEpochSeconds: vi.fn(() => NOW_EPOCH_SECONDS),
});

describe('upload request authorization', () => {
  let deps: IUploadRequestAuthDependencies;
  let previousSecret: string | undefined;

  beforeEach(() => {
    deps = dependencies();
    previousSecret = process.env.NEXTAUTH_SECRET;
  });

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = previousSecret;
  });

  it.each([
    request({ cookies: ['codexmux-session-token=valid-session', 'theme=dark'], cliTokens: ['valid-cli'] }),
    request({ cliTokens: ['invalid-cli', 'valid-cli'], cookies: ['codexmux-session-token=valid-session'] }),
    request({ legacyCliTokens: ['invalid-cli', 'valid-cli'], cookies: ['codexmux-session-token=valid-session'] }),
    request({ cookies: ['agentmux-session-token=one; agentmux-session-token=two'], cliTokens: ['valid-cli'] }),
    request({ cookies: ['codexmux-session-token=one; codexmux-session-token=two'], cliTokens: ['valid-cli'] }),
  ])('rejects structurally ambiguous credentials before verification', async (input) => {
    await expect(authorizeUploadRequest(input, deps)).resolves.toEqual({
      authorized: false,
      statusCode: 400,
      reason: 'invalid-upload-request',
    });
    expect(deps.verifyCliToken).not.toHaveBeenCalled();
    expect(deps.verifySessionToken).not.toHaveBeenCalled();
  });

  it('prefers x-agentmux-token over x-cmux-token and falls back from invalid new cookie to valid legacy cookie', async () => {
    await expect(authorizeUploadRequest(request({
      cliTokens: ['valid-cli'],
      legacyCliTokens: ['invalid-cli'],
    }), deps)).resolves.toEqual({
      authorized: true,
      credential: { kind: 'cli' },
      refreshSession: false,
    });
    expect(deps.verifyCliToken).toHaveBeenCalledWith('valid-cli');

    await expect(authorizeUploadRequest(request({
      cookies: ['agentmux-session-token=invalid-session; codexmux-session-token=valid-session'],
    }), deps)).resolves.toEqual({
      authorized: true,
      credential: {
        kind: 'session',
        expiresAtEpochSeconds: NOW_EPOCH_SECONDS + MAX_AGE,
      },
      refreshSession: false,
    });
    expect(deps.verifySessionToken).toHaveBeenNthCalledWith(1, 'invalid-session');
    expect(deps.verifySessionToken).toHaveBeenNthCalledWith(2, 'valid-session');
  });

  it('rejects missing and invalid credentials', async () => {
    await expect(authorizeUploadRequest(request(), deps)).resolves.toEqual({
      authorized: false,
      statusCode: 401,
      reason: 'invalid-credential',
    });

    await expect(authorizeUploadRequest(request({
      cliTokens: ['invalid-cli'],
      cookies: ['codexmux-session-token=invalid-session'],
    }), deps)).resolves.toEqual({
      authorized: false,
      statusCode: 401,
      reason: 'invalid-credential',
    });
  });

  it('accepts CLI credentials first and short-circuits a valid session', async () => {
    await expect(authorizeUploadRequest(request({
      cliTokens: ['valid-cli'],
      cookies: ['codexmux-session-token=valid-session'],
    }), deps)).resolves.toEqual({
      authorized: true,
      credential: { kind: 'cli' },
      refreshSession: false,
    });
    expect(deps.verifyCliToken).toHaveBeenCalledWith('valid-cli');
    expect(deps.verifySessionToken).not.toHaveBeenCalled();
    expect(deps.hasSessionSecret).not.toHaveBeenCalled();
  });

  it('falls back from an invalid CLI credential to a valid session', async () => {
    await expect(authorizeUploadRequest(request({
      cliTokens: ['invalid-cli'],
      cookies: ['session-token=purple-session; codexmux-session-token=valid-session'],
    }), deps)).resolves.toEqual({
      authorized: true,
      credential: {
        kind: 'session',
        expiresAtEpochSeconds: NOW_EPOCH_SECONDS + MAX_AGE,
      },
      refreshSession: false,
    });
    expect(deps.verifyCliToken).toHaveBeenCalledWith('invalid-cli');
    expect(deps.verifySessionToken).toHaveBeenCalledWith('valid-session');
  });

  it('requests rolling refresh only below half of the session lifetime', async () => {
    vi.mocked(deps.verifySessionToken)
      .mockResolvedValueOnce({ exp: NOW_EPOCH_SECONDS + MAX_AGE / 2 })
      .mockResolvedValueOnce({ exp: NOW_EPOCH_SECONDS + MAX_AGE / 2 - 1 });
    const input = request({ cookies: ['codexmux-session-token=valid-session'] });

    await expect(authorizeUploadRequest(input, deps)).resolves.toMatchObject({
      authorized: true,
      refreshSession: false,
    });
    await expect(authorizeUploadRequest(input, deps)).resolves.toMatchObject({
      authorized: true,
      refreshSession: true,
    });
  });

  it.each([
    null,
    {},
    { exp: 'future' },
    { exp: NOW_EPOCH_SECONDS },
    { exp: NOW_EPOCH_SECONDS - 1 },
  ])('rejects missing, malformed, or expired session expiry %#', async (payload) => {
    vi.mocked(deps.verifySessionToken).mockResolvedValue(
      payload as Awaited<ReturnType<IUploadRequestAuthDependencies['verifySessionToken']>>,
    );

    await expect(authorizeUploadRequest(
      request({ cookies: ['codexmux-session-token=private-session'] }),
      deps,
    )).resolves.toEqual({
      authorized: false,
      statusCode: 401,
      reason: 'invalid-credential',
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'maps invalid clock value %s to auth unavailable',
    async (nowEpochSeconds) => {
      vi.mocked(deps.nowEpochSeconds).mockReturnValue(nowEpochSeconds);

      await expect(authorizeUploadRequest(
        request({ cookies: ['codexmux-session-token=valid-session'] }),
        deps,
      )).resolves.toEqual({
        authorized: false,
        statusCode: 503,
        reason: 'auth-unavailable',
      });
    },
  );

  it('maps injected credential dependency failures to sanitized 503 results', async () => {
    vi.mocked(deps.verifyCliToken).mockImplementationOnce(() => {
      throw new Error('private-cli-token');
    });
    await expect(authorizeUploadRequest(
      request({ cliTokens: ['private-cli-token'] }),
      deps,
    )).resolves.toEqual({
      authorized: false,
      statusCode: 503,
      reason: 'auth-unavailable',
    });

    vi.mocked(deps.hasSessionSecret).mockImplementationOnce(() => {
      throw new Error('private-auth-secret');
    });
    await expect(authorizeUploadRequest(
      request({ cookies: ['codexmux-session-token=private-session'] }),
      deps,
    )).resolves.toEqual({
      authorized: false,
      statusCode: 503,
      reason: 'auth-unavailable',
    });

    vi.mocked(deps.verifySessionToken).mockRejectedValueOnce(new Error('private-session'));
    await expect(authorizeUploadRequest(
      request({ cookies: ['codexmux-session-token=private-session'] }),
      deps,
    )).resolves.toEqual({
      authorized: false,
      statusCode: 503,
      reason: 'auth-unavailable',
    });
  });

  it('requires explicit default session runtime state before JWT verification', async () => {
    delete process.env.NEXTAUTH_SECRET;
    const input = request({ cookies: ['codexmux-session-token=malformed-private-token'] });

    await expect(authorizeUploadRequest(input)).resolves.toEqual({
      authorized: false,
      statusCode: 503,
      reason: 'auth-unavailable',
    });

    process.env.NEXTAUTH_SECRET = 'runtime-secret';
    await expect(authorizeUploadRequest(input)).resolves.toEqual({
      authorized: false,
      statusCode: 401,
      reason: 'invalid-credential',
    });
  });

  it('does not expose credential values in authorization results', async () => {
    const result = await authorizeUploadRequest(request({
      cliTokens: ['private-cli-token'],
      cookies: ['codexmux-session-token=private-session-token'],
    }), deps);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('private-cli-token');
    expect(serialized).not.toContain('private-session-token');
  });
});

describe('upload request Origin policy', () => {
  it('requires same-authority Origin for session credentials', () => {
    expect(validateUploadRequestOrigin(request(), { kind: 'session' })).toEqual({
      valid: false,
      statusCode: 403,
      reason: 'origin-forbidden',
    });
    expect(validateUploadRequestOrigin(request({
      origins: ['http://localhost:8122'],
    }), { kind: 'session' })).toEqual({ valid: true, secure: false });
    expect(validateUploadRequestOrigin(request({
      host: 'example.test:443',
      origins: ['https://example.test'],
    }), { kind: 'session' })).toEqual({ valid: true, secure: true });
    expect(validateUploadRequestOrigin(request({
      origins: ['http://localhost:9000'],
    }), { kind: 'session' })).toEqual({
      valid: false,
      statusCode: 403,
      reason: 'origin-forbidden',
    });
  });

  it('allows CLI credentials without Origin and validates Origin when present', () => {
    expect(validateUploadRequestOrigin(request(), { kind: 'cli' })).toEqual({
      valid: true,
      secure: false,
    });
    expect(validateUploadRequestOrigin(request({
      host: 'example.test:443',
      origins: ['https://example.test'],
    }), { kind: 'cli' })).toEqual({ valid: true, secure: true });
    expect(validateUploadRequestOrigin(request({
      origins: ['http://other.test:8122'],
    }), { kind: 'cli' })).toEqual({
      valid: false,
      statusCode: 403,
      reason: 'origin-forbidden',
    });
    expect(validateUploadRequestOrigin(request({
      origins: ['http://localhost:8122', 'http://localhost:8122'],
    }), { kind: 'cli' })).toEqual({
      valid: false,
      statusCode: 403,
      reason: 'origin-forbidden',
    });
  });

  it.each([
    request({ host: null }),
    request({ additionalHosts: ['localhost:8122'] }),
    request({ host: 'localhost:8122/path' }),
  ])('rejects invalid Host even when CLI Origin is absent', (input) => {
    expect(validateUploadRequestOrigin(input, { kind: 'cli' })).toEqual({
      valid: false,
      statusCode: 403,
      reason: 'origin-forbidden',
    });
  });
});

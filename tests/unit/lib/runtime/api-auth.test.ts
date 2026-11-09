import type { IncomingMessage } from 'http';
import type { NextApiRequest } from 'next';
import { describe, expect, it, vi } from 'vitest';
import {
  authorizeRuntimeV2ApiRequest,
  verifyRuntimeV2ApiAuth,
  verifyRuntimeV2WebSocketAuth,
} from '@/lib/runtime/api-auth';

vi.mock('@/lib/cli-token', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cli-token')>();
  return {
    ...actual,
    verifyTokenValue: vi.fn((value: string) => value === 'valid-cli-token'),
  };
});

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return {
    ...actual,
    verifySessionToken: vi.fn(async (value: string) => value === 'valid-session-token' ? { sub: 'user' } : null),
  };
});

const req = (headers: Record<string, string>, url = '/api/v2/runtime/health'): NextApiRequest =>
  ({ headers, url } as NextApiRequest);
const wsReq = (headers: Record<string, string>, url = '/api/v2/terminal?session=rtv2-a'): IncomingMessage =>
  ({ headers, url } as IncomingMessage);

describe('runtime v2 api auth', () => {
  it('accepts x-agentmux-token and legacy x-cmux-token, preferring x-agentmux-token', async () => {
    await expect(verifyRuntimeV2ApiAuth(req({ 'x-agentmux-token': 'valid-cli-token' }))).resolves.toBe(true);
    await expect(verifyRuntimeV2ApiAuth(req({ 'x-cmux-token': 'valid-cli-token' }))).resolves.toBe(true);
    await expect(verifyRuntimeV2ApiAuth(req({
      'x-agentmux-token': 'valid-cli-token',
      'x-cmux-token': 'invalid-cli-token',
    }))).resolves.toBe(true);
  });

  it('accepts new and legacy session cookies, falling back when new cookie is invalid', async () => {
    await expect(verifyRuntimeV2ApiAuth(req({
      cookie: 'session-token=purple-session; agentmux-session-token=valid-session-token',
    }))).resolves.toBe(true);
    await expect(verifyRuntimeV2ApiAuth(req({
      cookie: 'session-token=purple-session; codexmux-session-token=valid-session-token',
    }))).resolves.toBe(true);
    await expect(verifyRuntimeV2ApiAuth(req({
      cookie: 'agentmux-session-token=invalid-session; codexmux-session-token=valid-session-token',
    }))).resolves.toBe(true);
  });

  it('rejects missing credentials', async () => {
    await expect(verifyRuntimeV2ApiAuth(req({}))).resolves.toBe(false);
  });

  it('rejects credential query parameters before header or cookie auth', async () => {
    const forbiddenNames = [
      'token',
      'x-agentmux-token',
      'x-cmux-token',
      'authorization',
      'auth',
      'api_key',
      'apikey',
      'access_token',
      'agentmux-session-token',
      'codexmux-session-token',
      'session-token',
      'ToKeN',
    ];

    for (const name of forbiddenNames) {
      await expect(verifyRuntimeV2ApiAuth(req(
        { 'x-agentmux-token': 'valid-cli-token', cookie: 'agentmux-session-token=valid-session-token' },
        `/api/v2/runtime/health?${name}=valid-cli-token`,
      ))).resolves.toBe(false);
    }
  });

  it('fails closed for malformed request URLs', async () => {
    await expect(verifyRuntimeV2ApiAuth(req(
      { 'x-cmux-token': 'valid-cli-token', cookie: 'codexmux-session-token=valid-session-token' },
      'http://[::1',
    ))).resolves.toBe(false);
  });

  it('requires one Host and a same-authority Origin for cookie mutations', async () => {
    const mutation = (rawHeaders: string[]) => ({
      headers: { cookie: 'codexmux-session-token=valid-session-token' },
      rawHeaders,
      url: '/api/sessions/rebuild',
    }) as NextApiRequest;

    await expect(authorizeRuntimeV2ApiRequest(mutation([
      'Host', 'localhost:8122',
      'Origin', 'http://localhost:8122',
      'Cookie', 'codexmux-session-token=valid-session-token',
    ]), { mutation: true })).resolves.toMatchObject({
      authorized: true,
      credential: { kind: 'session' },
    });
    await expect(authorizeRuntimeV2ApiRequest(mutation([
      'Host', 'localhost:8122',
      'Cookie', 'codexmux-session-token=valid-session-token',
    ]), { mutation: true })).resolves.toEqual({
      authorized: false,
      statusCode: 403,
      reason: 'origin-forbidden',
    });
    await expect(authorizeRuntimeV2ApiRequest(mutation([
      'Host', 'localhost:8122',
      'HOST', 'localhost:8122',
      'Origin', 'http://localhost:8122',
      'Cookie', 'codexmux-session-token=valid-session-token',
    ]), { mutation: true })).resolves.toEqual({
      authorized: false,
      statusCode: 403,
      reason: 'origin-forbidden',
    });
  });

  it('allows CLI mutations without Origin but validates Host and rejects query credentials', async () => {
    const cliRequest = {
      headers: { 'x-cmux-token': 'valid-cli-token' },
      rawHeaders: ['Host', 'localhost:8122', 'x-cmux-token', 'valid-cli-token'],
      url: '/api/sessions/rebuild',
    } as unknown as NextApiRequest;

    await expect(authorizeRuntimeV2ApiRequest(cliRequest, { mutation: true })).resolves.toEqual({
      authorized: true,
      credential: { kind: 'cli' },
    });
    await expect(authorizeRuntimeV2ApiRequest({
      ...cliRequest,
      url: '/api/sessions/rebuild?token=valid-cli-token',
    } as NextApiRequest, { mutation: true })).resolves.toEqual({
      authorized: false,
      statusCode: 401,
      reason: 'invalid-credential',
    });
  });
});

describe('runtime v2 websocket auth', () => {
  it('accepts session cookie for browser websocket clients', async () => {
    await expect(verifyRuntimeV2WebSocketAuth(wsReq({
      cookie: 'session-token=purple-session; agentmux-session-token=valid-session-token',
    }))).resolves.toBe(true);
    await expect(verifyRuntimeV2WebSocketAuth(wsReq({
      cookie: 'session-token=purple-session; codexmux-session-token=valid-session-token',
    }))).resolves.toBe(true);
    await expect(verifyRuntimeV2WebSocketAuth(wsReq({
      cookie: 'agentmux-session-token=invalid-session; codexmux-session-token=valid-session-token',
    }))).resolves.toBe(true);
  });

  it('accepts x-agentmux-token and x-cmux-token for node smoke websocket clients', async () => {
    await expect(verifyRuntimeV2WebSocketAuth(wsReq({ 'x-agentmux-token': 'valid-cli-token' }))).resolves.toBe(true);
    await expect(verifyRuntimeV2WebSocketAuth(wsReq({ 'x-cmux-token': 'valid-cli-token' }))).resolves.toBe(true);
  });

  it('rejects credential query parameters but allows the terminal session query', async () => {
    await expect(verifyRuntimeV2WebSocketAuth(wsReq(
      { cookie: 'codexmux-session-token=valid-session-token' },
      '/api/v2/terminal?session=rtv2-a',
    ))).resolves.toBe(true);

    for (const name of [
      'token',
      'x-agentmux-token',
      'x-cmux-token',
      'authorization',
      'API_KEY',
      'access_token',
      'agentmux-session-token',
      'codexmux-session-token',
      'session-token',
    ]) {
      await expect(verifyRuntimeV2WebSocketAuth(wsReq(
        { cookie: 'codexmux-session-token=valid-session-token' },
        `/api/v2/terminal?session=rtv2-a&${name}=valid-cli-token`,
      ))).resolves.toBe(false);
    }
  });

  it('fails closed for malformed websocket request URLs', async () => {
    await expect(verifyRuntimeV2WebSocketAuth(wsReq(
      { 'x-cmux-token': 'valid-cli-token', cookie: 'codexmux-session-token=valid-session-token' },
      'http://[::1',
    ))).resolves.toBe(false);
  });
});

import { SignJWT } from 'jose';
import type { NextApiRequest, NextApiResponse } from 'next';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildClearCookieHeaders,
  buildCookieHeader,
  clearCookieHeader,
  extractCookie,
  LEGACY_SESSION_COOKIE,
  readSessionTokenCandidates,
  SESSION_COOKIE,
  signSessionToken,
  verifyRequestSession,
  verifySessionCookies,
} from '@/lib/auth';
import logoutHandler from '@/pages/api/auth/logout';
import { proxy } from '@/proxy';

describe('auth cookie namespace and compatibility', () => {
  const originalSecret = process.env.NEXTAUTH_SECRET;

  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = 'test-auth-secret-0123456789abcdef';
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = originalSecret;
  });

  it('uses agentmux-session-token as primary cookie and preserves codexmux-session-token as legacy', () => {
    expect(SESSION_COOKIE).toBe('agentmux-session-token');
    expect(LEGACY_SESSION_COOKIE).toBe('codexmux-session-token');

    const header = `session-token=purple-token; ${LEGACY_SESSION_COOKIE}=legacy-token; ${SESSION_COOKIE}=agent-token`;
    expect(extractCookie(header, SESSION_COOKIE)).toBe('agent-token');
    expect(extractCookie(header, LEGACY_SESSION_COOKIE)).toBe('legacy-token');
    expect(extractCookie('session-token=purple-token', SESSION_COOKIE)).toBeUndefined();

    expect(buildCookieHeader('agent-token', false)).toBe(
      `${SESSION_COOKIE}=agent-token; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`,
    );
    expect(buildCookieHeader('agent-token', true)).toContain('; Secure');
    expect(clearCookieHeader()).toBe(
      `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    );
  });

  it('reads session token candidates with new name first and skips empty or duplicate values', () => {
    expect(readSessionTokenCandidates(undefined)).toEqual([]);
    expect(readSessionTokenCandidates('session-token=purple-only')).toEqual([]);
    expect(
      readSessionTokenCandidates(`${LEGACY_SESSION_COOKIE}=legacy-tok; ${SESSION_COOKIE}=new-tok`),
    ).toEqual(['new-tok', 'legacy-tok']);
    expect(
      readSessionTokenCandidates(`${SESSION_COOKIE}=same-tok; ${LEGACY_SESSION_COOKIE}=same-tok`),
    ).toEqual(['same-tok']);
    expect(
      readSessionTokenCandidates(`${SESSION_COOKIE}=; ${LEGACY_SESSION_COOKIE}=legacy-tok`),
    ).toEqual(['legacy-tok']);
  });

  it('verifies legacy cookie when new cookie is signed with a different secret (Review Focus 1)', async () => {
    const validLegacyToken = await signSessionToken();
    const wrongSecretToken = await new SignJWT({ sub: 'forged' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(new TextEncoder().encode('different-secret-key'));

    const cookieHeader = `${SESSION_COOKIE}=${wrongSecretToken}; ${LEGACY_SESSION_COOKIE}=${validLegacyToken}`;
    const payload = await verifySessionCookies(cookieHeader);

    expect(payload).toMatchObject({ sub: 'user' });
    await expect(verifyRequestSession(cookieHeader)).resolves.toBe(true);
  });

  it('rejects requests that only have Purplemux session-token (ADR-029)', async () => {
    const validJwt = await signSessionToken();
    const cookieHeader = `session-token=${validJwt}`;

    await expect(verifySessionCookies(cookieHeader)).resolves.toBeNull();
    await expect(verifyRequestSession(cookieHeader)).resolves.toBe(false);
  });

  it('clears both agentmux and codexmux cookies on logout', () => {
    const insecureHeaders = buildClearCookieHeaders(false);
    expect(insecureHeaders).toEqual([
      `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
      `${LEGACY_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    ]);

    const secureHeaders = buildClearCookieHeaders(true);
    expect(secureHeaders).toEqual([
      `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure`,
      `${LEGACY_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure`,
    ]);

    const setHeader = vi.fn();
    const res = {
      setHeader,
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as NextApiResponse;
    logoutHandler({ headers: {} } as NextApiRequest, res);

    expect(setHeader).toHaveBeenCalledWith('Set-Cookie', insecureHeaders);
  });

  it('migrates legacy-only cookie in proxy by issuing agentmux-session-token without deleting legacy cookie', async () => {
    const legacyToken = await signSessionToken();
    const request = new NextRequest('http://localhost:8122/stats', {
      headers: {
        cookie: `${LEGACY_SESSION_COOKIE}=${legacyToken}`,
      },
    });

    const response = await proxy(request);
    expect(response.status).toBe(200);

    const setCookie = response.headers.get('Set-Cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toMatch(new RegExp(`^${SESSION_COOKIE}=[^;]+;`));
    expect(setCookie).not.toContain(LEGACY_SESSION_COOKIE);
    expect(setCookie).not.toContain('Max-Age=0');
  });
});

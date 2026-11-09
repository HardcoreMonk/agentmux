import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

export const SESSION_COOKIE = 'agentmux-session-token';
export const LEGACY_SESSION_COOKIE = 'codexmux-session-token';
export const MAX_AGE = 7 * 86400;

const getSecret = () => new TextEncoder().encode(process.env.NEXTAUTH_SECRET);

export const signSessionToken = async () =>
  new SignJWT({ sub: 'user' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(getSecret());

export const verifySessionToken = async (token: string) => {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload;
  } catch {
    return null;
  }
};

export const buildCookieHeader = (token: string, secure: boolean) => {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Path=/`,
    `Max-Age=${MAX_AGE}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
};

const formatClearCookieHeader = (name: string, secure: boolean) => {
  const parts = [
    `${name}=`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Path=/`,
    `Max-Age=0`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
};

export const buildClearCookieHeaders = (secure = false): string[] => [
  formatClearCookieHeader(SESSION_COOKIE, secure),
  formatClearCookieHeader(LEGACY_SESSION_COOKIE, secure),
];

export const clearCookieHeader = (secure = false) =>
  formatClearCookieHeader(SESSION_COOKIE, secure);

export const isSecureRequest = (req: { headers: Record<string, string | string[] | undefined> }) => {
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string') return proto === 'https';
  return false;
};

export const extractCookie = (header: string, name: string): string | undefined => {
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq !== -1 && trimmed.slice(0, eq) === name) {
      return trimmed.slice(eq + 1);
    }
  }
  return undefined;
};

const extractNamedCookieValues = (header: string | undefined, name: string): string[] => {
  if (!header) return [];
  const values: string[] = [];
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq !== -1 && trimmed.slice(0, eq) === name) {
      const value = trimmed.slice(eq + 1).trim();
      if (value) values.push(value);
    }
  }
  return values;
};

export const readSessionTokenCandidates = (cookieHeader: string | undefined): string[] => {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const name of [SESSION_COOKIE, LEGACY_SESSION_COOKIE]) {
    for (const value of extractNamedCookieValues(cookieHeader, name)) {
      if (!seen.has(value)) {
        seen.add(value);
        candidates.push(value);
      }
    }
  }
  return candidates;
};

export const verifySessionCookies = async <TPayload = JWTPayload>(
  cookieHeader: string | undefined,
  verify: (token: string) => Promise<TPayload | null> = verifySessionToken as unknown as (
    token: string,
  ) => Promise<TPayload | null>,
): Promise<TPayload | null> => {
  for (const candidate of readSessionTokenCandidates(cookieHeader)) {
    const payload = await verify(candidate);
    if (payload) return payload;
  }
  return null;
};

export const verifyRequestSession = async (cookieHeader: string | undefined): Promise<boolean> => {
  return !!(await verifySessionCookies(cookieHeader));
};

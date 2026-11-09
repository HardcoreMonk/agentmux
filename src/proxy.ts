import { NextRequest, NextResponse } from 'next/server';
import {
  verifySessionToken,
  signSessionToken,
  buildCookieHeader,
  readSessionTokenCandidates,
  SESSION_COOKIE,
  MAX_AGE,
} from '@/lib/auth';
import { readCliTokenHeader, verifyTokenValue } from '@/lib/cli-token';

export const proxy = async (request: NextRequest) => {
  const cliToken = readCliTokenHeader(request.headers);
  if (cliToken && verifyTokenValue(cliToken)) {
    return NextResponse.next();
  }

  const cookieHeader = request.headers.get('cookie') ?? undefined;
  const candidates = readSessionTokenCandidates(cookieHeader);
  const primaryToken = request.cookies.get(SESSION_COOKIE)?.value;
  let verifiedToken: string | null = null;
  let payload: Awaited<ReturnType<typeof verifySessionToken>> = null;
  for (const candidate of candidates) {
    const candidatePayload = await verifySessionToken(candidate);
    if (candidatePayload) {
      verifiedToken = candidate;
      payload = candidatePayload;
      break;
    }
  }
  if (!payload || !verifiedToken) {
    if (request.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const response = NextResponse.next();

  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  const remaining = exp - Math.floor(Date.now() / 1000);
  const authenticatedViaLegacy = verifiedToken !== primaryToken;
  const shouldRefresh = remaining > 0 && remaining < MAX_AGE / 2;
  if (authenticatedViaLegacy || shouldRefresh) {
    const secure = request.nextUrl.protocol === 'https:';
    const fresh = await signSessionToken();
    response.headers.set('Set-Cookie', buildCookieHeader(fresh, secure));
  }

  return response;
};

export const config = {
  matcher: [
    '/((?!login|__nextjs_original-stack-frames|api/auth|api/cli/|api/status/hook|api/health|api/manifest|_next|favicon\\.ico|sw\\.js|fonts|.*\\.(?:svg|png|ico|jpg|jpeg|webp|webmanifest|ttf|woff|woff2)).*)',
  ],
};

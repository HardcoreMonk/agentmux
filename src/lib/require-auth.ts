import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';
import {
  LEGACY_SESSION_COOKIE,
  SESSION_COOKIE,
  verifySessionCookies,
  verifySessionToken,
} from '@/lib/auth';
import { getCachedRuntimePreflight } from '@/lib/preflight';
import { isRuntimeOk } from '@/types/preflight';

interface IRequireAuthOptions {
  skipPreflight?: boolean;
}

export const requireAuth = async <T extends Record<string, unknown>>(
  context: GetServerSidePropsContext,
  handler?: () => Promise<GetServerSidePropsResult<T>>,
  options?: IRequireAuthOptions,
): Promise<GetServerSidePropsResult<T>> => {
  const fallbackCookieHeader = [
    context.req.cookies?.[SESSION_COOKIE]
      ? `${SESSION_COOKIE}=${context.req.cookies[SESSION_COOKIE]}`
      : '',
    context.req.cookies?.[LEGACY_SESSION_COOKIE]
      ? `${LEGACY_SESSION_COOKIE}=${context.req.cookies[LEGACY_SESSION_COOKIE]}`
      : '',
  ].filter(Boolean).join('; ');
  const cookieHeader = context.req.headers?.cookie ?? (fallbackCookieHeader || undefined);
  if (!(await verifySessionCookies(cookieHeader, verifySessionToken))) {
    return { redirect: { destination: '/login', permanent: false } };
  }

  if (!options?.skipPreflight) {
    const runtime = await getCachedRuntimePreflight();
    if (!isRuntimeOk(runtime)) {
      const from = context.resolvedUrl || '/';
      return { redirect: { destination: `/tools-required?from=${encodeURIComponent(from)}`, permanent: false } };
    }
  }

  const result = handler ? await handler() : ({ props: {} } as GetServerSidePropsResult<T>);

  if ('props' in result && result.props && !(result.props instanceof Promise)) {
    (result.props as Record<string, unknown>).isElectron = /Electron/i.test(context.req.headers['user-agent'] ?? '');
  }

  return result;
};

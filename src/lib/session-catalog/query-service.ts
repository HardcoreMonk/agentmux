import { Buffer } from 'node:buffer';
import {
  sessionIdSchema,
  sessionCatalogSearchInputSchema,
  type ISessionCatalogSearchInput,
  type ISessionSearchPage,
} from '@/lib/session-catalog/contracts';
import type { TSessionCatalogRepository } from '@/lib/session-catalog/index-repository';

const queryError = (code: 'catalog-query-invalid' | 'catalog-query-too-complex'): Error =>
  Object.assign(new Error('Session catalog query is not supported.'), { code });

export const buildFtsMatchExpression = (query: string): string => {
  const normalized = query.trim().replace(/\s+/g, ' ');
  if (!normalized) return '';
  if (normalized.length > 256 || /[\u0000-\u001f\u007f"'*:^(){}]/u.test(normalized)) {
    throw queryError('catalog-query-invalid');
  }
  const terms = normalized.split(' ');
  if (terms.length > 20 || terms.some((term) => term.length > 64)) {
    throw queryError('catalog-query-too-complex');
  }
  if (terms.some((term) => /^(?:AND|OR|NOT|NEAR)$/i.test(term))) {
    throw queryError('catalog-query-invalid');
  }
  return terms.map((term) => `"${term}"`).join(' AND ');
};

interface ISessionCatalogCursor {
  v: 1;
  lastActivityAt: string;
  sessionId: string;
}

const encodeCursor = (cursor: ISessionCatalogCursor): string =>
  Buffer.from(JSON.stringify(cursor)).toString('base64url');

const decodeCursor = (cursor: string): ISessionCatalogCursor => {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<ISessionCatalogCursor>;
    if (
      parsed.v !== 1
      || typeof parsed.lastActivityAt !== 'string'
      || !Number.isFinite(new Date(parsed.lastActivityAt).getTime())
      || !sessionIdSchema.safeParse(parsed.sessionId).success
    ) {
      throw new Error('invalid');
    }
    return {
      v: 1,
      lastActivityAt: new Date(parsed.lastActivityAt).toISOString(),
      sessionId: parsed.sessionId as string,
    };
  } catch {
    throw Object.assign(new Error('Session catalog cursor is invalid.'), {
      code: 'catalog-cursor-invalid',
    });
  }
};

export const createSessionCatalogQueryService = (repository: TSessionCatalogRepository) => ({
  search: (rawQuery: ISessionCatalogSearchInput): ISessionSearchPage => {
    const query = sessionCatalogSearchInputSchema.parse(rawQuery);
    const limit = query.limit ?? 50;
    const match = buildFtsMatchExpression(query.query);
    const after = query.cursor ? decodeCursor(query.cursor) : undefined;
    const repositoryInput = {
      ...(match ? { match } : {}),
      ...(query.providers ? { providers: query.providers } : {}),
      ...(query.projects ? { projects: query.projects } : {}),
      ...(query.models ? { models: query.models } : {}),
      ...(query.dateFrom ? { dateFrom: query.dateFrom } : {}),
      ...(query.dateTo ? { dateTo: query.dateTo } : {}),
      ...(query.annotationSelection ? { annotationSelection: query.annotationSelection } : {}),
      ...(after ? { after } : {}),
      limit: limit + 1,
    };
    const rows = repository.search(repositoryInput);
    const hasMore = rows.length > limit;
    const results = rows.slice(0, limit);
    const last = results.at(-1);

    return {
      results,
      nextCursor: hasMore && last
        ? encodeCursor({
          v: 1,
          lastActivityAt: last.entry.lastActivityAt,
          sessionId: last.entry.sessionId,
        })
        : null,
      total: repository.countSearch({ ...repositoryInput, after: undefined, limit }),
      health: 'ready',
    };
  },
});

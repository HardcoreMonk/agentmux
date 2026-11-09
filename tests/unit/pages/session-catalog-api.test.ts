import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const supervisor = {
    ensureStarted: vi.fn(),
    getSessionCatalogHealth: vi.fn(),
    searchSessionCatalog: vi.fn(),
    readSessionCatalogEntries: vi.fn(),
    rebuildSessionCatalog: vi.fn(),
    updateSessionAnnotation: vi.fn(),
    listSavedSessionFilters: vi.fn(),
    upsertSavedSessionFilter: vi.fn(),
    deleteSavedSessionFilter: vi.fn(),
  };
  return {
    auth: vi.fn(),
    getRuntimeSupervisor: vi.fn(() => supervisor),
    supervisor,
  };
});

vi.mock('@/lib/runtime/api-auth', () => ({
  authorizeRuntimeV2ApiRequest: mocks.auth,
}));

vi.mock('@/lib/runtime/supervisor', () => ({
  getRuntimeSupervisor: mocks.getRuntimeSupervisor,
}));

import searchHandler from '@/pages/api/sessions/search';
import healthHandler from '@/pages/api/sessions/health';
import rebuildHandler from '@/pages/api/sessions/rebuild';
import savedFiltersHandler from '@/pages/api/sessions/saved-filters';
import annotationHandler from '@/pages/api/sessions/[sessionId]/annotation';
import entriesHandler from '@/pages/api/sessions/[sessionId]/entries';

const createResponse = () => {
  let statusCode = 0;
  let body: unknown;
  const headers: Record<string, number | string | string[]> = {};
  const response = {
    setHeader: vi.fn((name: string, value: number | string | string[]) => {
      headers[name] = value;
      return response;
    }),
    status: vi.fn((code: number) => {
      statusCode = code;
      return response;
    }),
    json: vi.fn((value: unknown) => {
      body = value;
      return response;
    }),
  } as unknown as NextApiResponse;
  return {
    response,
    headers,
    get statusCode() { return statusCode; },
    get body() { return body; },
  };
};

const createRequest = ({
  method = 'GET',
  query = {},
  body,
  url = '/api/sessions/search',
}: {
  method?: string;
  query?: Record<string, string | string[]>;
  body?: unknown;
  url?: string;
} = {}): NextApiRequest => ({
  method,
  query,
  body,
  url,
  headers: {},
  rawHeaders: ['Host', 'localhost:8122'],
}) as unknown as NextApiRequest;

describe('session catalog API', () => {
  beforeEach(() => {
    process.env.AGENTMUX_RUNTIME_V2 = '1';
    mocks.auth.mockReset().mockResolvedValue({ authorized: true, credential: { kind: 'session' } });
    mocks.getRuntimeSupervisor.mockClear();
    Object.values(mocks.supervisor).forEach((mock) => mock.mockReset());
    mocks.supervisor.ensureStarted.mockResolvedValue(undefined);
    mocks.supervisor.getSessionCatalogHealth.mockResolvedValue({
      state: 'ready',
      queueLag: 0,
      cursorAgeMs: 100,
      rebuildState: 'idle',
      indexedSessions: 4,
      lastIndexedAt: '2026-08-21T09:00:00.000Z',
    });
    mocks.supervisor.searchSessionCatalog.mockResolvedValue({
      results: [], nextCursor: null, total: 0, health: 'ready',
    });
    mocks.supervisor.readSessionCatalogEntries.mockResolvedValue({ entries: [], startByteOffset: 0, hasMore: false });
    mocks.supervisor.rebuildSessionCatalog.mockResolvedValue({ started: true, state: 'building' });
    mocks.supervisor.updateSessionAnnotation.mockResolvedValue({
      sessionId: 'session-1', pinned: true, tags: ['review'], version: 2, updatedAt: '2026-08-21T09:00:00.000Z',
    });
    mocks.supervisor.listSavedSessionFilters.mockResolvedValue([]);
    mocks.supervisor.upsertSavedSessionFilter.mockImplementation(async (filter) => filter);
    mocks.supervisor.deleteSavedSessionFilter.mockResolvedValue({ deleted: true });
  });

  it('parses bounded search filters and uses the Supervisor facade', async () => {
    const result = createResponse();
    await searchHandler(createRequest({ query: {
      query: 'worker status',
      models: ['gpt-5', 'gpt-5.1'],
      projects: 'codexmux',
      tags: ['review'],
      pinned: 'true',
      dateFrom: '2026-08-01T00:00:00.000Z',
      limit: '25',
    } }), result.response);

    expect(result.statusCode).toBe(200);
    expect(mocks.supervisor.searchSessionCatalog).toHaveBeenCalledWith({
      query: 'worker status',
      models: ['gpt-5', 'gpt-5.1'],
      projects: ['codexmux'],
      tags: ['review'],
      pinned: true,
      dateFrom: '2026-08-01T00:00:00.000Z',
      limit: 25,
    });
  });

  it('returns the Supervisor filtered page metadata without recomputing it', async () => {
    mocks.supervisor.searchSessionCatalog.mockResolvedValueOnce({
      results: [{
        entry: {
          sessionId: 'session-1', projectLabel: 'codexmux',
          startedAt: '2026-08-21T08:00:00.000Z', lastActivityAt: '2026-08-21T08:01:00.000Z',
          turnCount: 1, indexedAt: '2026-08-21T09:00:00.000Z',
        },
        snippet: 'worker',
        annotation: {
          sessionId: 'session-1', pinned: true, tags: ['review'], version: 1,
          updatedAt: '2026-08-21T09:00:00.000Z',
        },
      }],
      nextCursor: 'eyJmaWx0ZXJlZCI6dHJ1ZX0',
      total: 1,
      health: 'ready',
    });
    const result = createResponse();

    await searchHandler(createRequest({ query: { query: 'worker', pinned: 'true' } }), result.response);

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      results: [{ entry: { sessionId: 'session-1' }, annotation: { pinned: true } }],
      nextCursor: 'eyJmaWx0ZXJlZCI6dHJ1ZX0',
      total: 1,
    });
  });

  it('serves health and session-id based rich timeline entries', async () => {
    const health = createResponse();
    await healthHandler(createRequest({ url: '/api/sessions/health' }), health.response);
    expect(health.statusCode).toBe(200);
    expect(health.body).toMatchObject({ state: 'ready', indexedSessions: 4 });

    const entries = createResponse();
    await entriesHandler(createRequest({
      query: { sessionId: 'session-1', beforeByte: '900', limit: '100' },
      url: '/api/sessions/session-1/entries',
    }), entries.response);
    expect(entries.statusCode).toBe(200);
    expect(mocks.supervisor.readSessionCatalogEntries).toHaveBeenCalledWith({
      sessionId: 'session-1', beforeByte: 900, limit: 100, panelType: 'codex',
    });
  });

  it('updates annotations and rebuilds only through authenticated mutation routes', async () => {
    const annotation = createResponse();
    await annotationHandler(createRequest({
      method: 'PUT',
      query: { sessionId: 'session-1' },
      body: { pinned: true, tags: ['review'], expectedVersion: 1 },
      url: '/api/sessions/session-1/annotation',
    }), annotation.response);
    expect(annotation.statusCode).toBe(200);
    expect(mocks.auth).toHaveBeenCalledWith(expect.anything(), { mutation: true });
    expect(mocks.supervisor.updateSessionAnnotation).toHaveBeenCalledWith({
      sessionId: 'session-1', pinned: true, tags: ['review'], expectedVersion: 1,
    });

    const rebuild = createResponse();
    await rebuildHandler(createRequest({ method: 'POST', url: '/api/sessions/rebuild' }), rebuild.response);
    expect(rebuild.statusCode).toBe(202);
    expect(rebuild.body).toEqual({ started: true, state: 'building' });
  });

  it('lists, upserts, and deletes saved filters with server-owned timestamps', async () => {
    const list = createResponse();
    await savedFiltersHandler(createRequest({ url: '/api/sessions/saved-filters' }), list.response);
    expect(list.statusCode).toBe(200);
    expect(list.body).toEqual({ filters: [] });

    const upsert = createResponse();
    await savedFiltersHandler(createRequest({
      method: 'PUT',
      body: { id: 'recent-review', name: 'Recent review', query: { query: 'review', limit: 25 } },
      url: '/api/sessions/saved-filters',
    }), upsert.response);
    expect(upsert.statusCode).toBe(200);
    expect(mocks.supervisor.upsertSavedSessionFilter).toHaveBeenCalledWith(expect.objectContaining({
      id: 'recent-review', name: 'Recent review', query: { query: 'review', limit: 25 },
    }));
    const saved = mocks.supervisor.upsertSavedSessionFilter.mock.calls[0][0];
    expect(new Date(saved.createdAt).toISOString()).toBe(saved.createdAt);
    expect(saved.updatedAt).toBe(saved.createdAt);

    const remove = createResponse();
    await savedFiltersHandler(createRequest({
      method: 'DELETE', query: { id: 'recent-review' }, url: '/api/sessions/saved-filters?id=recent-review',
    }), remove.response);
    expect(remove.statusCode).toBe(200);
    expect(mocks.supervisor.deleteSavedSessionFilter).toHaveBeenCalledWith('recent-review');
  });

  it('returns stable auth, validation, conflict, not-found, and degraded statuses', async () => {
    mocks.auth.mockResolvedValueOnce({ authorized: false, statusCode: 403, reason: 'origin-forbidden' });
    const forbidden = createResponse();
    await rebuildHandler(createRequest({ method: 'POST', url: '/api/sessions/rebuild' }), forbidden.response);
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.body).toEqual({ error: 'origin-forbidden' });

    const invalid = createResponse();
    await searchHandler(createRequest({ query: { query: 'x', limit: '1000', unknown: 'value' } }), invalid.response);
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).toMatchObject({ error: 'invalid-runtime-v2-request' });

    mocks.supervisor.updateSessionAnnotation.mockRejectedValueOnce(Object.assign(new Error('conflict'), {
      code: 'session-annotation-version-conflict', retryable: false,
    }));
    const conflict = createResponse();
    await annotationHandler(createRequest({
      method: 'PUT', query: { sessionId: 'session-1' },
      body: { pinned: true, tags: [], expectedVersion: 0 },
    }), conflict.response);
    expect(conflict.statusCode).toBe(409);

    mocks.supervisor.readSessionCatalogEntries.mockRejectedValueOnce(Object.assign(new Error('missing'), {
      code: 'catalog-session-not-found', retryable: false,
    }));
    const missing = createResponse();
    await entriesHandler(createRequest({ query: { sessionId: 'session-1' } }), missing.response);
    expect(missing.statusCode).toBe(404);

    mocks.supervisor.searchSessionCatalog.mockRejectedValueOnce(Object.assign(new Error('degraded'), {
      code: 'catalog-unavailable', retryable: true,
    }));
    const degraded = createResponse();
    await searchHandler(createRequest({ query: { query: '' } }), degraded.response);
    expect(degraded.statusCode).toBe(503);

    mocks.supervisor.searchSessionCatalog.mockRejectedValueOnce(Object.assign(
      new Error('Session annotations changed during the filtered search.'),
      { code: 'session-annotation-search-conflict', retryable: true },
    ));
    const annotationConflict = createResponse();
    await searchHandler(createRequest({ query: { query: '', pinned: 'true' } }), annotationConflict.response);
    expect(annotationConflict.statusCode).toBe(503);
    expect(annotationConflict.body).toEqual({
      error: 'session-annotation-search-conflict',
      message: 'Session annotations changed during the filtered search.',
      retryable: true,
    });
    expect(JSON.stringify(annotationConflict.body)).not.toContain('session-1');
  });
});

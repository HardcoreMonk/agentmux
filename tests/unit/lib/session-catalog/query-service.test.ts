import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectCodexJsonl } from '@/lib/session-catalog/jsonl-projector';
import { createSessionCatalogRepository } from '@/lib/session-catalog/index-repository';
import { buildFtsMatchExpression, createSessionCatalogQueryService } from '@/lib/session-catalog/query-service';
import { openSessionCatalogDatabase, type TSessionCatalogDatabase } from '@/lib/session-catalog/schema';

const projection = (id: string, message: string, timestamp: string) => projectCodexJsonl([
  JSON.stringify({ type: 'session_meta', timestamp, payload: { id, cwd: `<fixture-root>/${id}` } }),
  JSON.stringify({ type: 'response_item', timestamp, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: message }] } }),
].join('\n'), { indexedAt: '2026-08-21T09:00:00.000Z' });

describe('session catalog query service', () => {
  let dir: string;
  let db: TSessionCatalogDatabase;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-catalog-query-'));
    db = openSessionCatalogDatabase(path.join(dir, 'index.db'));
  });

  afterEach(async () => {
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('builds a bounded literal FTS expression', () => {
    expect(buildFtsMatchExpression('worker health')).toBe('"worker" AND "health"');
    for (const query of ['worker*', '"worker"', 'worker OR health', 'bad\u0000query']) {
      expect(() => buildFtsMatchExpression(query)).toThrow(expect.objectContaining({ code: 'catalog-query-invalid' }));
    }
    expect(() => buildFtsMatchExpression(Array.from({ length: 21 }, (_, index) => `t${index}`).join(' ')))
      .toThrow(expect.objectContaining({ code: 'catalog-query-too-complex' }));
  });

  it('returns stable opaque cursor pages with a maximum page size', () => {
    const repository = createSessionCatalogRepository(db);
    repository.replaceProjection(projection('session-a', 'shared result', '2026-08-21T08:00:00.000Z'));
    repository.replaceProjection(projection('session-b', 'shared result', '2026-08-21T08:01:00.000Z'));
    repository.replaceProjection(projection('session-c', 'shared result', '2026-08-21T08:02:00.000Z'));
    const service = createSessionCatalogQueryService(repository);

    const first = service.search({ query: 'shared', limit: 2 });
    const second = service.search({ query: 'shared', limit: 2, cursor: first.nextCursor ?? undefined });

    expect(first.results.map((result) => result.entry.sessionId)).toEqual(['session-c', 'session-b']);
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(second.results.map((result) => result.entry.sessionId)).toEqual(['session-a']);
    expect(second.nextCursor).toBeNull();
  });

  it('fails closed for forged cursors', () => {
    const service = createSessionCatalogQueryService(createSessionCatalogRepository(db));

    expect(() => service.search({ query: 'shared', cursor: 'Zm9yZ2Vk' }))
      .toThrow(expect.objectContaining({ code: 'catalog-cursor-invalid' }));
  });

  it('paginates and counts with the same annotation selection', () => {
    const repository = createSessionCatalogRepository(db);
    for (const [index, sessionId] of ['session-a', 'session-b', 'session-c', 'session-d'].entries()) {
      repository.replaceProjection(projection(sessionId, 'shared result', `2026-08-21T08:0${index}:00.000Z`));
    }
    const service = createSessionCatalogQueryService(repository);
    const annotationSelection = {
      mode: 'include' as const,
      sessionIds: ['session-a', 'session-c', 'session-d'],
    };

    const first = service.search({ query: 'shared', limit: 2, annotationSelection });
    const second = service.search({
      query: 'shared', limit: 2, annotationSelection, cursor: first.nextCursor ?? undefined,
    });

    expect(first.results.map((result) => result.entry.sessionId)).toEqual(['session-d', 'session-c']);
    expect(first.total).toBe(3);
    expect(first.nextCursor).not.toBeNull();
    expect(second.results.map((result) => result.entry.sessionId)).toEqual(['session-a']);
    expect(second.total).toBe(3);
    expect(second.nextCursor).toBeNull();
  });

  it('keeps catalog health semantics for an empty include selection', () => {
    const repository = createSessionCatalogRepository(db);
    repository.replaceProjection(projection('session-a', 'shared result', '2026-08-21T08:00:00.000Z'));
    const service = createSessionCatalogQueryService(repository);

    expect(service.search({
      query: 'shared',
      annotationSelection: { mode: 'include', sessionIds: [] },
    })).toEqual({ results: [], nextCursor: null, total: 0, health: 'ready' });
  });

  it('filters search results by provider', () => {
    const repository = createSessionCatalogRepository(db);
    repository.replaceProjection(projection('session-codex', 'shared provider text', '2026-08-21T08:00:00.000Z'));
    const claude = projection('session-claude', 'shared provider text', '2026-08-21T08:01:00.000Z');
    repository.replaceProjection({
      ...claude,
      entry: claude.entry ? { ...claude.entry, provider: 'claude' } : null,
    });
    const service = createSessionCatalogQueryService(repository);

    expect(service.search({ query: 'shared', providers: ['claude'] }).results.map((r) => r.entry.sessionId))
      .toEqual(['session-claude']);
    expect(service.search({ query: 'shared' }).results.map((r) => r.entry.provider).sort())
      .toEqual(['claude', 'codex']);
    expect(service.search({ query: '', providers: ['codex'] }).total).toBe(1);
  });
});

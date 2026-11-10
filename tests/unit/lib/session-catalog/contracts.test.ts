import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cursorSchema,
  savedSessionFilterSchema,
  sessionAnnotationSchema,
  sessionCatalogEntrySchema,
  sessionIdSchema,
  sessionSearchPageSchema,
  sessionSearchQuerySchema,
  sessionTagSchema,
} from '@/lib/session-catalog/contracts';

const entry = {
  sessionId: 'session-123',
  provider: 'codex',
  projectLabel: 'codexmux',
  model: 'gpt-5.6',
  startedAt: '2026-08-21T08:00:00.000Z',
  lastActivityAt: '2026-08-21T08:05:00.000Z',
  turnCount: 4,
  indexedAt: '2026-08-21T08:05:01.000Z',
};

describe('session catalog contracts', () => {
  it('accepts bounded session identities, tags and opaque cursors', () => {
    expect(sessionIdSchema.parse('session:abc-123')).toBe('session:abc-123');
    expect(sessionTagSchema.parse('검토-필요')).toBe('검토-필요');
    expect(cursorSchema.parse('eyJvZmZzZXQiOjUwfQ')).toBe('eyJvZmZzZXQiOjUwfQ');
  });

  it('rejects malformed or oversized session identifiers', () => {
    expect(sessionIdSchema.safeParse('../session').success).toBe(false);
    expect(sessionIdSchema.safeParse('a'.repeat(161)).success).toBe(false);
    expect(sessionTagSchema.safeParse('bad/tag').success).toBe(false);
    expect(cursorSchema.safeParse('opaque cursor').success).toBe(false);
  });

  it('validates catalog entries without source paths or raw payloads', () => {
    expect(sessionCatalogEntrySchema.parse(entry)).toEqual(entry);

    for (const prohibited of ['jsonlPath', 'rawToolPayload', 'reasoning', 'terminalBytes']) {
      expect(sessionCatalogEntrySchema.safeParse({ ...entry, [prohibited]: 'secret' }).success).toBe(false);
    }
  });

  it('accepts a provider filter and rejects unknown providers', () => {
    expect(sessionSearchQuerySchema.parse({ query: 'x', providers: ['claude'] })).toEqual({ query: 'x', providers: ['claude'] });
    expect(sessionSearchQuerySchema.safeParse({ query: 'x', providers: ['gemini'] }).success).toBe(false);
    expect(sessionCatalogEntrySchema.safeParse({ ...entry, provider: 'gemini' }).success).toBe(false);
    expect(savedSessionFilterSchema.parse({
      id: 'filter-1',
      name: 'Claude only',
      query: { query: '', providers: ['claude'] },
      createdAt: '2026-08-21T08:00:00.000Z',
      updatedAt: '2026-08-21T08:00:00.000Z',
    }).query.providers).toEqual(['claude']);
  });

  it('validates bounded search queries and result pages', () => {
    const query = {
      query: 'worker health',
      models: ['gpt-5.6'],
      projects: ['codexmux'],
      tags: ['검토-필요'],
      pinned: true,
      limit: 50,
    };
    expect(sessionSearchQuerySchema.parse(query)).toEqual(query);
    expect(sessionSearchQuerySchema.safeParse({ query: 'x', limit: 201 }).success).toBe(false);
    expect(sessionSearchPageSchema.parse({
      results: [{ entry, snippet: 'worker health is degraded' }],
      nextCursor: null,
      total: 1,
      health: 'ready',
    })).toMatchObject({ total: 1, health: 'ready' });
  });

  it('validates annotation and saved-filter app state', () => {
    expect(sessionAnnotationSchema.parse({
      sessionId: 'session-123',
      pinned: true,
      tags: ['검토-필요'],
      version: 2,
      updatedAt: '2026-08-21T08:06:00.000Z',
    })).toMatchObject({ pinned: true, version: 2 });
    expect(savedSessionFilterSchema.parse({
      id: 'filter-1',
      name: '최근 검토',
      query: { query: 'review', limit: 50 },
      createdAt: '2026-08-21T08:00:00.000Z',
      updatedAt: '2026-08-21T08:00:00.000Z',
    })).toMatchObject({ id: 'filter-1' });
  });

  it('keeps catalog fixtures synthetic and credential-free', () => {
    const fixtureRoot = resolve(process.cwd(), 'tests/fixtures/session-catalog');
    for (const name of ['session-basic.jsonl', 'session-tool-agent.jsonl', 'session-sensitive-large.jsonl']) {
      const content = readFileSync(resolve(fixtureRoot, name), 'utf8');
      expect(content).not.toMatch(/\/home\//);
      expect(content).not.toMatch(/sk-[A-Za-z0-9_-]{12,}/);
      expect(content.trim().split('\n').every((line) => {
        JSON.parse(line);
        return true;
      })).toBe(true);
    }
  });
});

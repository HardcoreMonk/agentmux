import { describe, expect, it } from 'vitest';
import { parseRuntimeCommandPayload, parseRuntimeReplyPayload, runtimeCommandRegistry } from '@/lib/runtime/ipc';

describe('session catalog IPC', () => {
  it('registers catalog commands on the timeline worker boundary', () => {
    expect(Object.keys(runtimeCommandRegistry)).toEqual(expect.arrayContaining([
      'timeline.catalog-health',
      'timeline.catalog-search',
      'timeline.catalog-read-entries',
      'timeline.catalog-rebuild',
      'storage.list-session-annotations',
      'storage.select-session-annotations',
      'storage.update-session-annotation',
      'storage.list-saved-session-filters',
      'storage.upsert-saved-session-filter',
      'storage.delete-saved-session-filter',
    ]));
  });

  it('registers bounded governed scaffold commands', () => {
    expect(Object.keys(runtimeCommandRegistry)).toEqual(expect.arrayContaining([
      'governance.preview-scaffold',
      'governance.confirm-scaffold',
      'governance.list-actions',
      'governance.preview-action-rollback',
      'governance.confirm-action-rollback',
    ]));
    expect(() => parseRuntimeCommandPayload('governance.preview-scaffold', {
      projectId: 'project-1',
      artifacts: ['context'],
      input: { title: 'Demo', summary: 'Summary', uiProject: false },
      path: '../../outside',
    })).toThrow(/Invalid runtime IPC payload/);
    expect(parseRuntimeCommandPayload('governance.preview-scaffold', {
      projectId: 'project-1',
      artifacts: ['agents'],
      input: { title: 'Demo', summary: 'Summary', uiProject: false },
    })).toMatchObject({ adoptArtifacts: [] });
    expect(parseRuntimeCommandPayload('governance.preview-scaffold', {
      projectId: 'project-1',
      artifacts: ['agents'],
      adoptArtifacts: ['agents'],
      input: { title: 'Demo', summary: 'Summary', uiProject: false },
    })).toMatchObject({ adoptArtifacts: ['agents'] });
    expect(() => parseRuntimeCommandPayload('governance.preview-scaffold', {
      projectId: 'project-1',
      artifacts: ['agents'],
      adoptArtifacts: ['context'],
      input: { title: 'Demo', summary: 'Summary', uiProject: false },
    })).toThrow(/Invalid runtime IPC payload/);
  });

  it('validates annotation and saved-filter storage payloads', () => {
    expect(parseRuntimeCommandPayload('storage.update-session-annotation', {
      sessionId: 'session-1',
      pinned: true,
      tags: ['review'],
      expectedVersion: 0,
      sessionExists: true,
    })).toMatchObject({ sessionId: 'session-1', expectedVersion: 0 });
    expect(() => parseRuntimeCommandPayload('storage.update-session-annotation', {
      sessionId: 'session-1',
      pinned: true,
      tags: ['bad/tag'],
      expectedVersion: 0,
      sessionExists: true,
    })).toThrow(/Invalid runtime IPC payload/);
    expect(parseRuntimeCommandPayload('storage.select-session-annotations', {
      pinned: false,
      tags: ['review'],
    })).toEqual({ pinned: false, tags: ['review'] });
    expect(() => parseRuntimeCommandPayload('storage.select-session-annotations', {}))
      .toThrow(/Invalid runtime IPC payload/);
  });

  it('validates bounded search and session-id payloads', () => {
    expect(parseRuntimeCommandPayload('timeline.catalog-search', { query: 'worker', limit: 50 }))
      .toEqual({ query: 'worker', limit: 50 });
    expect(parseRuntimeCommandPayload('timeline.catalog-search', {
      query: 'worker',
      limit: 50,
      annotationSelection: { mode: 'include', sessionIds: ['session-1'] },
    })).toEqual({
      query: 'worker',
      limit: 50,
      annotationSelection: { mode: 'include', sessionIds: ['session-1'] },
    });
    expect(() => parseRuntimeCommandPayload('timeline.catalog-search', {
      query: 'worker',
      annotationSelection: { mode: 'include', sessionIds: ['session-1', 'session-1'] },
    })).toThrow(/Invalid runtime IPC payload/);
    expect(() => parseRuntimeCommandPayload('timeline.catalog-search', { query: 'worker', limit: 201 }))
      .toThrow(/Invalid runtime IPC payload/);
    // panelType is optional and ignored: the catalog replays with the stored provider.
    expect(parseRuntimeCommandPayload('timeline.catalog-read-entries', {
      sessionId: 'session-1',
      beforeByte: 100,
      limit: 50,
    })).toEqual({ sessionId: 'session-1', beforeByte: 100, limit: 50 });
    expect(parseRuntimeCommandPayload('timeline.catalog-read-entries', {
      sessionId: 'session-1',
      beforeByte: 100,
      limit: 50,
      panelType: 'claude',
    })).toMatchObject({ sessionId: 'session-1', panelType: 'claude' });
    expect(() => parseRuntimeCommandPayload('timeline.catalog-read-entries', {
      sessionId: '../session',
      beforeByte: 100,
      limit: 50,
      panelType: 'codex',
    })).toThrow(/Invalid runtime IPC payload/);
  });

  it('rejects source paths in catalog replies', () => {
    const page = {
      results: [],
      nextCursor: null,
      total: 0,
      health: 'ready',
    };
    expect(parseRuntimeReplyPayload('timeline.catalog-search', page)).toEqual(page);
    expect(() => parseRuntimeReplyPayload('timeline.catalog-search', {
      ...page,
      jsonlPath: '<fixture-root>/session.jsonl',
    })).toThrow(/Invalid runtime IPC reply/);
  });
});

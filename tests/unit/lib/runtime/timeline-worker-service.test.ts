import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { codexProvider } from '@/lib/providers/codex';
import type { IAgentProvider } from '@/lib/providers';
import { createRuntimeCommand } from '@/lib/runtime/ipc';
import type { IRuntimeEvent } from '@/lib/runtime/ipc';
import { createTimelineWorkerService } from '@/lib/runtime/timeline/worker-service';
import type { ISessionInfo } from '@/types/timeline';

let tempDir: string;
let jsonlPath: string;

const command = (type: string, payload: unknown = {}) => createRuntimeCommand({
  id: `cmd-${type}`,
  source: 'supervisor',
  target: 'timeline',
  type,
  payload,
});

const line = (value: unknown): string => JSON.stringify(value);

const waitFor = async <T>(fn: () => T | null | undefined | false, timeoutMs = 1500): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = fn();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('condition timed out');
};

describe('timeline worker service', () => {
  beforeEach(async () => {
    const sessionsRoot = path.join(os.homedir(), '.codex', 'sessions');
    await fs.mkdir(sessionsRoot, { recursive: true });
    tempDir = await fs.mkdtemp(path.join(sessionsRoot, 'codexmux-runtime-v2-timeline-'));
    jsonlPath = path.join(tempDir, 'session.jsonl');
    await fs.writeFile(jsonlPath, [
      line({
        type: 'event_msg',
        timestamp: '2026-05-03T01:00:00.000Z',
        payload: { type: 'user_message', message: 'First prompt' },
      }),
      line({
        type: 'event_msg',
        timestamp: '2026-05-03T01:00:01.000Z',
        payload: { type: 'agent_message', message: 'First answer' },
      }),
      line({
        type: 'response_item',
        timestamp: '2026-05-03T01:00:02.000Z',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          call_id: 'call-1',
          arguments: JSON.stringify({ cmd: 'git status --short' }),
        },
      }),
    ].join('\n'), 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('handles health checks', async () => {
    const service = createTimelineWorkerService();
    const reply = await service.handleCommand(command('timeline.health'));

    expect(reply.ok).toBe(true);
    expect(reply.source).toBe('timeline');
    expect(reply.target).toBe('supervisor');
    expect(reply.payload).toEqual({ ok: true });
  });

  it('handles catalog commands through an injected worker-owned service', async () => {
    const catalog = {
      health: vi.fn(() => ({
        state: 'ready' as const,
        queueLag: 0,
        cursorAgeMs: 100,
        rebuildState: 'idle' as const,
        indexedSessions: 1,
        lastIndexedAt: '2026-08-21T09:00:00.000Z',
      })),
      search: vi.fn(() => ({ results: [], nextCursor: null, total: 0, health: 'ready' as const })),
      readEntries: vi.fn(async () => ({ entries: [], startByteOffset: 0, hasMore: false })),
      rebuild: vi.fn(async () => ({ started: true, state: 'building' as const })),
      observeFile: vi.fn(async () => undefined),
      close: vi.fn(),
    };
    const service = createTimelineWorkerService({ catalog });

    await expect(service.handleCommand(command('timeline.catalog-health'))).resolves.toMatchObject({
      ok: true,
      payload: { state: 'ready', indexedSessions: 1 },
    });
    await expect(service.handleCommand(command('timeline.catalog-search', { query: 'worker', limit: 50 })))
      .resolves.toMatchObject({ ok: true, payload: { results: [], total: 0 } });
    await expect(service.handleCommand(command('timeline.catalog-search', {
      query: 'worker',
      pinned: true,
      annotationSelection: { mode: 'include', sessionIds: ['session-1'] },
    }))).resolves.toMatchObject({ ok: true, payload: { results: [], total: 0 } });
    await expect(service.handleCommand(command('timeline.catalog-read-entries', {
      sessionId: 'session-1',
      beforeByte: 100,
      limit: 50,
      panelType: 'codex',
    }))).resolves.toMatchObject({ ok: true, payload: { entries: [], hasMore: false } });
    await expect(service.handleCommand(command('timeline.catalog-rebuild')))
      .resolves.toMatchObject({ ok: true, payload: { started: true, state: 'building' } });

    service.close();
    expect(catalog.search).toHaveBeenCalledWith({
      query: 'worker',
      pinned: true,
      annotationSelection: { mode: 'include', sessionIds: ['session-1'] },
    });
    expect(catalog.close).toHaveBeenCalledOnce();
  });

  it('reports catalog degradation without stopping ordinary timeline commands', async () => {
    const catalog = {
      health: vi.fn(() => ({ state: 'degraded' as const, queueLag: 0, cursorAgeMs: null, rebuildState: 'idle' as const, indexedSessions: 0, lastIndexedAt: null })),
      search: vi.fn(() => { throw Object.assign(new Error('catalog unavailable'), { code: 'catalog-unavailable', retryable: true }); }),
      readEntries: vi.fn(),
      rebuild: vi.fn(),
      observeFile: vi.fn(),
      close: vi.fn(),
    };
    const service = createTimelineWorkerService({ catalog });

    const failed = await service.handleCommand(command('timeline.catalog-search', { query: 'worker' }));
    const healthy = await service.handleCommand(command('timeline.health'));

    expect(failed).toMatchObject({ ok: false, error: { code: 'catalog-unavailable', retryable: true } });
    expect(healthy).toMatchObject({ ok: true, payload: { ok: true } });
  });

  it('reads older entries through the selected provider', async () => {
    const service = createTimelineWorkerService();
    const stat = await fs.stat(jsonlPath);

    const reply = await service.handleCommand(command('timeline.read-entries-before', {
      jsonlPath,
      beforeByte: stat.size,
      limit: 2,
      panelType: 'codex',
    }));

    expect(reply.ok).toBe(true);
    expect(reply.payload).toMatchObject({ hasMore: true });
    expect((reply.payload as { startByteOffset: number }).startByteOffset).toBeGreaterThan(0);
    expect((reply.payload as { entries: Array<{ type: string }> }).entries.map((entry) => entry.type))
      .toEqual(['assistant-message', 'tool-call']);
  });

  it('counts messages with worker-owned caching', async () => {
    const service = createTimelineWorkerService();

    const first = await service.handleCommand(command('timeline.message-counts', { jsonlPath }));
    const second = await service.handleCommand(command('timeline.message-counts', { jsonlPath }));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.payload).toEqual({
      userCount: 1,
      assistantCount: 1,
      toolCount: 1,
      toolBreakdown: { exec_command: 1 },
    });
    expect(second.payload).toEqual(first.payload);
  });

  it('rejects forbidden JSONL paths before filesystem reads', async () => {
    const service = createTimelineWorkerService();
    const reply = await service.handleCommand(command('timeline.message-counts', {
      jsonlPath: path.join(os.tmpdir(), 'not-allowed.jsonl'),
    }));

    expect(reply.ok).toBe(false);
    expect(reply.error).toMatchObject({
      code: 'timeline-jsonl-path-forbidden',
      retryable: false,
    });
  });

  it('subscribes to live JSONL appends and emits sanitized append events', async () => {
    const events: IRuntimeEvent[] = [];
    const service = createTimelineWorkerService({ sendEvent: (event) => events.push(event) });

    const reply = await service.handleCommand(command('timeline.live-subscribe', {
      subscriberId: 'tlsub-a',
      jsonlPath,
      sessionName: 'pt-ws-a-pane-b-tab-c',
      sessionId: 'session-a',
      panelType: 'codex',
    }));

    expect(reply.ok).toBe(true);
    const payload = reply.payload as {
      subscriberId: string;
      subscribed: boolean;
      init: {
        type: string;
        sessionId: string;
        totalEntries: number;
        startByteOffset: number;
        hasMore: boolean;
        jsonlPath: string;
        summary?: string;
        meta?: {
          fileSize: number;
          userCount: number;
          assistantCount: number;
        };
      };
    };
    expect(payload.subscriberId).toBe('tlsub-a');
    expect(payload.subscribed).toBe(true);
    expect(payload.init.type).toBe('timeline:init');
    expect(payload.init.sessionId).toBe('session-a');
    expect(payload.init.totalEntries).toBe(3);
    expect(typeof payload.init.startByteOffset).toBe('number');
    expect(payload.init.hasMore).toBe(false);
    expect(payload.init.jsonlPath).toBe(jsonlPath);
    expect(payload.init.summary).toBe('First prompt');
    expect(payload.init.meta).toMatchObject({
      fileSize: expect.any(Number),
      userCount: 1,
      assistantCount: 1,
    });

    await fs.appendFile(jsonlPath, `\n${line({
      type: 'event_msg',
      timestamp: '2026-05-03T01:00:03.000Z',
      payload: { type: 'user_message', message: 'Second prompt' },
    })}\n`, 'utf-8');

    const append = await waitFor(() => events.find((event) => event.type === 'timeline.live-append'));
    expect(append).toMatchObject({
      source: 'timeline',
      target: 'supervisor',
      delivery: 'realtime',
      payload: {
        subscriberId: 'tlsub-a',
        jsonlPath,
        entries: [{ type: 'user-message' }],
      },
    });

    const unsubscribe = await service.handleCommand(command('timeline.live-unsubscribe', {
      subscriberId: 'tlsub-a',
    }));
    expect(unsubscribe.ok).toBe(true);
    expect(unsubscribe.payload).toEqual({ subscriberId: 'tlsub-a', unsubscribed: true });
    service.close();
  });

  it('keeps live appends flowing when the catalog rejects an observed file', async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    const events: IRuntimeEvent[] = [];
    let observeCalls = 0;
    const catalog = {
      health: vi.fn(),
      search: vi.fn(),
      readEntries: vi.fn(),
      rebuild: vi.fn(),
      close: vi.fn(),
      // Plain function on purpose: vi.fn attaches settle handlers to returned
      // promises, which would mark the rejection as handled and hide the bug.
      observeFile: async () => {
        observeCalls++;
        throw Object.assign(new Error('Session Catalog path is outside the Codex sessions root.'), {
          code: 'catalog-path-forbidden',
        });
      },
    };
    const service = createTimelineWorkerService({ sendEvent: (event) => events.push(event), catalog });
    try {
      const reply = await service.handleCommand(command('timeline.live-subscribe', {
        subscriberId: 'tlsub-reject',
        jsonlPath,
        sessionName: 'pt-ws-a-pane-b-tab-c',
        sessionId: 'session-a',
        panelType: 'codex',
      }));
      expect(reply.ok).toBe(true);

      await fs.appendFile(jsonlPath, `\n${line({
        type: 'event_msg',
        timestamp: '2026-05-03T01:00:03.000Z',
        payload: { type: 'user_message', message: 'Second prompt' },
      })}\n`, 'utf-8');

      await waitFor(() => events.find((event) => event.type === 'timeline.live-append'));
      await waitFor(() => observeCalls > 0);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(rejections).toEqual([]);
    } finally {
      service.close();
      process.off('unhandledRejection', onRejection);
    }
  });

  it('subscribes to session watchers and emits subscriber-scoped change events', async () => {
    const events: IRuntimeEvent[] = [];
    const stop = vi.fn();
    const watcherCallbacks: Array<(info: ISessionInfo) => void> = [];
    const watchSessions = vi.fn<IAgentProvider['watchSessions']>((panePid, cb, options) => {
      expect(panePid).toBe(123);
      expect(options).toEqual({ skipInitial: true });
      watcherCallbacks.push(cb);
      return { stop };
    });
    const provider: IAgentProvider = {
      ...codexProvider,
      watchSessions,
    };
    const service = createTimelineWorkerService({
      sendEvent: (event) => events.push(event),
      getProvider: () => provider,
    });

    const subscribe = await service.handleCommand(command('timeline.session-watch-subscribe', {
      subscriberId: 'tlsw-a',
      sessionName: 'pt-ws-a-pane-b-tab-c',
      panePid: 123,
      panelType: 'codex',
      skipInitial: true,
    }));

    expect(subscribe.ok).toBe(true);
    expect(subscribe.payload).toEqual({ subscriberId: 'tlsw-a', subscribed: true });
    expect(watchSessions).toHaveBeenCalledTimes(1);

    const emitChange = watcherCallbacks[0];
    if (!emitChange) throw new Error('session watcher callback was not registered');

    emitChange({
      status: 'running',
      sessionId: '33333333-3333-3333-3333-333333333333',
      jsonlPath,
      pid: 456,
      startedAt: 1,
      cwd: tempDir,
    });

    const changed = await waitFor(() => events.find((event) => event.type === 'timeline.session-changed'));
    expect(changed).toMatchObject({
      source: 'timeline',
      target: 'supervisor',
      delivery: 'realtime',
      payload: {
        subscriberId: 'tlsw-a',
        sessionName: 'pt-ws-a-pane-b-tab-c',
        info: {
          status: 'running',
          sessionId: '33333333-3333-3333-3333-333333333333',
          jsonlPath,
          pid: 456,
          startedAt: 1,
          cwd: tempDir,
        },
      },
    });

    const unsubscribe = await service.handleCommand(command('timeline.session-watch-unsubscribe', {
      subscriberId: 'tlsw-a',
    }));

    expect(unsubscribe.ok).toBe(true);
    expect(unsubscribe.payload).toEqual({ subscriberId: 'tlsw-a', unsubscribed: true });
    expect(stop).toHaveBeenCalledTimes(1);
    service.close();
  });
});

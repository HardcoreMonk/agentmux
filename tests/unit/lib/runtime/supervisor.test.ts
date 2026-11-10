import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeEvent } from '@/lib/runtime/ipc';
import type { IRuntimeEvent } from '@/lib/runtime/ipc';
import { createRuntimeSupervisorForTest, getRuntimeSupervisor } from '@/lib/runtime/supervisor';

class FakeWorker {
  commands: Array<{ type: string; payload: unknown }> = [];
  started = 0;
  ready = 0;
  shutdowns = 0;
  replies = new Map<string, unknown>();
  failures = new Map<string, Error>();
  handlers = new Map<string, (payload: unknown) => unknown | Promise<unknown>>();

  start = (): void => {
    this.started += 1;
  };

  waitUntilReady = async (): Promise<void> => {
    this.ready += 1;
  };

  shutdown = (): void => {
    this.shutdowns += 1;
  };

  request = async <TPayload, TResult>(type: string, payload: TPayload): Promise<TResult> => {
    this.commands.push({ type, payload });
    const failure = this.failures.get(type);
    if (failure) throw failure;
    const handler = this.handlers.get(type);
    if (handler) return await handler(payload) as TResult;
    return this.replies.get(type) as TResult;
  };
}

const createWorkers = () => {
  const storage = new FakeWorker();
  const terminal = new FakeWorker();
  const timeline = new FakeWorker();
  const status = new FakeWorker();
  storage.replies.set('storage.health', { ok: true });
  storage.replies.set('storage.list-pending-terminal-tabs', []);
  storage.replies.set('storage.list-ready-terminal-tabs', []);
  storage.replies.set('storage.list-workspaces', []);
  storage.replies.set('storage.get-ready-terminal-tab-by-session', {
    id: 'tab-a',
    sessionName: 'rtv2-ws-a-pane-b-tab-c',
    name: '',
    order: 0,
    panelType: 'terminal',
    lifecycleState: 'ready',
  });
  storage.replies.set('storage.create-pending-terminal-tab', { id: 'tab-generated', sessionName: 'rtv2-ws-a-pane-b-tab-generated' });
  storage.replies.set('storage.finalize-terminal-tab', {
    id: 'tab-generated',
    sessionName: 'rtv2-ws-a-pane-b-tab-generated',
    name: '',
    order: 0,
    panelType: 'terminal',
    lifecycleState: 'ready',
  });
  storage.replies.set('storage.fail-pending-terminal-tab', { ok: true });
  storage.replies.set('storage.fail-ready-terminal-tab', { ok: true });
  storage.replies.set('storage.delete-terminal-tab', {
    deleted: true,
    session: { sessionName: 'rtv2-ws-a-pane-b-tab-c' },
  });
  storage.replies.set('storage.list-session-annotations', []);
  storage.replies.set('storage.update-session-annotation', {
    sessionId: 'session-1',
    pinned: true,
    tags: ['review'],
    version: 1,
    updatedAt: '2026-08-21T09:00:00.000Z',
  });
  storage.replies.set('storage.list-saved-session-filters', []);
  storage.replies.set('storage.upsert-saved-session-filter', null);
  storage.replies.set('storage.delete-saved-session-filter', { deleted: true });
  terminal.replies.set('terminal.health', { ok: true });
  terminal.replies.set('terminal.create-session', { sessionName: 'rtv2-ws-a-pane-b-tab-generated' });
  terminal.replies.set('terminal.attach', { sessionName: 'rtv2-ws-a-pane-b-tab-c', attached: true });
  terminal.replies.set('terminal.detach', { sessionName: 'rtv2-ws-a-pane-b-tab-c', detached: true });
  terminal.replies.set('terminal.kill-session', { sessionName: 'rtv2-ws-a-pane-b-tab-c', killed: true });
  terminal.replies.set('terminal.has-session', { sessionName: 'rtv2-ws-a-pane-b-tab-c', exists: true });
  terminal.replies.set('terminal.write-stdin', { written: 4 });
  terminal.replies.set('terminal.resize', { sessionName: 'rtv2-ws-a-pane-b-tab-c', cols: 80, rows: 24 });
  timeline.replies.set('timeline.health', { ok: true });
  timeline.replies.set('timeline.list-sessions', { sessions: [], total: 0, hasMore: false });
  timeline.replies.set('timeline.read-entries-before', { entries: [], startByteOffset: 0, hasMore: false });
  timeline.replies.set('timeline.message-counts', { userCount: 0, assistantCount: 0, toolCount: 0, toolBreakdown: {} });
  timeline.replies.set('timeline.catalog-health', {
    state: 'ready',
    queueLag: 0,
    cursorAgeMs: 100,
    rebuildState: 'idle',
    indexedSessions: 1,
    lastIndexedAt: '2026-08-21T09:00:00.000Z',
  });
  timeline.replies.set('timeline.catalog-search', { results: [], nextCursor: null, total: 0, health: 'ready' });
  timeline.replies.set('timeline.catalog-read-entries', { entries: [], startByteOffset: 0, hasMore: false });
  timeline.replies.set('timeline.catalog-rebuild', { started: true, state: 'building' });
  status.replies.set('status.health', { ok: true });
  status.replies.set('status.live-start', { started: true });
  status.replies.set('status.live-stop', { stopped: true });
  status.replies.set('status.live-request-sync', { tabs: {}, rateLimits: {} });
  status.replies.set('status.live-hook-event', { accepted: true });
  status.replies.set('status.live-client-event', { accepted: true });
  status.replies.set('status.live-notify-last-user-message', { accepted: true });
  status.replies.set('status.live-register-tab', { accepted: true });
  status.replies.set('status.live-device-visibility', { accepted: true });
  status.replies.set('status.live-remove-tab', { accepted: true });
  status.replies.set('status.live-poll', { polled: true });
  status.replies.set('status.reduce-hook-state', { nextState: 'busy', changed: false, deferStopHook: true });
  status.replies.set('status.reduce-codex-state', { nextState: 'ready-for-review', changed: true, silent: false, skipHistory: false });
  status.replies.set('status.evaluate-notification-policy', {
    processHookEvent: true,
    sendReviewNotification: false,
    sendNeedsInputNotification: true,
  });
  status.replies.set('status.evaluate-side-effects', {
    clearDismissedAt: false,
    setReadyForReviewAt: true,
    setBusySince: false,
    saveSessionHistory: true,
    sendReviewNotification: true,
    sendNeedsInputNotification: false,
    startJsonlWatch: false,
    stopJsonlWatch: false,
  });
  status.replies.set('status.evaluate-client-event', {
    accepted: true,
    nextState: 'busy',
    setDismissedAt: false,
    persistLayout: true,
    broadcastUpdate: true,
    updateSessionHistoryDismissedAt: false,
  });
  status.replies.set('status.add-session-history-entry', {
    added: true,
    entry: {
      id: 'history-a',
      workspaceId: 'ws-a',
      workspaceName: 'Workspace',
      workspaceDir: null,
      tabId: 'tab-a',
      agentSessionId: 'agent-a',
      prompt: 'prompt',
      result: 'result',
      startedAt: 1,
      completedAt: 2,
      duration: 1,
      dismissedAt: null,
      toolUsage: {},
      touchedFiles: [],
    },
  });
  status.replies.set('status.update-session-history-dismissed-at', {
    updated: true,
    entry: {
      id: 'history-a',
      workspaceId: 'ws-a',
      workspaceName: 'Workspace',
      workspaceDir: null,
      tabId: 'tab-a',
      agentSessionId: 'agent-a',
      prompt: 'prompt',
      result: 'result',
      startedAt: 1,
      completedAt: 2,
      duration: 1,
      dismissedAt: 3,
      toolUsage: {},
      touchedFiles: [],
    },
  });
  status.replies.set('status.send-web-push', {
    skippedVisible: false,
    attempted: 1,
    sent: 1,
    removed: 0,
    failed: 0,
  });
  return { storage, terminal, timeline, status };
};

describe('runtime supervisor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { __ptRuntimeSupervisor?: unknown }).__ptRuntimeSupervisor;
    delete (globalThis as unknown as { __ptRuntimeSupervisorStartPromise?: unknown }).__ptRuntimeSupervisorStartPromise;
    delete (globalThis as unknown as { __ptRuntimeSupervisorPreparedDbPath?: unknown }).__ptRuntimeSupervisorPreparedDbPath;
  });

  it('starts runtime workers once and health waits for every worker health command', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });

    await Promise.all([supervisor.ensureStarted(), supervisor.ensureStarted()]);
    await expect(supervisor.health()).resolves.toEqual({
      ok: true,
      storage: { ok: true },
      terminal: { ok: true },
      timeline: { ok: true },
      status: { ok: true },
      governance: { state: 'degraded', writeState: 'degraded', indexedProjects: 0, lastIndexedAt: null },
    });

    expect(storage.started).toBe(1);
    expect(terminal.started).toBe(1);
    expect(timeline.started).toBe(1);
    expect(status.started).toBe(1);
    expect(storage.ready).toBe(1);
    expect(terminal.ready).toBe(1);
    expect(timeline.ready).toBe(1);
    expect(status.ready).toBe(1);
    expect(storage.commands.map((command) => command.type)).toContain('storage.health');
    expect(terminal.commands.map((command) => command.type)).toContain('terminal.health');
    expect(timeline.commands.map((command) => command.type)).toContain('timeline.health');
    expect(status.commands.map((command) => command.type)).toContain('status.health');
  });

  it('proxies timeline read commands through the timeline worker', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });

    await expect(supervisor.listTimelineSessions({
      tmuxSession: 'pt-ws-pane-tab',
      cwd: '/repo',
      panelType: 'codex',
      offset: 10,
      limit: 20,
    })).resolves.toEqual({ sessions: [], total: 0, hasMore: false });
    await expect(supervisor.readTimelineEntriesBefore({
      jsonlPath: `${os.homedir()}/.codex/sessions/session.jsonl`,
      beforeByte: 128,
      limit: 25,
      panelType: 'codex',
    })).resolves.toEqual({ entries: [], startByteOffset: 0, hasMore: false });
    await expect(supervisor.getTimelineMessageCounts(`${os.homedir()}/.codex/sessions/session.jsonl`)).resolves.toEqual({
      userCount: 0,
      assistantCount: 0,
      toolCount: 0,
      toolBreakdown: {},
    });

    expect(timeline.commands).toEqual(expect.arrayContaining([
      {
        type: 'timeline.list-sessions',
        payload: {
          tmuxSession: 'pt-ws-pane-tab',
          cwd: '/repo',
          panelType: 'codex',
          offset: 10,
          limit: 20,
        },
      },
      {
        type: 'timeline.read-entries-before',
        payload: {
          jsonlPath: `${os.homedir()}/.codex/sessions/session.jsonl`,
          beforeByte: 128,
          limit: 25,
          panelType: 'codex',
        },
      },
      {
        type: 'timeline.message-counts',
        payload: { jsonlPath: `${os.homedir()}/.codex/sessions/session.jsonl` },
      },
    ]));
  });

  it('keeps every Session Catalog call behind the Supervisor timeline facade', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });

    await expect(supervisor.getSessionCatalogHealth()).resolves.toMatchObject({ state: 'ready', indexedSessions: 1 });
    await expect(supervisor.searchSessionCatalog({ query: 'worker', limit: 50 }))
      .resolves.toMatchObject({ results: [], total: 0 });
    await expect(supervisor.readSessionCatalogEntries({
      sessionId: 'session-1',
      beforeByte: 100,
      limit: 50,
      panelType: 'codex',
    })).resolves.toMatchObject({ entries: [], hasMore: false });
    await expect(supervisor.rebuildSessionCatalog()).resolves.toEqual({ started: true, state: 'building' });

    expect(timeline.commands).toEqual(expect.arrayContaining([
      { type: 'timeline.catalog-health', payload: {} },
      { type: 'timeline.catalog-search', payload: { query: 'worker', limit: 50 } },
      {
        type: 'timeline.catalog-read-entries',
        payload: { sessionId: 'session-1', beforeByte: 100, limit: 50, panelType: 'codex' },
      },
      { type: 'timeline.catalog-rebuild', payload: {} },
    ]));
    expect(storage.commands.map((item) => item.type)).not.toContain('storage.catalog-search');
  });

  it('merges Storage Worker annotations into catalog results and owns annotation updates', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    timeline.replies.set('timeline.catalog-search', {
      results: [{
        entry: {
          sessionId: 'session-1',
          projectLabel: 'codexmux',
          startedAt: '2026-08-21T08:00:00.000Z',
          lastActivityAt: '2026-08-21T08:01:00.000Z',
          turnCount: 1,
          indexedAt: '2026-08-21T09:00:00.000Z',
        },
        snippet: 'worker',
      }],
      nextCursor: null,
      total: 1,
      health: 'ready',
    });
    storage.replies.set('storage.list-session-annotations', [{
      sessionId: 'session-1',
      pinned: true,
      tags: ['review'],
      version: 1,
      updatedAt: '2026-08-21T09:00:00.000Z',
    }]);
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });

    await expect(supervisor.searchSessionCatalog({ query: 'worker' })).resolves.toMatchObject({
      results: [{ annotation: { pinned: true, tags: ['review'] } }],
    });
    await expect(supervisor.updateSessionAnnotation({
      sessionId: 'session-1',
      pinned: true,
      tags: ['review'],
      expectedVersion: 0,
    })).resolves.toMatchObject({ sessionId: 'session-1', version: 1 });

    expect(timeline.commands).toContainEqual({
      type: 'timeline.catalog-read-entries',
      payload: { sessionId: 'session-1', beforeByte: 0, limit: 1, panelType: 'codex' },
    });
    expect(storage.commands).toEqual(expect.arrayContaining([
      { type: 'storage.list-session-annotations', payload: { sessionIds: ['session-1'] } },
      {
        type: 'storage.update-session-annotation',
        payload: {
          sessionId: 'session-1',
          pinned: true,
          tags: ['review'],
          expectedVersion: 0,
          sessionExists: true,
        },
      },
    ]));
  });

  it('applies annotation selection before Timeline pagination and preserves exact page metadata', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    storage.replies.set('storage.select-session-annotations', {
      mode: 'include', sessionIds: ['session-1'],
    });
    timeline.replies.set('timeline.catalog-search', {
      results: [{
        entry: {
          sessionId: 'session-1',
          projectLabel: 'codexmux',
          startedAt: '2026-08-21T08:00:00.000Z',
          lastActivityAt: '2026-08-21T08:01:00.000Z',
          turnCount: 1,
          indexedAt: '2026-08-21T09:00:00.000Z',
        },
        snippet: 'worker',
      }],
      nextCursor: 'eyJmaWx0ZXJlZCI6dHJ1ZX0',
      total: 1,
      health: 'ready',
    });
    storage.replies.set('storage.list-session-annotations', [{
      sessionId: 'session-1', pinned: true, tags: ['review'], version: 1,
      updatedAt: '2026-08-21T09:00:00.000Z',
    }]);
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });

    await expect(supervisor.searchSessionCatalog({ query: 'worker', pinned: true, tags: ['review'] }))
      .resolves.toMatchObject({
        results: [{ annotation: { pinned: true, tags: ['review'] } }],
        total: 1,
        nextCursor: 'eyJmaWx0ZXJlZCI6dHJ1ZX0',
      });

    expect(storage.commands).toContainEqual({
      type: 'storage.select-session-annotations', payload: { pinned: true, tags: ['review'] },
    });
    expect(timeline.commands).toContainEqual({
      type: 'timeline.catalog-search',
      payload: {
        query: 'worker', pinned: true, tags: ['review'],
        annotationSelection: { mode: 'include', sessionIds: ['session-1'] },
      },
    });
  });

  it('retries the complete filtered search once when hydrated annotations conflict', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    storage.replies.set('storage.select-session-annotations', {
      mode: 'include', sessionIds: ['session-1'],
    });
    timeline.replies.set('timeline.catalog-search', {
      results: [{
        entry: {
          sessionId: 'session-1', projectLabel: 'codexmux',
          startedAt: '2026-08-21T08:00:00.000Z', lastActivityAt: '2026-08-21T08:01:00.000Z',
          turnCount: 1, indexedAt: '2026-08-21T09:00:00.000Z',
        },
        snippet: 'worker',
      }],
      nextCursor: null,
      total: 1,
      health: 'ready',
    });
    let hydrationCount = 0;
    storage.handlers.set('storage.list-session-annotations', () => {
      hydrationCount += 1;
      return [{
        sessionId: 'session-1',
        pinned: hydrationCount > 1,
        tags: ['review'],
        version: hydrationCount,
        updatedAt: '2026-08-21T09:00:00.000Z',
      }];
    });
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });

    await expect(supervisor.searchSessionCatalog({ query: 'worker', pinned: true }))
      .resolves.toMatchObject({ results: [{ annotation: { pinned: true } }] });
    expect(storage.commands.filter((command) => command.type === 'storage.select-session-annotations')).toHaveLength(2);
    expect(timeline.commands.filter((command) => command.type === 'timeline.catalog-search')).toHaveLength(2);
    expect(hydrationCount).toBe(2);
  });

  it('fails closed when a filtered search still conflicts after one retry', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    storage.replies.set('storage.select-session-annotations', {
      mode: 'include', sessionIds: ['session-1'],
    });
    timeline.replies.set('timeline.catalog-search', {
      results: [{
        entry: {
          sessionId: 'session-1', projectLabel: 'codexmux',
          startedAt: '2026-08-21T08:00:00.000Z', lastActivityAt: '2026-08-21T08:01:00.000Z',
          turnCount: 1, indexedAt: '2026-08-21T09:00:00.000Z',
        },
        snippet: 'worker',
      }],
      nextCursor: null,
      total: 1,
      health: 'ready',
    });
    storage.replies.set('storage.list-session-annotations', [{
      sessionId: 'session-1', pinned: false, tags: [], version: 1,
      updatedAt: '2026-08-21T09:00:00.000Z',
    }]);
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });

    await expect(supervisor.searchSessionCatalog({ query: 'worker', pinned: true }))
      .rejects.toMatchObject({ code: 'session-annotation-search-conflict', retryable: true });
    expect(timeline.commands.filter((command) => command.type === 'timeline.catalog-search')).toHaveLength(2);
  });

  it('keeps Approved Root and Managed Project writes behind the Storage Worker facade', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    storage.replies.set('storage.register-approved-project-root', {
      id: 'root-1', label: 'Projects', approvedAt: '2026-08-21T10:00:00.000Z',
    });
    storage.replies.set('storage.register-managed-project', {
      id: 'project-1', approvedRootId: 'root-1', title: 'Demo', relativePath: 'demo', source: 'manual',
      createdAt: '2026-08-21T10:00:00.000Z', updatedAt: '2026-08-21T10:00:00.000Z',
    });
    storage.replies.set('storage.list-managed-projects', []);
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });

    await expect(supervisor.registerApprovedProjectRoot({
      id: 'root-1', label: 'Projects', canonicalPath: '/srv/projects', approvedAt: '2026-08-21T10:00:00.000Z',
    })).resolves.toMatchObject({ id: 'root-1' });
    await expect(supervisor.registerManagedProject({
      approvedRootId: 'root-1', title: 'Demo', relativePath: 'demo', canonicalPath: '/srv/projects/demo', source: 'manual',
    })).resolves.toMatchObject({ id: 'project-1' });
    await expect(supervisor.listManagedProjects()).resolves.toEqual([]);

    expect(storage.commands).toEqual(expect.arrayContaining([
      {
        type: 'storage.register-approved-project-root',
        payload: { id: 'root-1', label: 'Projects', canonicalPath: '/srv/projects', approvedAt: '2026-08-21T10:00:00.000Z' },
      },
      {
        type: 'storage.register-managed-project',
        payload: { approvedRootId: 'root-1', title: 'Demo', relativePath: 'demo', canonicalPath: '/srv/projects/demo', source: 'manual' },
      },
      { type: 'storage.list-managed-projects', payload: {} },
    ]));
  });

  it('passes Storage-owned project snapshots to the read-only Governance Worker', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    const governance = new FakeWorker();
    const projects = [{
      id: 'project-1',
      approvedRootId: 'root-1',
      title: 'Demo',
      relativePath: 'demo',
      canonicalPath: '/srv/projects/demo',
      source: 'manual',
      createdAt: '2026-08-21T10:00:00.000Z',
      updatedAt: '2026-08-21T10:00:00.000Z',
    }];
    storage.replies.set('storage.list-managed-project-snapshots', projects);
    storage.replies.set('storage.list-approved-project-root-snapshots', []);
    governance.replies.set('governance.refresh-projects', { refreshed: 1, failed: 0 });
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status, governance });

    await expect(supervisor.refreshGovernanceProjects()).resolves.toEqual({ refreshed: 1, failed: 0 });
    expect(storage.commands).toContainEqual({ type: 'storage.list-managed-project-snapshots', payload: {} });
    expect(governance.commands).toContainEqual({ type: 'governance.refresh-projects', payload: { projects, roots: [] } });
  });

  it('keeps core runtime available when Governance Worker readiness fails', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    const governance = new FakeWorker();
    governance.waitUntilReady = async () => {
      throw Object.assign(new Error('index unavailable'), { code: 'governance-index-unavailable' });
    };
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status, governance });

    await expect(supervisor.ensureStarted()).resolves.toBeUndefined();
    expect(storage.shutdowns).toBe(0);
    expect(terminal.shutdowns).toBe(0);
    expect(timeline.shutdowns).toBe(0);
    expect(status.shutdowns).toBe(0);
  });

  it('subscribes timeline live events and fans out matching append events', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    const eventHandlers: Array<(event: IRuntimeEvent) => void> = [];
    const jsonlPath = `${os.homedir()}/.codex/sessions/session.jsonl`;
    timeline.request = async <TPayload, TResult>(type: string, payload: TPayload): Promise<TResult> => {
      timeline.commands.push({ type, payload });
      if (type === 'timeline.live-subscribe') {
        return {
          subscriberId: (payload as { subscriberId: string }).subscriberId,
          subscribed: true,
          init: {
            type: 'timeline:init',
            entries: [],
            sessionId: 'session-a',
            totalEntries: 0,
            startByteOffset: 0,
            hasMore: false,
            jsonlPath,
          },
        } as TResult;
      }
      if (type === 'timeline.live-unsubscribe') {
        return {
          subscriberId: (payload as { subscriberId: string }).subscriberId,
          unsubscribed: true,
        } as TResult;
      }
      return timeline.replies.get(type) as TResult;
    };
    const supervisor = createRuntimeSupervisorForTest({
      storage,
      terminal,
      timeline,
      status,
      captureTimelineEventHandler: (handler) => {
        eventHandlers.push(handler);
      },
    });
    const onAppend = vi.fn();

    const subscription = await supervisor.subscribeTimelineLive({
      jsonlPath,
      sessionName: 'pt-ws-a-pane-b-tab-c',
      sessionId: 'session-a',
      panelType: 'codex',
      onAppend,
      onError: vi.fn(),
    });

    expect(subscription.subscriberId).toMatch(/^sub-/);
    expect(eventHandlers).toHaveLength(1);
    expect(timeline.commands).toEqual(expect.arrayContaining([
      {
        type: 'timeline.live-subscribe',
        payload: {
          subscriberId: subscription.subscriberId,
          jsonlPath,
          sessionName: 'pt-ws-a-pane-b-tab-c',
          sessionId: 'session-a',
          panelType: 'codex',
        },
      },
    ]));

    eventHandlers[0](createRuntimeEvent({
      source: 'timeline',
      target: 'supervisor',
      type: 'timeline.live-append',
      delivery: 'realtime',
      payload: {
        subscriberId: subscription.subscriberId,
        jsonlPath,
        entries: [{ id: 'entry-a', type: 'user-message', timestamp: 1 }],
      },
    }));
    expect(onAppend).toHaveBeenCalledWith(expect.objectContaining({
      subscriberId: subscription.subscriberId,
      entries: [{ id: 'entry-a', type: 'user-message', timestamp: 1 }],
    }));

    await supervisor.unsubscribeTimelineLive(subscription.subscriberId);
    expect(timeline.commands).toEqual(expect.arrayContaining([
      {
        type: 'timeline.live-unsubscribe',
        payload: { subscriberId: subscription.subscriberId },
      },
    ]));
  });

  it('subscribes timeline session watch events and fans out matching changes', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    const eventHandlers: Array<(event: IRuntimeEvent) => void> = [];
    timeline.request = async <TPayload, TResult>(type: string, payload: TPayload): Promise<TResult> => {
      timeline.commands.push({ type, payload });
      if (type === 'timeline.session-watch-subscribe') {
        return {
          subscriberId: (payload as { subscriberId: string }).subscriberId,
          subscribed: true,
        } as TResult;
      }
      if (type === 'timeline.session-watch-unsubscribe') {
        return {
          subscriberId: (payload as { subscriberId: string }).subscriberId,
          unsubscribed: true,
        } as TResult;
      }
      return timeline.replies.get(type) as TResult;
    };
    const supervisor = createRuntimeSupervisorForTest({
      storage,
      terminal,
      timeline,
      status,
      captureTimelineEventHandler: (handler) => {
        eventHandlers.push(handler);
      },
    });
    const onChanged = vi.fn();

    const subscription = await supervisor.subscribeTimelineSessionWatch({
      sessionName: 'pt-ws-a-pane-b-tab-c',
      panePid: 123,
      panelType: 'codex',
      skipInitial: true,
      onChanged,
    });

    expect(subscription.subscriberId).toMatch(/^sub-/);
    expect(eventHandlers).toHaveLength(1);
    expect(timeline.commands).toEqual(expect.arrayContaining([
      {
        type: 'timeline.session-watch-subscribe',
        payload: {
          subscriberId: subscription.subscriberId,
          sessionName: 'pt-ws-a-pane-b-tab-c',
          panePid: 123,
          panelType: 'codex',
          skipInitial: true,
        },
      },
    ]));

    eventHandlers[0](createRuntimeEvent({
      source: 'timeline',
      target: 'supervisor',
      type: 'timeline.session-changed',
      delivery: 'realtime',
      payload: {
        subscriberId: subscription.subscriberId,
        sessionName: 'pt-ws-a-pane-b-tab-c',
        info: {
          status: 'running',
          sessionId: '33333333-3333-3333-3333-333333333333',
          jsonlPath: `${os.homedir()}/.codex/sessions/session.jsonl`,
          pid: 456,
          startedAt: 1,
          cwd: '/repo',
        },
      },
    }));
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({
      subscriberId: subscription.subscriberId,
      sessionName: 'pt-ws-a-pane-b-tab-c',
      info: expect.objectContaining({
        status: 'running',
        sessionId: '33333333-3333-3333-3333-333333333333',
      }),
    }));

    await supervisor.unsubscribeTimelineSessionWatch(subscription.subscriberId);
    expect(timeline.commands).toEqual(expect.arrayContaining([
      {
        type: 'timeline.session-watch-unsubscribe',
        payload: { subscriberId: subscription.subscriberId },
      },
    ]));
  });

  it('clears timeline live and session watchers after timeline worker exit', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    const eventHandlers: Array<(event: IRuntimeEvent) => void> = [];
    let onTimelineExit: ((err?: Error) => void) | undefined;
    const jsonlPath = `${os.homedir()}/.codex/sessions/session.jsonl`;
    timeline.request = async <TPayload, TResult>(type: string, payload: TPayload): Promise<TResult> => {
      timeline.commands.push({ type, payload });
      if (type === 'timeline.live-subscribe') {
        return {
          subscriberId: (payload as { subscriberId: string }).subscriberId,
          subscribed: true,
          init: {
            type: 'timeline:init',
            entries: [],
            sessionId: 'session-a',
            totalEntries: 0,
            startByteOffset: 0,
            hasMore: false,
            jsonlPath,
          },
        } as TResult;
      }
      if (type === 'timeline.session-watch-subscribe') {
        return {
          subscriberId: (payload as { subscriberId: string }).subscriberId,
          subscribed: true,
        } as TResult;
      }
      return timeline.replies.get(type) as TResult;
    };
    const supervisor = createRuntimeSupervisorForTest({
      storage,
      terminal,
      status,
      createTimelineClient: (handlers) => {
        onTimelineExit = handlers.onExit;
        return timeline;
      },
      captureTimelineEventHandler: (handler) => {
        eventHandlers.push(handler);
      },
    });
    const onError = vi.fn();
    const onAppend = vi.fn();
    const onChanged = vi.fn();

    const liveSubscription = await supervisor.subscribeTimelineLive({
      jsonlPath,
      sessionName: 'pt-ws-a-pane-b-tab-c',
      sessionId: 'session-a',
      panelType: 'codex',
      onAppend,
      onError,
    });
    const watchSubscription = await supervisor.subscribeTimelineSessionWatch({
      sessionName: 'pt-ws-a-pane-b-tab-c',
      panePid: 123,
      panelType: 'codex',
      onChanged,
    });

    expect(onTimelineExit).toBeDefined();
    onTimelineExit?.(new Error('timeline worker stopped'));
    eventHandlers[0](createRuntimeEvent({
      source: 'timeline',
      target: 'supervisor',
      type: 'timeline.live-append',
      delivery: 'realtime',
      payload: {
        subscriberId: liveSubscription.subscriberId,
        jsonlPath,
        entries: [{ id: 'entry-a', type: 'user-message', timestamp: 1 }],
      },
    }));
    eventHandlers[0](createRuntimeEvent({
      source: 'timeline',
      target: 'supervisor',
      type: 'timeline.session-changed',
      delivery: 'realtime',
      payload: {
        subscriberId: watchSubscription.subscriberId,
        sessionName: 'pt-ws-a-pane-b-tab-c',
        info: {
          status: 'running',
          sessionId: '33333333-3333-3333-3333-333333333333',
          jsonlPath,
          pid: 456,
          startedAt: 1,
          cwd: '/repo',
        },
      },
    }));

    expect(liveSubscription.subscriberId).toMatch(/^sub-/);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      code: 'timeline-worker-exited',
      message: 'timeline worker stopped',
    }));
    expect(onAppend).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('proxies status policy commands through the status worker', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });

    await expect(supervisor.reduceStatusHookState({
      currentState: 'busy',
      eventName: 'stop',
      providerId: 'codex',
      statusBehavior: {
        watchJsonlWhenBound: true,
        deferStopHookUntilJsonlIdle: true,
      },
    })).resolves.toEqual({ nextState: 'busy', changed: false, deferStopHook: true });
    await expect(supervisor.reduceStatusCodexState({
      currentState: 'busy',
      running: true,
      hasJsonlPath: true,
      idle: true,
      hasCompletionSnippet: true,
    })).resolves.toEqual({
      nextState: 'ready-for-review',
      changed: true,
      silent: false,
      skipHistory: false,
    });
    await expect(supervisor.evaluateStatusNotificationPolicy({
      eventName: 'notification',
      notificationType: 'permission_prompt',
      newState: 'needs-input',
      silent: false,
    })).resolves.toEqual({
      processHookEvent: true,
      sendReviewNotification: false,
      sendNeedsInputNotification: true,
    });
    await expect(supervisor.evaluateStatusSideEffects({
      previousState: 'busy',
      newState: 'ready-for-review',
      hasJsonlPath: true,
      providerId: 'codex',
      statusBehavior: {
        watchJsonlWhenBound: true,
        deferStopHookUntilJsonlIdle: true,
      },
      hasJsonlWatcher: true,
      sessionHistoryDedupeAccepted: true,
      reviewNotificationDedupeAccepted: true,
    })).resolves.toEqual({
      clearDismissedAt: false,
      setReadyForReviewAt: true,
      setBusySince: false,
      saveSessionHistory: true,
      sendReviewNotification: true,
      sendNeedsInputNotification: false,
      startJsonlWatch: false,
      stopJsonlWatch: false,
    });
    await expect(supervisor.evaluateStatusClientEvent({
      eventType: 'ack-notification',
      currentState: 'needs-input',
      lastEventName: 'notification',
      lastEventSeq: 5,
      clientSeq: 5,
    })).resolves.toEqual({
      accepted: true,
      nextState: 'busy',
      setDismissedAt: false,
      persistLayout: true,
      broadcastUpdate: true,
      updateSessionHistoryDismissedAt: false,
    });
    const historyEntry = {
      id: 'history-a',
      workspaceId: 'ws-a',
      workspaceName: 'Workspace',
      workspaceDir: null,
      tabId: 'tab-a',
      agentSessionId: 'agent-a',
      prompt: 'prompt',
      result: 'result',
      startedAt: 1,
      completedAt: 2,
      duration: 1,
      dismissedAt: null,
      toolUsage: {},
      touchedFiles: [],
    };
    await expect(supervisor.addStatusSessionHistoryEntry(historyEntry)).resolves.toEqual({
      added: true,
      entry: historyEntry,
    });
    await expect(supervisor.updateStatusSessionHistoryDismissedAt({
      tabId: 'tab-a',
      dismissedAt: 3,
    })).resolves.toEqual({
      updated: true,
      entry: { ...historyEntry, dismissedAt: 3 },
    });
    const pushPayload = {
      title: 'Task Complete',
      body: 'prompt',
      silent: false,
      tabId: 'tab-a',
      workspaceId: 'ws-a',
      agentSessionId: 'agent-a',
      workspaceName: 'Workspace',
      workspaceDir: null,
    };
    await expect(supervisor.sendStatusWebPush({
      anyDeviceVisible: false,
      payload: pushPayload,
    })).resolves.toEqual({
      skippedVisible: false,
      attempted: 1,
      sent: 1,
      removed: 0,
      failed: 0,
    });

    expect(status.commands).toEqual(expect.arrayContaining([
      {
        type: 'status.reduce-hook-state',
        payload: {
          currentState: 'busy',
          eventName: 'stop',
          providerId: 'codex',
          statusBehavior: {
            watchJsonlWhenBound: true,
            deferStopHookUntilJsonlIdle: true,
          },
        },
      },
      {
        type: 'status.reduce-codex-state',
        payload: {
          currentState: 'busy',
          running: true,
          hasJsonlPath: true,
          idle: true,
          hasCompletionSnippet: true,
        },
      },
      {
        type: 'status.evaluate-notification-policy',
        payload: {
          eventName: 'notification',
          notificationType: 'permission_prompt',
          newState: 'needs-input',
          silent: false,
        },
      },
      {
        type: 'status.evaluate-side-effects',
        payload: {
          previousState: 'busy',
          newState: 'ready-for-review',
          hasJsonlPath: true,
          providerId: 'codex',
          statusBehavior: {
            watchJsonlWhenBound: true,
            deferStopHookUntilJsonlIdle: true,
          },
          hasJsonlWatcher: true,
          sessionHistoryDedupeAccepted: true,
          reviewNotificationDedupeAccepted: true,
        },
      },
      {
        type: 'status.evaluate-client-event',
        payload: {
          eventType: 'ack-notification',
          currentState: 'needs-input',
          lastEventName: 'notification',
          lastEventSeq: 5,
          clientSeq: 5,
        },
      },
      {
        type: 'status.add-session-history-entry',
        payload: { entry: historyEntry },
      },
      {
        type: 'status.update-session-history-dismissed-at',
        payload: {
          tabId: 'tab-a',
          dismissedAt: 3,
        },
      },
      {
        type: 'status.send-web-push',
        payload: {
          anyDeviceVisible: false,
          payload: pushPayload,
        },
      },
    ]));
  });

  it('subscribes status live events and fans out realtime updates', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    const eventHandlers: Array<(event: IRuntimeEvent) => void> = [];
    const supervisor = createRuntimeSupervisorForTest({
      storage,
      terminal,
      timeline,
      createStatusClient: (handlers) => {
        eventHandlers.push((event) => handlers.onEvent(event));
        return status;
      },
      captureStatusEventHandler: (handler) => {
        eventHandlers.push(handler);
      },
    });
    const onEvent = vi.fn();

    const subscription = await supervisor.subscribeStatusLive({ onEvent });

    expect(subscription.subscriberId).toMatch(/^sub-/);
    expect(subscription).toMatchObject({
      subscribed: true,
      sync: { tabs: {}, rateLimits: {} },
    });
    expect(status.commands).toEqual(expect.arrayContaining([
      { type: 'status.live-start', payload: {} },
      { type: 'status.live-request-sync', payload: {} },
    ]));
    expect(eventHandlers.length).toBeGreaterThan(0);

    eventHandlers[0](createRuntimeEvent({
      source: 'status',
      target: 'supervisor',
      type: 'status.update',
      delivery: 'realtime',
      payload: {
        tabId: 'tab-a',
        cliState: 'needs-input',
        workspaceId: 'ws-a',
        tabName: 'Codex',
        panelType: 'codex',
        terminalStatus: 'running',
        lastEvent: { name: 'notification', at: 10, seq: 4 },
        eventSeq: 4,
      },
    }));

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'status.update',
      payload: expect.objectContaining({
        tabId: 'tab-a',
        cliState: 'needs-input',
      }),
    }));

    await expect(supervisor.unsubscribeStatusLive(subscription.subscriberId)).resolves.toEqual({
      subscriberId: subscription.subscriberId,
      unsubscribed: true,
    });
    expect(status.commands).toEqual(expect.arrayContaining([
      { type: 'status.live-stop', payload: {} },
    ]));
  });

  it('proxies status live bridge commands through the status worker', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });

    await expect(supervisor.startStatusLive()).resolves.toEqual({ started: true });
    await expect(supervisor.requestStatusLiveSync()).resolves.toEqual({ tabs: {}, rateLimits: {} });
    await expect(supervisor.sendStatusLiveHookEvent({
      tmuxSession: 'pt-ws-a-pane-b-tab-c',
      event: 'notification',
      notificationType: 'permission_prompt',
    })).resolves.toEqual({ accepted: true });
    await expect(supervisor.sendStatusLiveClientEvent({
      eventType: 'ack-notification',
      tabId: 'tab-a',
      seq: 4,
    })).resolves.toEqual({ accepted: true });
    await expect(supervisor.notifyStatusLiveLastUserMessage({
      sessionName: 'pt-ws-a-pane-b-tab-c',
      message: 'hello',
    })).resolves.toEqual({ accepted: true });
    await expect(supervisor.registerStatusLiveTab({
      tabId: 'tab-a',
      entry: {
        cliState: 'inactive',
        workspaceId: 'ws-a',
        tabName: 'Codex',
        tmuxSession: 'pt-ws-a-pane-b-tab-c',
        lastEvent: null,
        eventSeq: 0,
      },
    })).resolves.toEqual({ accepted: true });
    await expect(supervisor.updateStatusLiveDeviceVisibility({
      deviceId: 'device-a',
      visible: true,
    })).resolves.toEqual({ accepted: true });
    await expect(supervisor.removeStatusLiveTab({ tabId: 'tab-a' })).resolves.toEqual({ accepted: true });
    await expect(supervisor.pollStatusLive()).resolves.toEqual({ polled: true });

    expect(status.commands).toEqual(expect.arrayContaining([
      { type: 'status.live-start', payload: {} },
      { type: 'status.live-request-sync', payload: {} },
      {
        type: 'status.live-hook-event',
        payload: {
          tmuxSession: 'pt-ws-a-pane-b-tab-c',
          event: 'notification',
          notificationType: 'permission_prompt',
        },
      },
      {
        type: 'status.live-client-event',
        payload: {
          eventType: 'ack-notification',
          tabId: 'tab-a',
          seq: 4,
        },
      },
      {
        type: 'status.live-notify-last-user-message',
        payload: {
          sessionName: 'pt-ws-a-pane-b-tab-c',
          message: 'hello',
        },
      },
      {
        type: 'status.live-register-tab',
        payload: {
          tabId: 'tab-a',
          entry: {
            cliState: 'inactive',
            workspaceId: 'ws-a',
            tabName: 'Codex',
            tmuxSession: 'pt-ws-a-pane-b-tab-c',
            lastEvent: null,
            eventSeq: 0,
          },
        },
      },
      {
        type: 'status.live-device-visibility',
        payload: {
          deviceId: 'device-a',
          visible: true,
        },
      },
      { type: 'status.live-remove-tab', payload: { tabId: 'tab-a' } },
      { type: 'status.live-poll', payload: {} },
    ]));
  });

  it('deletes workspace using only sessions returned by the storage transaction', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    storage.replies.set('storage.delete-workspace', {
      deleted: true,
      sessions: [
        { sessionName: 'rtv2-ws-a-pane-b-tab-a' },
        { sessionName: 'pt-legacy' },
        { sessionName: 'rtv2-ws-a-pane-b-tab-b' },
      ],
    });
    terminal.failures.set('terminal.kill-session', Object.assign(new Error('tmux kill failed'), {
      code: 'runtime-v2-terminal-kill-failed',
      retryable: false,
    }));
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });

    await expect(supervisor.deleteWorkspace('ws-a')).resolves.toEqual({
      deleted: true,
      killedSessions: [],
      failedKills: [
        { sessionName: 'rtv2-ws-a-pane-b-tab-a', error: 'tmux kill failed' },
        { sessionName: 'pt-legacy', error: 'invalid runtime session name' },
        { sessionName: 'rtv2-ws-a-pane-b-tab-b', error: 'tmux kill failed' },
      ],
    });

    expect(storage.commands.map((command) => command.type)).toContain('storage.delete-workspace');
    expect(storage.commands.map((command) => command.type)).not.toContain('storage.list-workspace-terminal-sessions');
    expect(terminal.commands.filter((command) => command.type === 'terminal.kill-session')).toHaveLength(2);
  });

  it('does not kill sessions when storage delete reports no deletion', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    storage.replies.set('storage.delete-workspace', { deleted: false, sessions: [{ sessionName: 'rtv2-ws-a-pane-b-tab-a' }] });
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });

    await expect(supervisor.deleteWorkspace('ws-a')).resolves.toEqual({
      deleted: false,
      killedSessions: [],
      failedKills: [],
    });
    expect(terminal.commands.map((command) => command.type)).not.toContain('terminal.kill-session');
  });

  it('deletes terminal tabs, closes subscribers, and kills the returned session', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    const close = vi.fn();
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });

    const attached = await supervisor.attachTerminal({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      cols: 80,
      rows: 24,
      send: vi.fn(),
      close,
    });
    await expect(supervisor.deleteTerminalTab('tab-a')).resolves.toEqual({
      deleted: true,
      killedSession: 'rtv2-ws-a-pane-b-tab-c',
      failedKill: null,
    });

    expect(attached.subscriberId).toMatch(/^sub-/);
    expect(close).toHaveBeenCalledWith(1000, 'Tab deleted');
    expect(storage.commands).toEqual(expect.arrayContaining([
      { type: 'storage.delete-terminal-tab', payload: { id: 'tab-a' } },
    ]));
    expect(terminal.commands).toEqual(expect.arrayContaining([
      { type: 'terminal.kill-session', payload: { sessionName: 'rtv2-ws-a-pane-b-tab-c' } },
    ]));
  });

  it('skips terminal kill when terminal tab delete returns no cleanup session', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    storage.replies.set('storage.delete-terminal-tab', { deleted: false, session: null });
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });

    await expect(supervisor.deleteTerminalTab('tab-missing')).resolves.toEqual({
      deleted: false,
      killedSession: null,
      failedKill: null,
    });
    expect(terminal.commands.map((command) => command.type)).not.toContain('terminal.kill-session');
  });

  it('does not send invalid deleted tab sessions to terminal worker', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    storage.replies.set('storage.delete-terminal-tab', {
      deleted: true,
      session: { sessionName: 'pt-legacy-session' },
    });
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });

    await expect(supervisor.deleteTerminalTab('tab-a')).resolves.toEqual({
      deleted: true,
      killedSession: null,
      failedKill: {
        sessionName: 'pt-legacy-session',
        error: 'invalid runtime session name',
      },
    });
    expect(terminal.commands.map((command) => command.type)).not.toContain('terminal.kill-session');
  });

  it('reconciles stale pending and ready terminal tabs before reporting started', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    storage.replies.set('storage.list-pending-terminal-tabs', [
      { id: 'tab-pending', sessionName: 'rtv2-ws-a-pane-b-tab-pending' },
    ]);
    storage.replies.set('storage.list-ready-terminal-tabs', [
      {
        id: 'tab-ready',
        sessionName: 'rtv2-ws-a-pane-b-tab-ready',
        name: '',
        order: 0,
        panelType: 'terminal',
        lifecycleState: 'ready',
      },
    ]);
    terminal.replies.set('terminal.has-session', {
      sessionName: 'rtv2-ws-a-pane-b-tab-ready',
      exists: false,
    });
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });

    await supervisor.ensureStarted();

    expect(terminal.commands).toEqual(expect.arrayContaining([
      { type: 'terminal.kill-session', payload: { sessionName: 'rtv2-ws-a-pane-b-tab-pending' } },
      { type: 'terminal.has-session', payload: { sessionName: 'rtv2-ws-a-pane-b-tab-ready' } },
    ]));
    expect(storage.commands).toEqual(expect.arrayContaining([
      {
        type: 'storage.fail-pending-terminal-tab',
        payload: {
          id: 'tab-pending',
          reason: 'startup reconciliation',
        },
      },
      {
        type: 'storage.fail-ready-terminal-tab',
        payload: {
          id: 'tab-ready',
          reason: 'startup reconciliation: tmux session missing',
        },
      },
    ]));
    expect(storage.commands.findIndex((command) => command.type === 'storage.fail-pending-terminal-tab'))
      .toBeLessThan(storage.commands.findIndex((command) => command.type === 'storage.list-ready-terminal-tabs'));
  });

  it('leaves ready terminal tabs ready when tmux sessions still exist', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    storage.replies.set('storage.list-ready-terminal-tabs', [
      {
        id: 'tab-ready',
        sessionName: 'rtv2-ws-a-pane-b-tab-ready',
        name: '',
        order: 0,
        panelType: 'terminal',
        lifecycleState: 'ready',
      },
    ]);
    terminal.replies.set('terminal.has-session', {
      sessionName: 'rtv2-ws-a-pane-b-tab-ready',
      exists: true,
    });
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });

    await supervisor.ensureStarted();

    expect(terminal.commands).toEqual(expect.arrayContaining([
      { type: 'terminal.has-session', payload: { sessionName: 'rtv2-ws-a-pane-b-tab-ready' } },
    ]));
    expect(storage.commands.map((command) => command.type)).not.toContain('storage.fail-ready-terminal-tab');
  });

  it('fails invalid ready terminal tabs without sending invalid tmux targets', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    storage.replies.set('storage.list-ready-terminal-tabs', [
      {
        id: 'tab-invalid-ready',
        sessionName: 'pt-legacy-session',
        name: '',
        order: 0,
        panelType: 'terminal',
        lifecycleState: 'ready',
      },
    ]);
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });

    await supervisor.ensureStarted();

    expect(terminal.commands.map((command) => command.type)).not.toContain('terminal.has-session');
    expect(storage.commands).toEqual(expect.arrayContaining([
      {
        type: 'storage.fail-ready-terminal-tab',
        payload: {
          id: 'tab-invalid-ready',
          reason: 'startup reconciliation: invalid session name',
        },
      },
    ]));
  });

  it('does not report started when ready tab reconciliation fails', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    storage.replies.set('storage.list-ready-terminal-tabs', [
      {
        id: 'tab-ready',
        sessionName: 'rtv2-ws-a-pane-b-tab-ready',
        name: '',
        order: 0,
        panelType: 'terminal',
        lifecycleState: 'ready',
      },
    ]);
    terminal.failures.set('terminal.has-session', Object.assign(new Error('tmux unavailable'), {
      code: 'runtime-v2-terminal-presence-check-failed',
      retryable: false,
    }));
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });

    await expect(supervisor.ensureStarted()).rejects.toMatchObject({
      code: 'runtime-v2-terminal-presence-check-failed',
    });

    expect(storage.shutdowns).toBe(1);
    expect(terminal.shutdowns).toBe(1);
    expect(timeline.shutdowns).toBe(1);
    expect(storage.commands.map((command) => command.type)).not.toContain('storage.fail-ready-terminal-tab');
  });

  it('creates terminal tabs with pending storage intent before terminal create and finalization', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });

    await supervisor.createTerminalTab({ workspaceId: 'ws-a', paneId: 'pane-b', cwd: '/tmp' });

    expect([
      ...storage.commands.map((command) => `storage:${command.type}`),
      ...terminal.commands.map((command) => `terminal:${command.type}`),
    ]).toEqual(expect.arrayContaining([
      'storage:storage.create-pending-terminal-tab',
      'storage:storage.finalize-terminal-tab',
      'terminal:terminal.create-session',
    ]));
    const pending = storage.commands.find((command) => command.type === 'storage.create-pending-terminal-tab');
    expect(pending?.payload).toMatchObject({
      workspaceId: 'ws-a',
      paneId: 'pane-b',
      cwd: '/tmp',
      sessionName: expect.stringMatching(/^rtv2-ws-a-pane-b-tab-/),
    });
    expect(pending?.payload).not.toHaveProperty('callerSessionName');
  });

  it('restarts existing terminal tabs with the same runtime session name', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    const sessionName = 'rtv2-ws-a-pane-b-tab-c';
    storage.replies.set('storage.create-pending-terminal-tab', {
      id: 'tab-c',
      sessionName,
      workspaceId: 'ws-a',
      paneId: 'pane-b',
      cwd: '/repo',
      runtimeVersion: 2,
      lifecycleState: 'pending_terminal',
      createdAt: new Date(0).toISOString(),
    });
    storage.replies.set('storage.finalize-terminal-tab', {
      id: 'tab-c',
      sessionName,
      name: '',
      order: 0,
      cwd: '/repo',
      panelType: 'terminal',
      runtimeVersion: 2,
      lifecycleState: 'ready',
    });
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });

    const tab = await supervisor.restartTerminalTab({
      workspaceId: 'ws-a',
      paneId: 'pane-b',
      tabId: 'tab-c',
      sessionName,
      cwd: '/repo',
      ensureWorkspacePane: {
        workspaceName: 'Workspace A',
        defaultCwd: '/repo',
      },
    });

    expect(tab).toMatchObject({ id: 'tab-c', sessionName, runtimeVersion: 2, lifecycleState: 'ready' });
    expect(storage.commands.map((command) => command.type)).toEqual(expect.arrayContaining([
      'storage.ensure-workspace-pane',
      'storage.delete-terminal-tab',
      'storage.create-pending-terminal-tab',
      'storage.finalize-terminal-tab',
    ]));
    expect(storage.commands.find((command) => command.type === 'storage.create-pending-terminal-tab')?.payload)
      .toMatchObject({
        id: 'tab-c',
        workspaceId: 'ws-a',
        paneId: 'pane-b',
        sessionName,
        cwd: '/repo',
      });
    expect(terminal.commands.map((command) => command.type)).toEqual(expect.arrayContaining([
      'terminal.kill-session',
      'terminal.create-session',
    ]));
    expect(terminal.commands.find((command) => command.type === 'terminal.create-session')?.payload)
      .toMatchObject({ sessionName, cwd: '/repo' });
  });

  it('ensures legacy workspace pane mirror before creating opt-in runtime terminal tabs', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });

    await supervisor.createTerminalTab({
      workspaceId: 'ws-a',
      paneId: 'pane-b',
      cwd: '/tmp',
      ensureWorkspacePane: {
        workspaceName: 'Workspace A',
        defaultCwd: '/repo',
      },
    });

    expect(storage.commands.map((command) => command.type)).toEqual(expect.arrayContaining([
      'storage.ensure-workspace-pane',
      'storage.create-pending-terminal-tab',
      'storage.finalize-terminal-tab',
    ]));
    expect(storage.commands.find((command) => command.type === 'storage.ensure-workspace-pane')?.payload).toEqual({
      workspaceId: 'ws-a',
      paneId: 'pane-b',
      name: 'Workspace A',
      defaultCwd: '/repo',
    });
  });

  it('rolls back pending tabs and preserves rollback storage failure', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    terminal.failures.set('terminal.create-session', Object.assign(new Error('tmux create failed'), {
      code: 'runtime-v2-terminal-create-failed',
      retryable: false,
    }));
    storage.failures.set('storage.fail-pending-terminal-tab', Object.assign(new Error('storage rollback failed'), {
      code: 'runtime-v2-pending-tab-not-found',
      retryable: false,
    }));
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });

    await expect(supervisor.createTerminalTab({ workspaceId: 'ws-a', paneId: 'pane-b', cwd: '/tmp' })).rejects.toMatchObject({
      code: 'runtime-v2-pending-tab-not-found',
      message: 'storage rollback failed',
    });
    expect(terminal.commands.map((command) => command.type)).toContain('terminal.kill-session');
    expect(storage.commands.map((command) => command.type)).toContain('storage.fail-pending-terminal-tab');
  });

  it('attaches once per session and fans out stdout to every subscriber', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    const eventHandlers: Array<(event: IRuntimeEvent) => void> = [];
    const supervisor = createRuntimeSupervisorForTest({
      storage,
      terminal,
      timeline,
      status,
      captureTerminalEventHandler: (handler) => {
        eventHandlers.push(handler);
      },
    });
    const firstSend = vi.fn();
    const secondSend = vi.fn();

    const first = await supervisor.attachTerminal({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      cols: 80,
      rows: 24,
      send: firstSend,
      close: vi.fn(),
    });
    const second = await supervisor.attachTerminal({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      cols: 120,
      rows: 40,
      send: secondSend,
      close: vi.fn(),
    });

    expect(first.subscriberId).not.toBe(second.subscriberId);
    expect(terminal.commands.filter((command) => command.type === 'terminal.attach')).toHaveLength(1);
    expect(eventHandlers).toHaveLength(1);
    eventHandlers[0](createRuntimeEvent({
      source: 'terminal',
      target: 'supervisor',
      type: 'terminal.stdout',
      delivery: 'realtime',
      payload: { sessionName: 'rtv2-ws-a-pane-b-tab-c', data: 'hello' },
    }));
    expect(firstSend).toHaveBeenCalledWith('hello');
    expect(secondSend).toHaveBeenCalledWith('hello');

    await supervisor.detachTerminal({ sessionName: 'rtv2-ws-a-pane-b-tab-c', subscriberId: first.subscriberId });
    expect(terminal.commands.filter((command) => command.type === 'terminal.detach')).toHaveLength(0);
    await supervisor.detachTerminal({ sessionName: 'rtv2-ws-a-pane-b-tab-c', subscriberId: second.subscriberId });
    expect(terminal.commands.filter((command) => command.type === 'terminal.detach')).toHaveLength(1);
  });

  it('closes terminal subscribers with a retriable code when the worker exits', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    let onExit = (): void => {};
    const close = vi.fn();
    const supervisor = createRuntimeSupervisorForTest({
      storage,
      timeline,
      status,
      createTerminalClient: (handlers) => {
        onExit = handlers.onExit;
        return terminal;
      },
    });

    await supervisor.attachTerminal({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      cols: 80,
      rows: 24,
      send: vi.fn(),
      close,
    });
    onExit?.();

    expect(close).toHaveBeenCalledWith(1001, 'Terminal worker exited');
  });

  it('waits for an in-flight detach before reattaching the same session', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    let resolveDetach: (() => void) | null = null;
    terminal.request = async <TPayload, TResult>(type: string, payload: TPayload): Promise<TResult> => {
      terminal.commands.push({ type, payload });
      if (type === 'terminal.detach') {
        await new Promise<void>((resolve) => {
          resolveDetach = resolve;
        });
      }
      return terminal.replies.get(type) as TResult;
    };
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });
    const first = await supervisor.attachTerminal({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      cols: 80,
      rows: 24,
      send: vi.fn(),
      close: vi.fn(),
    });

    const detachPromise = supervisor.detachTerminal({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      subscriberId: first.subscriberId,
    });
    const finishDetach = resolveDetach as (() => void) | null;
    expect(finishDetach).not.toBeNull();
    const secondPromise = supervisor.attachTerminal({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      cols: 100,
      rows: 30,
      send: vi.fn(),
      close: vi.fn(),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(terminal.commands.filter((command) => command.type === 'terminal.attach')).toHaveLength(1);
    finishDetach?.();
    await detachPromise;
    const second = await secondPromise;

    expect(second.subscriberId).not.toBe(first.subscriberId);
    expect(terminal.commands
      .filter((command) => command.type === 'terminal.attach' || command.type === 'terminal.detach')
      .map((command) => command.type)).toEqual(['terminal.attach', 'terminal.detach', 'terminal.attach']);
  });

  it('rejects writes from missing subscribers before terminal worker IPC', async () => {
    const { storage, terminal, timeline, status } = createWorkers();
    const supervisor = createRuntimeSupervisorForTest({ storage, terminal, timeline, status });

    await expect(supervisor.writeTerminal({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      subscriberId: 'sub-missing',
      data: 'pwd\n',
    })).rejects.toMatchObject({
      code: 'runtime-v2-terminal-subscriber-not-found',
      retryable: false,
    });
    expect(terminal.commands.map((command) => command.type)).not.toContain('terminal.write-stdin');
  });

  it('backs up runtime db files once and keeps the singleton on globalThis', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmux-runtime-reset-'));
    const dbPath = path.join(dir, 'state.db');
    fs.writeFileSync(`${dbPath}-wal`, 'wal');
    const { storage, terminal, timeline, status } = createWorkers();

    const supervisor = createRuntimeSupervisorForTest({
      storage,
      terminal,
      timeline,
      status,
      dbPath,
      runtimeReset: true,
      useGlobal: true,
    });
    const same = getRuntimeSupervisor();

    await supervisor.ensureStarted();
    expect(same).toBe(supervisor);
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(false);
    expect(fs.readdirSync(dir).filter((name) => name.endsWith('.bak'))).toHaveLength(1);
    createRuntimeSupervisorForTest({ storage, terminal, timeline, status, dbPath, runtimeReset: true, useGlobal: true });
    await supervisor.ensureStarted();
    expect(fs.readdirSync(dir).filter((name) => name.endsWith('.bak'))).toHaveLength(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

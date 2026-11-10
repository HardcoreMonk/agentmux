import { describe, expect, it, vi } from 'vitest';
import { createRuntimeCommand } from '@/lib/runtime/ipc';
import { createStatusWorkerService } from '@/lib/runtime/status/worker-service';
import type { ISessionHistoryEntry } from '@/types/session-history';
import type { IRuntimeEvent } from '@/lib/runtime/ipc';

const command = (type: string, payload: unknown = {}) => createRuntimeCommand({
  id: `cmd-${type}`,
  source: 'supervisor',
  target: 'status',
  type,
  payload,
});

const sessionHistoryEntry: ISessionHistoryEntry = {
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

const createLiveManager = (tabs = {}) => {
  const rateLimits = {
    ts: 10,
    five_hour: null,
    seven_day: { used_percentage: 5, resets_at: 20, observed_at: 10 },
  };
  const manager = {
    init: vi.fn(async () => undefined),
    shutdown: vi.fn(),
    getAllForClient: vi.fn(() => tabs),
    getRateLimitsForClient: vi.fn(() => rateLimits),
    updateTabFromHook: vi.fn(),
    dismissTab: vi.fn(() => true),
    ackNotificationInput: vi.fn(() => true),
    notifyLastUserMessage: vi.fn(() => true),
    registerTab: vi.fn(),
    removeTab: vi.fn(() => true),
    poll: vi.fn(async () => undefined),
  };
  return manager;
};

describe('status worker service', () => {
  it('handles health checks', async () => {
    const service = createStatusWorkerService();
    const reply = await service.handleCommand(command('status.health'));

    expect(reply.ok).toBe(true);
    expect(reply.source).toBe('status');
    expect(reply.target).toBe('supervisor');
    expect(reply.payload).toEqual({ ok: true });
  });

  it('starts, stops, and syncs the live status skeleton', async () => {
    const liveManager = createLiveManager({
      'tab-a': {
        cliState: 'busy',
        workspaceId: 'ws-a',
        tabName: 'Codex',
      },
    });
    const service = createStatusWorkerService({
      createLiveManager: () => liveManager,
    });

    await expect(service.handleCommand(command('status.live-start'))).resolves.toMatchObject({
      ok: true,
      payload: { started: true },
    });
    await expect(service.handleCommand(command('status.live-request-sync'))).resolves.toMatchObject({
      ok: true,
      payload: {
        tabs: {
          'tab-a': {
            cliState: 'busy',
            workspaceId: 'ws-a',
            tabName: 'Codex',
          },
        },
        rateLimits: {
          ts: 10,
          five_hour: null,
          seven_day: { used_percentage: 5, resets_at: 20, observed_at: 10 },
        },
      },
    });
    await expect(service.handleCommand(command('status.live-stop'))).resolves.toMatchObject({
      ok: true,
      payload: { stopped: true },
    });
    expect(liveManager.init).toHaveBeenCalled();
    expect(liveManager.shutdown).toHaveBeenCalled();
  });

  it('routes live hook, client, message, remove, and poll commands to the live manager', async () => {
    const liveManager = createLiveManager();
    const service = createStatusWorkerService({
      createLiveManager: () => liveManager,
    });

    await service.handleCommand(command('status.live-hook-event', {
      tmuxSession: 'pt-ws-a-pane-b-tab-c',
      event: 'notification',
      notificationType: 'permission_prompt',
    }));
    await service.handleCommand(command('status.live-client-event', {
      eventType: 'ack-notification',
      tabId: 'tab-a',
      seq: 4,
    }));
    await service.handleCommand(command('status.live-notify-last-user-message', {
      sessionName: 'pt-ws-a-pane-b-tab-c',
      message: 'hello',
    }));
    await service.handleCommand(command('status.live-register-tab', {
      tabId: 'tab-a',
      entry: {
        cliState: 'inactive',
        workspaceId: 'ws-a',
        tabName: 'Codex',
        tmuxSession: 'pt-ws-a-pane-b-tab-c',
        lastEvent: null,
        eventSeq: 0,
      },
    }));
    await service.handleCommand(command('status.live-device-visibility', {
      deviceId: 'device-a',
      visible: true,
    }));
    await service.handleCommand(command('status.live-remove-tab', {
      tabId: 'tab-a',
    }));
    await service.handleCommand(command('status.live-poll'));

    expect(liveManager.updateTabFromHook).toHaveBeenCalledWith('pt-ws-a-pane-b-tab-c', 'notification', { notificationType: 'permission_prompt' });
    expect(liveManager.ackNotificationInput).toHaveBeenCalledWith('tab-a', 4);
    expect(liveManager.notifyLastUserMessage).toHaveBeenCalledWith('pt-ws-a-pane-b-tab-c', 'hello');
    expect(liveManager.registerTab).toHaveBeenCalledWith('tab-a', {
      cliState: 'inactive',
      workspaceId: 'ws-a',
      tabName: 'Codex',
      tmuxSession: 'pt-ws-a-pane-b-tab-c',
      lastEvent: null,
      eventSeq: 0,
    });
    expect(liveManager.removeTab).toHaveBeenCalledWith('tab-a');
    expect(liveManager.poll).toHaveBeenCalled();
  });

  it('maps live manager broadcasts to runtime status events', async () => {
    const events: IRuntimeEvent[] = [];
    const broadcastRef: { current: ((event: object) => void) | null } = { current: null };
    const liveManager = createLiveManager();
    const service = createStatusWorkerService({
      emitEvent: (event) => {
        events.push(event);
      },
      createLiveManager: (handler) => {
        broadcastRef.current = handler;
        return liveManager;
      },
    });

    await service.handleCommand(command('status.live-start'));
    const emitBroadcast = broadcastRef.current;
    expect(emitBroadcast).not.toBeNull();
    if (!emitBroadcast) throw new Error('missing broadcast handler');
    emitBroadcast({
      type: 'status:update',
      tabId: 'tab-a',
      cliState: 'needs-input',
      workspaceId: 'ws-a',
      tabName: 'Codex',
      lastEvent: { name: 'notification', at: 10, seq: 4 },
      eventSeq: 4,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'event',
      source: 'status',
      target: 'supervisor',
      type: 'status.update',
      delivery: 'realtime',
      payload: {
        tabId: 'tab-a',
        cliState: 'needs-input',
      },
    });

    emitBroadcast({ type: 'status:sync', tabs: {} });

    expect(events[1]).toMatchObject({
      type: 'status.sync',
      payload: {
        tabs: {},
        rateLimits: {
          ts: 10,
          five_hour: null,
          seven_day: { used_percentage: 5, resets_at: 20, observed_at: 10 },
        },
      },
    });
  });

  it('keeps Codex stop hooks out of direct ready-for-review transitions', async () => {
    const service = createStatusWorkerService();
    const reply = await service.handleCommand(command('status.reduce-hook-state', {
      currentState: 'busy',
      eventName: 'stop',
      providerId: 'codex',
      statusBehavior: {
        watchJsonlWhenBound: true,
        deferStopHookUntilJsonlIdle: true,
      },
    }));

    expect(reply.ok).toBe(true);
    expect(reply.payload).toEqual({
      nextState: 'busy',
      changed: false,
      deferStopHook: true,
    });
  });

  it('moves active completed Codex turns to ready-for-review', async () => {
    const service = createStatusWorkerService();
    const reply = await service.handleCommand(command('status.reduce-codex-state', {
      currentState: 'busy',
      running: true,
      hasJsonlPath: true,
      idle: true,
      hasCompletionSnippet: true,
    }));

    expect(reply.ok).toBe(true);
    expect(reply.payload).toEqual({
      nextState: 'ready-for-review',
      changed: true,
      silent: false,
      skipHistory: false,
    });
  });

  it('evaluates notification policy with input-request filtering', async () => {
    const service = createStatusWorkerService();
    const reply = await service.handleCommand(command('status.evaluate-notification-policy', {
      eventName: 'notification',
      notificationType: 'permission_prompt',
      newState: 'needs-input',
      silent: false,
    }));

    expect(reply.ok).toBe(true);
    expect(reply.payload).toEqual({
      processHookEvent: true,
      sendReviewNotification: false,
      sendNeedsInputNotification: true,
    });
  });

  it('evaluates side-effect intent without executing side effects', async () => {
    const service = createStatusWorkerService();
    const reply = await service.handleCommand(command('status.evaluate-side-effects', {
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
    }));

    expect(reply.ok).toBe(true);
    expect(reply.payload).toEqual({
      clearDismissedAt: false,
      setReadyForReviewAt: true,
      setBusySince: false,
      saveSessionHistory: true,
      sendReviewNotification: true,
      sendNeedsInputNotification: false,
      startJsonlWatch: false,
      stopJsonlWatch: false,
    });
  });

  it('evaluates client ack and dismiss decisions without mutating state', async () => {
    const service = createStatusWorkerService();
    const ack = await service.handleCommand(command('status.evaluate-client-event', {
      eventType: 'ack-notification',
      currentState: 'needs-input',
      lastEventName: 'notification',
      lastEventSeq: 3,
      clientSeq: 3,
    }));
    const dismiss = await service.handleCommand(command('status.evaluate-client-event', {
      eventType: 'dismiss-tab',
      currentState: 'ready-for-review',
      lastEventName: null,
      lastEventSeq: null,
      clientSeq: null,
    }));

    expect(ack.ok).toBe(true);
    expect(ack.payload).toEqual({
      accepted: true,
      nextState: 'busy',
      setDismissedAt: false,
      persistLayout: true,
      broadcastUpdate: true,
      updateSessionHistoryDismissedAt: false,
    });
    expect(dismiss.ok).toBe(true);
    expect(dismiss.payload).toEqual({
      accepted: true,
      nextState: 'idle',
      setDismissedAt: true,
      persistLayout: true,
      broadcastUpdate: true,
      updateSessionHistoryDismissedAt: true,
    });
  });

  it('executes session history commands through injected actions', async () => {
    const addEntry = vi.fn(async (entry: ISessionHistoryEntry) => ({ added: true, entry }));
    const updateDismissedAt = vi.fn(async (tabId: string, dismissedAt: number) => ({
      updated: true,
      entry: { ...sessionHistoryEntry, tabId, dismissedAt },
    }));
    const service = createStatusWorkerService({
      sessionHistoryActions: {
        addEntry,
        updateDismissedAt,
      },
    });

    const addReply = await service.handleCommand(command('status.add-session-history-entry', {
      entry: sessionHistoryEntry,
    }));
    const updateReply = await service.handleCommand(command('status.update-session-history-dismissed-at', {
      tabId: 'tab-a',
      dismissedAt: 3,
    }));

    expect(addReply.ok).toBe(true);
    expect(addReply.payload).toEqual({ added: true, entry: sessionHistoryEntry });
    expect(addEntry).toHaveBeenCalledWith(sessionHistoryEntry);
    expect(updateReply.ok).toBe(true);
    expect(updateReply.payload).toEqual({
      updated: true,
      entry: { ...sessionHistoryEntry, dismissedAt: 3 },
    });
    expect(updateDismissedAt).toHaveBeenCalledWith('tab-a', 3);
  });

  it('executes Web Push sends through injected actions', async () => {
    const send = vi.fn(async () => ({
      skippedVisible: false,
      attempted: 1,
      sent: 1,
      removed: 0,
      failed: 0,
    }));
    const service = createStatusWorkerService({
      webPushActions: { send },
    });
    const payload = {
      title: 'Task Complete',
      body: 'prompt',
      silent: false,
      tabId: 'tab-a',
      workspaceId: 'ws-a',
      agentSessionId: 'agent-a',
      workspaceName: 'Workspace',
      workspaceDir: null,
      approvalKind: 'allow',
      promptType: 'command',
      riskLevel: 'medium',
      approvalDetail: 'corepack pnpm test',
    };

    const reply = await service.handleCommand(command('status.send-web-push', {
      anyDeviceVisible: false,
      payload,
    }));

    expect(reply.ok).toBe(true);
    expect(reply.payload).toEqual({
      skippedVisible: false,
      attempted: 1,
      sent: 1,
      removed: 0,
      failed: 0,
    });
    expect(send).toHaveBeenCalledWith({ anyDeviceVisible: false, payload });
  });
});

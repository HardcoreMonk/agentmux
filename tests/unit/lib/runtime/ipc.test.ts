import { describe, expect, it } from 'vitest';
import {
  createRuntimeCommand,
  createRuntimeEvent,
  createRuntimeReply,
  parseRuntimeCommandPayload,
  parseRuntimeEventPayload,
  parseRuntimeMessage,
  parseRuntimeReplyPayload,
  runtimeCommandRegistry,
  runtimeEventRegistry,
} from '@/lib/runtime/ipc';
import { PANEL_TYPES } from '@/lib/panel-type';

describe('runtime ipc', () => {
  describe('panelType schemas', () => {
    const statusPayload = (panelType: string) => ({
      tabs: {
        'tab-a': {
          cliState: 'idle',
          workspaceId: 'ws-a',
          tabName: 'Tab',
          panelType,
          terminalStatus: 'running',
          lastEvent: null,
          eventSeq: 1,
        },
      },
      rateLimits: null,
    });
    const layoutReply = (panelType: string) => ({
      root: {
        type: 'pane',
        id: 'pane-a',
        tabs: [{
          id: 'tab-a',
          sessionName: 'pt-ws-a-pane-a-tab-a',
          name: 'Tab',
          order: 0,
          runtimeVersion: 2,
          panelType,
        }],
        activeTabId: 'tab-a',
      },
      activePaneId: 'pane-a',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    it.each(PANEL_TYPES)('accepts %s in status and layout tab payloads', (panelType) => {
      expect(() => parseRuntimeEventPayload('status.sync', statusPayload(panelType))).not.toThrow();
      expect(() => parseRuntimeReplyPayload('storage.get-layout', layoutReply(panelType))).not.toThrow();
    });

    it('turns an unknown panelType into undefined in status and layout tab payloads', () => {
      const status = parseRuntimeEventPayload('status.sync', statusPayload('future-agent'));
      expect(status.tabs['tab-a'].panelType).toBeUndefined();

      const layout = parseRuntimeReplyPayload('storage.get-layout', layoutReply('future-agent'));
      const root = layout?.root as { tabs: Array<{ panelType?: string }> };
      expect(root.tabs[0].panelType).toBeUndefined();
    });

    it('drops unknown agent provider status behavior keys instead of rejecting the payload', () => {
      const parsed = parseRuntimeCommandPayload('status.evaluate-side-effects', {
        previousState: 'busy',
        newState: 'ready-for-review',
        hasJsonlPath: true,
        providerId: 'codex',
        hasJsonlWatcher: true,
        sessionHistoryDedupeAccepted: true,
        reviewNotificationDedupeAccepted: true,
        statusBehavior: {
          watchJsonlWhenBound: true,
          deferStopHookUntilJsonlIdle: false,
          reconcileStateFromJsonl: true,
          recoverPaneInput: true,
        },
      });
      expect(parsed.statusBehavior).toEqual({
        watchJsonlWhenBound: true,
        deferStopHookUntilJsonlIdle: false,
      });
    });
  });
  it('creates and parses command envelopes', () => {
    const msg = createRuntimeCommand({
      id: 'cmd-1',
      source: 'supervisor',
      target: 'storage',
      type: 'storage.health',
      payload: { ping: true },
    });

    expect(parseRuntimeMessage(msg)).toEqual(msg);
    expect(msg.kind).toBe('command');
    expect(msg.sentAt).toMatch(/T/);
  });

  it('creates reply envelopes linked to commands', () => {
    const reply = createRuntimeReply({
      id: 'reply-1',
      commandId: 'cmd-1',
      source: 'storage',
      target: 'supervisor',
      type: 'storage.health.reply',
      ok: false,
      error: { code: 'storage-unavailable', message: 'database locked', retryable: true },
      payload: null,
    });

    expect(reply.kind).toBe('reply');
    expect(reply.commandId).toBe('cmd-1');
    expect(reply.error?.retryable).toBe(true);
  });

  it('rejects malformed envelopes', () => {
    expect(() => parseRuntimeMessage({ kind: 'command', id: 'x' })).toThrow(/Invalid runtime IPC message/);
  });

  it('rejects reply envelopes with invalid success or failure shape', () => {
    expect(() => parseRuntimeMessage({
      kind: 'reply',
      id: 'reply-1',
      commandId: 'cmd-1',
      source: 'storage',
      target: 'supervisor',
      type: 'storage.health.reply',
      sentAt: new Date().toISOString(),
      ok: true,
      error: { code: 'should-not-exist', message: 'unexpected' },
      payload: { ok: true },
    })).toThrow(/Invalid runtime IPC message/);

    expect(() => parseRuntimeMessage({
      kind: 'reply',
      id: 'reply-2',
      commandId: 'cmd-1',
      source: 'storage',
      target: 'supervisor',
      type: 'storage.health.reply',
      sentAt: new Date().toISOString(),
      ok: false,
      payload: null,
    })).toThrow(/Invalid runtime IPC message/);

    expect(() => parseRuntimeMessage({
      kind: 'reply',
      id: 'reply-3',
      commandId: 'cmd-1',
      source: 'storage',
      target: 'supervisor',
      type: 'storage.health.reply',
      sentAt: new Date().toISOString(),
      ok: false,
      error: { code: 'storage-unavailable', message: 'database locked' },
      payload: { ok: false },
    })).toThrow(/Invalid runtime IPC message/);
  });

  it('validates reply constructors before returning', () => {
    expect(() => createRuntimeReply({
      id: 'reply-1',
      commandId: 'cmd-1',
      source: 'storage',
      target: 'supervisor',
      type: 'storage.health.reply',
      ok: true,
      error: { code: 'should-not-exist', message: 'unexpected' },
      payload: { ok: true },
    } as never)).toThrow(/Invalid runtime IPC message/);

    expect(() => createRuntimeReply({
      id: 'reply-2',
      commandId: 'cmd-1',
      source: 'storage',
      target: 'supervisor',
      type: 'storage.health.reply',
      ok: false,
      payload: null,
    } as never)).toThrow(/Invalid runtime IPC message/);

    expect(() => createRuntimeReply({
      id: 'reply-3',
      commandId: 'cmd-1',
      source: 'storage',
      target: 'supervisor',
      type: 'storage.create-workspace.reply',
      ok: true,
      payload: { id: 'ws-a' },
    })).toThrow(/Invalid runtime IPC reply/);
  });

  it('distinguishes durable and realtime events', () => {
    const event = createRuntimeEvent({
      id: 'evt-1',
      source: 'terminal',
      target: 'supervisor',
      type: 'terminal.stdout',
      delivery: 'realtime',
      payload: { sessionName: 'rtv2-ws-a-pane-b-tab-c', data: 'hello' },
    });

    expect(event.kind).toBe('event');
    expect(event.delivery).toBe('realtime');
  });

  it('validates event payloads through the event registry', () => {
    expect(runtimeEventRegistry['terminal.stdout']).toMatchObject({
      source: 'terminal',
      target: 'supervisor',
      delivery: 'realtime',
    });

    const payload = parseRuntimeEventPayload('terminal.stdout', {
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      data: 'hello',
    });

    expect(payload).toEqual({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      data: 'hello',
    });
    expect(() => parseRuntimeEventPayload('terminal.stdout', {
      sessionName: 'pt-ws-a-pane-b-tab-c',
      data: 'hello',
    })).toThrow(/Invalid runtime IPC event/);

    expect(runtimeEventRegistry['terminal.backpressure']).toMatchObject({
      source: 'terminal',
      target: 'supervisor',
      delivery: 'realtime',
    });

    const backpressure = parseRuntimeEventPayload('terminal.backpressure', {
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      pendingBytes: 4096,
      maxPendingStdoutBytes: 2048,
    });

    expect(backpressure).toEqual({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      pendingBytes: 4096,
      maxPendingStdoutBytes: 2048,
    });
    expect(() => parseRuntimeEventPayload('terminal.backpressure', {
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      pendingBytes: -1,
      maxPendingStdoutBytes: 2048,
    })).toThrow(/Invalid runtime IPC event/);

    expect(runtimeEventRegistry['timeline.live-append']).toMatchObject({
      source: 'timeline',
      target: 'supervisor',
      delivery: 'realtime',
    });

    expect(parseRuntimeEventPayload('timeline.live-append', {
      subscriberId: 'tlsub-a',
      jsonlPath: `${process.env.HOME}/.codex/sessions/session.jsonl`,
      entries: [{ id: 'entry-a', type: 'user-message', timestamp: 1 }],
    })).toEqual({
      subscriberId: 'tlsub-a',
      jsonlPath: `${process.env.HOME}/.codex/sessions/session.jsonl`,
      entries: [{ id: 'entry-a', type: 'user-message', timestamp: 1 }],
    });

    expect(parseRuntimeEventPayload('timeline.live-error', {
      subscriberId: 'tlsub-a',
      jsonlPath: `${process.env.HOME}/.codex/sessions/session.jsonl`,
      code: 'watcher-failed',
      message: 'File watch failed',
    })).toMatchObject({
      subscriberId: 'tlsub-a',
      code: 'watcher-failed',
    });

    expect(runtimeEventRegistry['status.sync']).toMatchObject({
      source: 'status',
      target: 'supervisor',
      delivery: 'realtime',
    });

    expect(parseRuntimeEventPayload('status.sync', {
      tabs: {
        'tab-a': {
          cliState: 'busy',
          workspaceId: 'ws-a',
          tabName: 'Codex',
          panelType: 'codex',
          terminalStatus: 'running',
          lastEvent: null,
          eventSeq: 2,
        },
      },
      rateLimits: null,
    })).toEqual({
      tabs: {
        'tab-a': {
          cliState: 'busy',
          workspaceId: 'ws-a',
          tabName: 'Codex',
          panelType: 'codex',
          terminalStatus: 'running',
          lastEvent: null,
          eventSeq: 2,
        },
      },
      rateLimits: null,
    });

    expect(parseRuntimeEventPayload('status.update', {
      tabId: 'tab-a',
      cliState: 'needs-input',
      workspaceId: 'ws-a',
      tabName: 'Codex',
      panelType: 'codex',
      terminalStatus: 'running',
      lastEvent: { name: 'notification', at: 10, seq: 4 },
      eventSeq: 4,
    })).toMatchObject({
      tabId: 'tab-a',
      cliState: 'needs-input',
      lastEvent: { name: 'notification', at: 10, seq: 4 },
    });

    expect(parseRuntimeEventPayload('status.session-history-update', {
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
    })).toMatchObject({
      entry: {
        id: 'history-a',
        tabId: 'tab-a',
      },
    });

    expect(parseRuntimeEventPayload('status.hook-event', {
      tabId: 'tab-a',
      sessionName: 'session-a',
      event: { name: 'notification', at: 10, seq: 4 },
    })).toEqual({
      tabId: 'tab-a',
      sessionName: 'session-a',
      event: { name: 'notification', at: 10, seq: 4 },
    });

    expect(parseRuntimeEventPayload('status.error', {
      code: 'status-live-failed',
      message: 'Status live bridge failed',
    })).toEqual({
      code: 'status-live-failed',
      message: 'Status live bridge failed',
    });

    expect(parseRuntimeEventPayload('status.rate-limits-update', {
      data: {
        ts: 10,
        five_hour: { used_percentage: 50, resets_at: 20 },
        seven_day: null,
      },
    })).toEqual({
      data: {
        ts: 10,
        five_hour: { used_percentage: 50, resets_at: 20 },
        seven_day: null,
      },
    });
  });

  it('validates registered event constructors before returning', () => {
    expect(() => createRuntimeEvent({
      id: 'evt-1',
      source: 'terminal',
      target: 'supervisor',
      type: 'terminal.stdout',
      delivery: 'realtime',
      payload: { sessionName: 'pt-ws-a-pane-b-tab-c', data: 'hello' },
    })).toThrow(/Invalid runtime IPC event/);

    expect(() => createRuntimeEvent({
      id: 'evt-2',
      source: 'storage',
      target: 'supervisor',
      type: 'terminal.stdout',
      delivery: 'realtime',
      payload: { sessionName: 'rtv2-ws-a-pane-b-tab-c', data: 'hello' },
    })).toThrow(/Invalid runtime IPC event/);

    expect(() => createRuntimeEvent({
      id: 'evt-3',
      source: 'terminal',
      target: 'supervisor',
      type: 'timeline.live-append',
      delivery: 'realtime',
      payload: {
        subscriberId: 'tlsub-a',
        jsonlPath: `${process.env.HOME}/.codex/sessions/session.jsonl`,
        entries: [],
      },
    })).toThrow(/Invalid runtime IPC event/);
  });

  it('validates command payloads through the command registry', () => {
    expect(runtimeCommandRegistry['storage.delete-workspace']).toBeDefined();

    const payload = parseRuntimeCommandPayload('terminal.resize', {
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      cols: 100,
      rows: 30,
    });

    expect(payload).toEqual({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      cols: 100,
      rows: 30,
    });
    expect(() => parseRuntimeCommandPayload('terminal.resize', {
      sessionName: 'pt-ws-a-pane-b-tab-c',
      cols: 100,
      rows: 30,
    })).toThrow(/Invalid runtime IPC payload/);

    expect(parseRuntimeCommandPayload('timeline.list-sessions', {
      tmuxSession: 'pt-ws-a-pane-b-tab-c',
      panelType: 'codex',
      offset: 0,
      limit: 50,
    })).toEqual({
      tmuxSession: 'pt-ws-a-pane-b-tab-c',
      panelType: 'codex',
      offset: 0,
      limit: 50,
    });

    expect(() => parseRuntimeCommandPayload('timeline.list-sessions', {
      tmuxSession: 'pt-ws-a-pane-b-tab-c',
      panelType: 'codex',
      offset: 0,
      limit: 50,
      source: 'remote',
      sourceId: 'win11',
    })).toThrow(/Invalid runtime IPC payload/);

    expect(parseRuntimeCommandPayload('timeline.live-subscribe', {
      subscriberId: 'tlsub-a',
      jsonlPath: `${process.env.HOME}/.codex/sessions/session.jsonl`,
      sessionName: 'pt-ws-a-pane-b-tab-c',
      sessionId: 'session-a',
      panelType: 'codex',
    })).toEqual({
      subscriberId: 'tlsub-a',
      jsonlPath: `${process.env.HOME}/.codex/sessions/session.jsonl`,
      sessionName: 'pt-ws-a-pane-b-tab-c',
      sessionId: 'session-a',
      panelType: 'codex',
    });

    expect(parseRuntimeCommandPayload('timeline.live-unsubscribe', {
      subscriberId: 'tlsub-a',
    })).toEqual({ subscriberId: 'tlsub-a' });

    expect(parseRuntimeCommandPayload('timeline.session-watch-subscribe', {
      subscriberId: 'tlsw-a',
      sessionName: 'pt-ws-a-pane-b-tab-c',
      panePid: 123,
      panelType: 'codex',
      skipInitial: true,
    })).toEqual({
      subscriberId: 'tlsw-a',
      sessionName: 'pt-ws-a-pane-b-tab-c',
      panePid: 123,
      panelType: 'codex',
      skipInitial: true,
    });

    expect(() => parseRuntimeCommandPayload('timeline.session-watch-subscribe', {
      subscriberId: 'tlsw-a',
      sessionName: 'pt-ws-a-pane-b-tab-c',
      panePid: 0,
      panelType: 'codex',
    })).toThrow(/Invalid runtime IPC payload/);

    expect(parseRuntimeCommandPayload('status.live-start', {})).toEqual({});
    expect(parseRuntimeReplyPayload('status.live-start', { started: true })).toEqual({ started: true });
    expect(parseRuntimeCommandPayload('status.live-stop', {})).toEqual({});
    expect(parseRuntimeReplyPayload('status.live-stop', { stopped: true })).toEqual({ stopped: true });
    expect(parseRuntimeCommandPayload('status.live-request-sync', {})).toEqual({});
    expect(parseRuntimeReplyPayload('status.live-request-sync', {
      tabs: {},
      rateLimits: null,
    })).toEqual({ tabs: {}, rateLimits: null });
    expect(parseRuntimeCommandPayload('status.live-hook-event', {
      tmuxSession: 'pt-ws-a-pane-b-tab-c',
      event: 'notification',
      notificationType: 'permission_prompt',
    })).toEqual({
      tmuxSession: 'pt-ws-a-pane-b-tab-c',
      event: 'notification',
      notificationType: 'permission_prompt',
    });
    expect(parseRuntimeCommandPayload('status.live-client-event', {
      eventType: 'ack-notification',
      tabId: 'tab-a',
      seq: 4,
    })).toEqual({
      eventType: 'ack-notification',
      tabId: 'tab-a',
      seq: 4,
    });
    expect(parseRuntimeCommandPayload('status.live-notify-last-user-message', {
      sessionName: 'pt-ws-a-pane-b-tab-c',
      message: 'hello',
    })).toEqual({
      sessionName: 'pt-ws-a-pane-b-tab-c',
      message: 'hello',
    });
    expect(parseRuntimeCommandPayload('status.live-register-tab', {
      tabId: 'tab-a',
      entry: {
        cliState: 'inactive',
        workspaceId: 'ws-a',
        tabName: 'Codex',
        tmuxSession: 'pt-ws-a-pane-b-tab-c',
        lastEvent: null,
        eventSeq: 0,
      },
    })).toEqual({
      tabId: 'tab-a',
      entry: {
        cliState: 'inactive',
        workspaceId: 'ws-a',
        tabName: 'Codex',
        tmuxSession: 'pt-ws-a-pane-b-tab-c',
        lastEvent: null,
        eventSeq: 0,
      },
    });
    expect(parseRuntimeCommandPayload('status.live-device-visibility', {
      deviceId: 'device-a',
      visible: true,
    })).toEqual({
      deviceId: 'device-a',
      visible: true,
    });
    expect(parseRuntimeCommandPayload('status.live-remove-tab', { tabId: 'tab-a' })).toEqual({ tabId: 'tab-a' });
    expect(parseRuntimeCommandPayload('status.live-poll', {})).toEqual({});
    expect(parseRuntimeReplyPayload('status.live-client-event', { accepted: true })).toEqual({ accepted: true });
    expect(parseRuntimeReplyPayload('status.live-poll', { polled: true })).toEqual({ polled: true });

    expect(parseRuntimeCommandPayload('timeline.session-watch-unsubscribe', {
      subscriberId: 'tlsw-a',
    })).toEqual({ subscriberId: 'tlsw-a' });

    expect(parseRuntimeCommandPayload('status.evaluate-side-effects', {
      previousState: 'busy',
      newState: 'ready-for-review',
      hasJsonlPath: true,
      providerId: 'codex',
      hasJsonlWatcher: true,
      sessionHistoryDedupeAccepted: true,
      reviewNotificationDedupeAccepted: true,
    })).toEqual({
      previousState: 'busy',
      newState: 'ready-for-review',
      hasJsonlPath: true,
      providerId: 'codex',
      hasJsonlWatcher: true,
      sessionHistoryDedupeAccepted: true,
      reviewNotificationDedupeAccepted: true,
    });

    expect(() => parseRuntimeCommandPayload('status.evaluate-side-effects', {
      previousState: 'busy',
      newState: 'ready-for-review',
      hasJsonlPath: true,
      providerId: 'codex',
      hasJsonlWatcher: true,
      sessionHistoryDedupeAccepted: true,
      reviewNotificationDedupeAccepted: true,
      rawPrompt: 'must not cross IPC',
    })).toThrow(/Invalid runtime IPC payload/);

    expect(parseRuntimeCommandPayload('status.evaluate-client-event', {
      eventType: 'ack-notification',
      currentState: 'needs-input',
      lastEventName: 'notification',
      lastEventSeq: 5,
      clientSeq: 5,
    })).toEqual({
      eventType: 'ack-notification',
      currentState: 'needs-input',
      lastEventName: 'notification',
      lastEventSeq: 5,
      clientSeq: 5,
    });

    expect(() => parseRuntimeCommandPayload('status.evaluate-client-event', {
      eventType: 'ack-notification',
      currentState: 'needs-input',
      lastEventName: 'notification',
      lastEventSeq: 5,
      clientSeq: 5,
      tabId: 'must-not-cross-ipc',
    })).toThrow(/Invalid runtime IPC payload/);

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
    expect(parseRuntimeCommandPayload('status.add-session-history-entry', {
      entry: historyEntry,
    })).toEqual({ entry: historyEntry });

    expect(parseRuntimeCommandPayload('status.update-session-history-dismissed-at', {
      tabId: 'tab-a',
      dismissedAt: 3,
    })).toEqual({
      tabId: 'tab-a',
      dismissedAt: 3,
    });

    expect(() => parseRuntimeCommandPayload('status.add-session-history-entry', {
      entry: {
        ...historyEntry,
        workspaceDir: '/repo',
        jsonlPath: 'must-not-cross-ipc',
      },
    })).toThrow(/Invalid runtime IPC payload/);

    const pushPayload = {
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
    expect(parseRuntimeCommandPayload('status.send-web-push', {
      anyDeviceVisible: false,
      payload: pushPayload,
    })).toEqual({
      anyDeviceVisible: false,
      payload: pushPayload,
    });

    expect(() => parseRuntimeCommandPayload('status.send-web-push', {
      anyDeviceVisible: false,
      payload: {
        ...pushPayload,
        cwd: '/repo',
      },
    })).toThrow(/Invalid runtime IPC payload/);

    for (const oversized of [
      { sessionName: 'rtv2-ws-a-pane-b-tab-c', cols: 501, rows: 30 },
      { sessionName: 'rtv2-ws-a-pane-b-tab-c', cols: 100, rows: 201 },
    ]) {
      expect(() => parseRuntimeCommandPayload('terminal.resize', oversized)).toThrow(/Invalid runtime IPC payload/);
      expect(() => parseRuntimeCommandPayload('terminal.attach', oversized)).toThrow(/Invalid runtime IPC payload/);
      expect(() => parseRuntimeCommandPayload('terminal.create-session', { ...oversized, cwd: '/tmp' })).toThrow(/Invalid runtime IPC payload/);
    }
  });

  it('rejects tmux-unsafe runtime session names', () => {
    for (const sessionName of [
      'rtv2-ws-a:pane-b-tab-c',
      'rtv2-ws-a pane-b-tab-c',
      'rtv2-ws-a/pane-b-tab-c',
      'rtv2-Ws-a-pane-b-tab-c',
      `rtv2-${'a'.repeat(200)}`,
    ]) {
      expect(() => parseRuntimeCommandPayload('terminal.attach', {
        sessionName,
        cols: 80,
        rows: 24,
      })).toThrow(/Invalid runtime IPC payload/);
    }
  });

  it('validates reply payloads through the command registry', () => {
    expect(parseRuntimeReplyPayload('storage.create-workspace', {
      id: 'ws-a',
      rootPaneId: 'pane-a',
    })).toEqual({ id: 'ws-a', rootPaneId: 'pane-a' });

    expect(() => parseRuntimeReplyPayload('storage.create-workspace', {
      id: 'ws-a',
    })).toThrow(/Invalid runtime IPC reply/);
  });

  it('validates timeline session watcher events', () => {
    expect(runtimeEventRegistry['timeline.session-changed']).toMatchObject({
      source: 'timeline',
      target: 'supervisor',
      delivery: 'realtime',
    });

    expect(parseRuntimeEventPayload('timeline.session-changed', {
      subscriberId: 'tlsw-a',
      sessionName: 'pt-ws-a-pane-b-tab-c',
      info: {
        status: 'running',
        sessionId: '33333333-3333-3333-3333-333333333333',
        jsonlPath: `${process.env.HOME}/.codex/sessions/session.jsonl`,
        pid: 456,
        startedAt: 1,
        cwd: '/repo',
      },
    })).toEqual({
      subscriberId: 'tlsw-a',
      sessionName: 'pt-ws-a-pane-b-tab-c',
      info: {
        status: 'running',
        sessionId: '33333333-3333-3333-3333-333333333333',
        jsonlPath: `${process.env.HOME}/.codex/sessions/session.jsonl`,
        pid: 456,
        startedAt: 1,
        cwd: '/repo',
      },
    });

    expect(() => parseRuntimeEventPayload('timeline.session-changed', {
      subscriberId: 'tlsw-a',
      sessionName: 'pt-ws-a-pane-b-tab-c',
      info: {
        status: 'busy',
        sessionId: null,
        jsonlPath: null,
        pid: null,
        startedAt: null,
        cwd: null,
      },
    })).toThrow(/Invalid runtime IPC event/);
  });
});

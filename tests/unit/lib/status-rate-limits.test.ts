import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IRateLimitsData } from '@/types/status';

const watcher = vi.hoisted(() => ({ onChange: null as ((data: IRateLimitsData) => void) | null }));

const providerOverride = vi.hoisted(() => ({ byPanelType: null as ((panelType: unknown) => unknown) | null }));

const layoutMocks = vi.hoisted(() => ({
  updateTabAgentSessionId: vi.fn(async () => undefined),
  updateTabAgentJsonlPath: vi.fn(async () => undefined),
}));

vi.mock('@/lib/layout-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/layout-store')>();
  return {
    ...actual,
    updateTabAgentSessionId: layoutMocks.updateTabAgentSessionId,
    updateTabAgentJsonlPath: layoutMocks.updateTabAgentJsonlPath,
  };
});

vi.mock('@/lib/rate-limits-watcher', () => ({
  createRateLimitsWatcher: (onChange: (data: IRateLimitsData) => void) => {
    watcher.onChange = onChange;
    return { start: vi.fn(), stop: vi.fn() };
  },
}));

vi.mock('@/lib/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/providers')>();
  return {
    ...actual,
    getProviderByPanelType: (panelType: Parameters<typeof actual.getProviderByPanelType>[0]) =>
      providerOverride.byPanelType ? providerOverride.byPanelType(panelType) : actual.getProviderByPanelType(panelType),
  };
});

import { StatusManager } from '@/lib/status-manager';
import { emptyJsonlCheckResult } from '@/lib/status/jsonl-check';

const limits = (ts: number, used: number): IRateLimitsData => ({
  ts,
  five_hour: { used_percentage: used, resets_at: 1_000_000, observed_at: ts },
  seven_day: null,
});

type TPublisher = { publishRateLimits: (providerId: 'codex' | 'claude', data: IRateLimitsData) => void };

describe('StatusManager per-provider rate limits', () => {
  beforeEach(() => {
    watcher.onChange = null;
    providerOverride.byPanelType = null;
  });

  it('keeps codex and claude rate limits under separate keys', () => {
    const broadcast = vi.fn();
    const manager = new StatusManager({ broadcast, enableRateLimits: false });
    const publisher = manager as unknown as TPublisher;

    publisher.publishRateLimits('codex', limits(1, 10));
    publisher.publishRateLimits('claude', limits(2, 40));

    const stored = manager.getRateLimitsForClient();
    expect(stored.codex?.five_hour?.used_percentage).toBe(10);
    expect(stored.claude?.five_hour?.used_percentage).toBe(40);
    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(broadcast.mock.calls[0][0]).toMatchObject({ type: 'rate-limits:update', providerId: 'codex' });
    expect(broadcast.mock.calls[1][0]).toMatchObject({ type: 'rate-limits:update', providerId: 'claude' });
  });

  it('does not broadcast when the same value is received again', () => {
    const broadcast = vi.fn();
    const manager = new StatusManager({ broadcast, enableRateLimits: false });
    const publisher = manager as unknown as TPublisher;

    publisher.publishRateLimits('codex', limits(1, 10));
    publisher.publishRateLimits('codex', limits(1, 10));

    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('publishes JSONL rate limits under the id of the provider that read them', async () => {
    const broadcast = vi.fn();
    const manager = new StatusManager({ broadcast, enableRateLimits: false });
    const fakeProvider = {
      id: 'claude',
      readJsonlStatus: vi.fn(async () => ({ ...emptyJsonlCheckResult(), rateLimits: limits(5, 70) })),
    };
    providerOverride.byPanelType = (panelType) => (panelType === 'claude' ? fakeProvider : null);
    const internals = manager as unknown as {
      tabs: Map<string, Record<string, unknown>>;
      refreshStopSnippet: (tabId: string, jsonlPath: string) => Promise<void>;
    };
    internals.tabs.set('tab-c', { panelType: 'claude', currentAction: null, lastAssistantMessage: null });

    await internals.refreshStopSnippet('tab-c', '/home/test/.claude/projects/x/sid.jsonl');

    expect(fakeProvider.readJsonlStatus).toHaveBeenCalledWith('/home/test/.claude/projects/x/sid.jsonl');
    expect(manager.getRateLimitsForClient().claude?.five_hour?.used_percentage).toBe(70);
    expect(manager.getRateLimitsForClient().codex).toBeUndefined();
    expect(broadcast.mock.calls[0][0]).toMatchObject({ type: 'rate-limits:update', providerId: 'claude' });
  });

  it('maps the statusLine rate limits file to the claude key', async () => {
    const broadcast = vi.fn();
    const manager = new StatusManager({ broadcast });
    const internals = manager as unknown as Record<string, unknown>;
    internals.scanAll = vi.fn(async () => undefined);
    internals.startPolling = vi.fn();

    await manager.init();
    watcher.onChange?.(limits(3, 55));

    expect(manager.getRateLimitsForClient().claude?.five_hour?.used_percentage).toBe(55);
    expect(manager.getRateLimitsForClient().codex).toBeUndefined();
    expect(broadcast.mock.calls[0][0]).toMatchObject({ providerId: 'claude' });
  });
});

describe('StatusManager Codex hook session binding', () => {
  beforeEach(() => {
    providerOverride.byPanelType = null;
    layoutMocks.updateTabAgentSessionId.mockClear();
    layoutMocks.updateTabAgentJsonlPath.mockClear();
  });

  const makeManagerWithCodexTab = () => {
    const manager = new StatusManager({ broadcast: vi.fn(), enableRateLimits: false });
    manager.registerTab('tab-codex', {
      cliState: 'idle',
      workspaceId: 'ws-1',
      tabName: 'Codex',
      tmuxSession: 'pt-ws-1-pane-1-tab-codex',
      panelType: 'codex',
      lastEvent: null,
      eventSeq: 0,
    });
    return manager;
  };

  it('binds a Codex tab when a session-start hook reports a new session id', () => {
    const manager = makeManagerWithCodexTab();
    const sessionId = '019dcf1f-3a02-73a0-a79e-8703b99a2f30';
    const transcriptPath = `/home/test/.codex/sessions/2026/11/15/rollout-${sessionId}.jsonl`;

    manager.updateTabFromHook('pt-ws-1-pane-1-tab-codex', 'session-start', {
      agentSessionId: sessionId,
      transcriptPath,
    });

    expect(layoutMocks.updateTabAgentSessionId).toHaveBeenCalledWith(
      'pt-ws-1-pane-1-tab-codex',
      expect.objectContaining({ id: 'codex' }),
      sessionId,
    );
    expect(manager.getAllForClient()['tab-codex']?.agentSessionId).toBe(sessionId);
  });

  it('does not rebind a Codex tab on prompt-submit hooks with a different session id', () => {
    const manager = makeManagerWithCodexTab();

    manager.updateTabFromHook('pt-ws-1-pane-1-tab-codex', 'prompt-submit', {
      agentSessionId: '019dcf1f-3a02-73a0-a79e-8703b99a2f30',
      transcriptPath: '/home/test/.codex/sessions/2026/11/15/rollout-subagent.jsonl',
    });

    expect(layoutMocks.updateTabAgentSessionId).not.toHaveBeenCalled();
    expect(manager.getAllForClient()['tab-codex']?.agentSessionId).toBeUndefined();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IRateLimitsData } from '@/types/status';

const watcher = vi.hoisted(() => ({ onChange: null as ((data: IRateLimitsData) => void) | null }));

const providerOverride = vi.hoisted(() => ({ byPanelType: null as ((panelType: unknown) => unknown) | null }));

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

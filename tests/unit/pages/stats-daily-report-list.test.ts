import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IDailyReportListResponse, IStatsCache, ITokenBreakdown } from '@/types/stats';

const mocks = vi.hoisted(() => ({
  getStatsCache: vi.fn(),
  readAllCachedReports: vi.fn(async () => ({})),
}));

vi.mock('@/lib/stats/stats-cache', () => ({ getStatsCache: mocks.getStatsCache }));
vi.mock('@/lib/stats/daily-report-builder', () => ({ readAllCachedReports: mocks.readAllCachedReports }));

const OPUS = 'claude-opus-4-5-20251101';

const tokens = (input: number, output: number, cacheRead = 0): ITokenBreakdown => ({
  input,
  output,
  cacheRead,
  cacheCreation: 0,
  cacheCreation5m: 0,
  cacheCreation1h: 0,
});

const modelUsage = (breakdown: ITokenBreakdown) => ({
  inputTokens: breakdown.input,
  outputTokens: breakdown.output,
  cacheReadInputTokens: breakdown.cacheRead,
  cacheCreationInputTokens: 0,
  cacheCreation5mInputTokens: 0,
  cacheCreation1hInputTokens: 0,
  webSearchRequests: 0,
  costUSD: 0,
  contextWindow: 0,
  maxOutputTokens: 0,
});

const callList = async (): Promise<IDailyReportListResponse> => {
  const { default: handler } = await import('@/pages/api/stats/daily-report/list');
  let body: unknown;
  const res = {
    setHeader: vi.fn(() => res),
    status: vi.fn(() => res),
    json: vi.fn((value: unknown) => {
      body = value;
      return res;
    }),
  } as unknown as NextApiResponse;
  await handler({ method: 'GET', query: {} } as unknown as NextApiRequest, res);
  return body as IDailyReportListResponse;
};

describe('daily report list cost', () => {
  beforeEach(() => {
    mocks.getStatsCache.mockReset();
  });

  it('prices each day from its priced model tokens only', async () => {
    // gpt-5.5 all time: 2M input + 2M output = $70 over 4M tokens, spread by each day's share of
    // gpt-5.5 tokens (1M on 04-26, 3M on 04-27). Claude has no pricing and adds nothing.
    const cache: IStatsCache = {
      version: 5,
      lastComputedDate: '2026-04-27',
      dailyActivity: [
        { date: '2026-04-25', messageCount: 1, sessionCount: 1, toolCallCount: 0 },
        { date: '2026-04-26', messageCount: 1, sessionCount: 1, toolCallCount: 0 },
        { date: '2026-04-27', messageCount: 2, sessionCount: 2, toolCallCount: 0 },
        { date: '2026-04-28', messageCount: 1, sessionCount: 1, toolCallCount: 0 },
      ],
      dailyModelTokens: [
        { date: '2026-04-25', tokensByModel: { [OPUS]: tokens(10, 20, 50_000_000) } },
        { date: '2026-04-26', tokensByModel: { 'gpt-5.5': tokens(1_000_000, 0) } },
        { date: '2026-04-27', tokensByModel: { 'gpt-5.5': tokens(1_000_000, 2_000_000), [OPUS]: tokens(10, 20, 50_000_000) } },
      ],
      modelUsage: {
        'gpt-5.5': modelUsage(tokens(2_000_000, 2_000_000)),
        [OPUS]: modelUsage(tokens(20, 40, 100_000_000)),
      },
      totalSessions: 4,
      totalMessages: 4,
      longestSession: { sessionId: '', duration: 0, messageCount: 0, timestamp: '' },
      firstSessionDate: '2026-04-25',
      hourCounts: {},
      dayHourCounts: {},
      totalSpeculationTimeSavedMs: 0,
    };
    mocks.getStatsCache.mockResolvedValue(cache);

    const list = await callList();
    const costByDate = Object.fromEntries(list.days.map((day) => [day.date, day.cost]));

    expect(costByDate['2026-04-25']).toBeNull();
    expect(costByDate['2026-04-26']).toBeCloseTo(17.5);
    expect(costByDate['2026-04-27']).toBeCloseTo(52.5);
    // A day with sessions but no token usage keeps the old $0 instead of "no estimate".
    expect(costByDate['2026-04-28']).toBe(0);
  });
});

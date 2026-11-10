import dayjs from 'dayjs';
import type {
  IStatsCache,
  IStatsCacheDailyActivity,
  IStatsCacheDailyTokens,
  IOverviewResponse,
  TPeriod,
} from '@/types/stats';
import { isDateStringWithinPeriod } from './period-filter';
import { calculateCost, hasModelPricing } from '@/lib/model-tokens';

const estimateCostFromUsage = (
  model: string,
  input: number,
  output: number,
  cacheRead: number,
  cacheCreation5m: number,
  cacheCreation1h: number,
): number | null => calculateCost(model, input, output, cacheCreation5m, cacheCreation1h, cacheRead);

const EMPTY_CACHE: IStatsCache = {
  version: 0,
  lastComputedDate: '',
  dailyActivity: [],
  dailyModelTokens: [],
  modelUsage: {},
  totalSessions: 0,
  totalMessages: 0,
  longestSession: { sessionId: '', duration: 0, messageCount: 0, timestamp: '' },
  firstSessionDate: '',
  hourCounts: {},
  dayHourCounts: {},
  totalSpeculationTimeSavedMs: 0,
};

export const readStatsCache = async (): Promise<IStatsCache> => {
  try {
    const { getStatsCache } = await import('./stats-cache');
    return await getStatsCache();
  } catch {
    return EMPTY_CACHE;
  }
};

// Spreads each priced model's all-time cost over the given days by that model's token share, so per-day
// costs add up to the model totals. Null when none of the days has usage of a priced model.
export const estimateCostForDays = (cache: IStatsCache, days: IStatsCacheDailyTokens[]): number | null => {
  let cost: number | null = null;
  for (const day of days) {
    for (const [model, breakdown] of Object.entries(day.tokensByModel)) {
      const usage = cache.modelUsage[model];
      if (!usage) continue;
      const allTimeTotal = usage.inputTokens + usage.outputTokens
        + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
      if (allTimeTotal <= 0) continue;
      const allTimeCost = estimateCostFromUsage(
        model, usage.inputTokens, usage.outputTokens,
        usage.cacheReadInputTokens,
        usage.cacheCreation5mInputTokens,
        usage.cacheCreation1hInputTokens,
      );
      if (allTimeCost === null) continue;
      const dayTotal = breakdown.input + breakdown.output + breakdown.cacheRead + breakdown.cacheCreation;
      cost = (cost ?? 0) + allTimeCost * (dayTotal / allTimeTotal);
    }
  }
  return cost;
};

export const buildOverview = (cache: IStatsCache, period: TPeriod): IOverviewResponse => {
  const filteredDaily = cache.dailyActivity.filter((d) => isDateStringWithinPeriod(d.date, period));
  const filteredTokens = cache.dailyModelTokens.filter((d) => isDateStringWithinPeriod(d.date, period));

  const totalSessions = period === 'all'
    ? cache.totalSessions
    : filteredDaily.reduce((sum, d) => sum + d.sessionCount, 0);

  const totalMessages = period === 'all'
    ? cache.totalMessages
    : filteredDaily.reduce((sum, d) => sum + d.messageCount, 0);

  const totalToolCalls = filteredDaily.reduce((sum, d) => sum + d.toolCallCount, 0);

  const previousDaily = getPreviousPeriodDaily(cache.dailyActivity, period);
  const previousSessions = previousDaily.reduce((sum, d) => sum + d.sessionCount, 0);
  const previousMessages = previousDaily.reduce((sum, d) => sum + d.messageCount, 0);

  const modelTokens: IOverviewResponse['modelTokens'] = {};
  if (period === 'all') {
    for (const [model, usage] of Object.entries(cache.modelUsage)) {
      modelTokens[model] = {
        input: usage.inputTokens,
        output: usage.outputTokens,
        cacheRead: usage.cacheReadInputTokens,
        cacheCreation: usage.cacheCreationInputTokens,
        cacheCreation5m: usage.cacheCreation5mInputTokens,
        cacheCreation1h: usage.cacheCreation1hInputTokens,
        cost: estimateCostFromUsage(
          model,
          usage.inputTokens,
          usage.outputTokens,
          usage.cacheReadInputTokens,
          usage.cacheCreation5mInputTokens,
          usage.cacheCreation1hInputTokens,
        ),
      };
    }
  } else {
    for (const day of filteredTokens) {
      for (const [model, breakdown] of Object.entries(day.tokensByModel)) {
        if (!modelTokens[model]) {
          modelTokens[model] = {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheCreation: 0,
            cacheCreation5m: 0,
            cacheCreation1h: 0,
            cost: hasModelPricing(model) ? 0 : null,
          };
        }
        modelTokens[model].input += breakdown.input;
        modelTokens[model].output += breakdown.output;
        modelTokens[model].cacheRead += breakdown.cacheRead;
        modelTokens[model].cacheCreation += breakdown.cacheCreation;
        modelTokens[model].cacheCreation5m += breakdown.cacheCreation5m;
        modelTokens[model].cacheCreation1h += breakdown.cacheCreation1h;
      }
    }

    for (const [model, tokens] of Object.entries(modelTokens)) {
      const usage = cache.modelUsage[model];
      if (!usage) continue;
      const allTimeTotal = usage.inputTokens + usage.outputTokens
        + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
      const periodTotal = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation;
      if (allTimeTotal > 0) {
        const allTimeCost = estimateCostFromUsage(
          model,
          usage.inputTokens,
          usage.outputTokens,
          usage.cacheReadInputTokens,
          usage.cacheCreation5mInputTokens,
          usage.cacheCreation1hInputTokens,
        );
        tokens.cost = allTimeCost === null ? null : allTimeCost * (periodTotal / allTimeTotal);
      }
    }
  }

  const dailyTokens = filteredTokens.map((d) => {
    let input = 0, output = 0, cacheRead = 0, cacheCreation = 0;
    for (const breakdown of Object.values(d.tokensByModel)) {
      input += breakdown.input;
      output += breakdown.output;
      cacheRead += breakdown.cacheRead;
      cacheCreation += breakdown.cacheCreation;
    }
    return { date: d.date, input, output, cacheRead, cacheCreation };
  });

  const today = dayjs().format('YYYY-MM-DD');
  const startOfMonth = dayjs().startOf('month').format('YYYY-MM-DD');
  const todayMessages = cache.dailyActivity.find((d) => d.date === today)?.messageCount ?? 0;
  const thisMonthMessages = cache.dailyActivity
    .filter((d) => d.date >= startOfMonth)
    .reduce((sum, d) => sum + d.messageCount, 0);

  const totalCost = Object.values(modelTokens).reduce((sum, m) => sum + (m.cost ?? 0), 0);

  const todayCost = estimateCostForDays(
    cache,
    cache.dailyModelTokens.filter((d) => d.date === today),
  ) ?? 0;
  const thisMonthCost = estimateCostForDays(
    cache,
    cache.dailyModelTokens.filter((d) => d.date >= startOfMonth),
  ) ?? 0;
  const previousCost = estimateCostForDays(
    cache,
    getPreviousPeriodTokens(cache.dailyModelTokens, period),
  ) ?? 0;

  return {
    totalSessions,
    totalMessages,
    previousSessions,
    previousMessages,
    totalToolCalls,
    dailyActivity: filteredDaily,
    modelTokens,
    dailyTokens,
    todayMessages,
    thisMonthMessages,
    totalCost,
    todayCost,
    thisMonthCost,
    previousCost,
    hourlyDistribution: cache.hourCounts,
    dayHourDistribution: cache.dayHourCounts,
    firstSessionDate: cache.firstSessionDate,
    lastComputedDate: cache.lastComputedDate,
    computedAt: new Date().toISOString(),
  };
};

const getPreviousPeriodRange = (period: TPeriod): { prevStart: dayjs.Dayjs; prevEnd: dayjs.Dayjs } | null => {
  if (period === 'all' || period === 'today') return null;
  const days = period === '7d' ? 7 : 30;
  return {
    prevStart: dayjs().subtract(days * 2, 'day').startOf('day'),
    prevEnd: dayjs().subtract(days, 'day').startOf('day'),
  };
};

const isInPreviousPeriod = (dateStr: string, period: TPeriod): boolean => {
  const range = getPreviousPeriodRange(period);
  if (!range) return false;
  const date = dayjs(dateStr);
  return (date.isAfter(range.prevStart) || date.isSame(range.prevStart)) && date.isBefore(range.prevEnd);
};

const getPreviousPeriodDaily = (
  allDaily: IStatsCacheDailyActivity[],
  period: TPeriod,
): IStatsCacheDailyActivity[] => {
  return allDaily.filter((d) => isInPreviousPeriod(d.date, period));
};

const getPreviousPeriodTokens = (
  allTokens: IStatsCacheDailyTokens[],
  period: TPeriod,
): IStatsCacheDailyTokens[] => {
  return allTokens.filter((d) => isInPreviousPeriod(d.date, period));
};

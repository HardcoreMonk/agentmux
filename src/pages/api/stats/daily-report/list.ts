import type { NextApiRequest, NextApiResponse } from 'next';
import { getStatsCache } from '@/lib/stats/stats-cache';
import { estimateCostForDays } from '@/lib/stats/stats-cache-parser';
import { readAllCachedReports } from '@/lib/stats/daily-report-builder';
import type { IDailyReportListResponse, IDailyReportListItem } from '@/types/stats';

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method-not-allowed' });
  }

  const offset = Math.max(0, Number(req.query.offset) || 0);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));

  const [statsCache, reportCache] = await Promise.all([
    getStatsCache(),
    readAllCachedReports(),
  ]);

  const tokensByDate = new Map(statsCache.dailyModelTokens.map((day) => [day.date, day]));

  const allDays: IDailyReportListItem[] = statsCache.dailyActivity
    .filter((d) => d.sessionCount > 0)
    .map((d) => {
      const tokenDay = tokensByDate.get(d.date);
      return {
        date: d.date,
        sessionCount: d.sessionCount,
        cost: tokenDay ? estimateCostForDays(statsCache, [tokenDay]) : null,
        report: reportCache[d.date] ?? null,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const paged = allDays.slice(offset, offset + limit);

  const result: IDailyReportListResponse = {
    days: paged,
    total: allDays.length,
    offset,
    limit,
  };

  return res.status(200).json(result);
};

export default handler;

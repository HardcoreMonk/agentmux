import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { useTranslations } from 'next-intl';
import dayjs from 'dayjs';
import ReactMarkdown from 'react-markdown';
import { Sparkles, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import Spinner from '@/components/ui/spinner';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import useConfigStore from '@/hooks/use-config-store';
import type { IDailyReportDay, IDailyReportCacheResponse } from '@/types/stats';
import { WEEKDAY_LABELS, formatCostWithComma } from '@/components/features/stats/stats-utils';

interface IDayMeta {
  date: string;
  sessionCount: number;
  cost: number | null;
}

interface IBatchActions {
  start: () => void;
  stop: () => void;
}

interface IDailyReportSectionProps {
  days: IDayMeta[];
  cache: IDailyReportCacheResponse | null;
  onCacheUpdate: (date: string, report: IDailyReportDay) => void;
  batchActions?: IBatchActions;
  onBatchRunningChange?: (running: boolean) => void;
}

const markdownClass = 'prose prose-sm prose-invert max-w-none text-foreground/80 [&_h2]:mt-4 [&_h2]:mb-1 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:mt-2 [&_h3]:mb-0.5 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:text-foreground/80 [&_ul]:my-0.5 [&_ul]:pl-4 [&_li]:my-0 [&_li]:text-sm [&_p]:text-sm [&_p]:my-1 [&_p]:leading-relaxed';

const DailyReportSection = ({ days, cache, onCacheUpdate, batchActions, onBatchRunningChange }: IDailyReportSectionProps) => {
  const t = useTranslations('stats');
  const locale = useConfigStore((s) => s.locale);
  const [generating, setGenerating] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  const batchStopRef = useRef(false);

  const generateOne = useCallback(async (date: string, force = false) => {
    const res = await fetch('/api/stats/daily-report/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, force, locale }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'unknown error' }));
      throw new Error(err.message ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as IDailyReportDay;
  }, [locale]);

  const handleGenerate = useCallback(async (date: string, force = false) => {
    setGenerating(date);
    try {
      const report = await generateOne(date, force);
      onCacheUpdate(date, report);
      toast.success(t('summaryGenerated'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('summaryFailed'));
    } finally {
      setGenerating(null);
    }
  }, [generateOne, onCacheUpdate, t]);

  const handleBatch = useCallback(async () => {
    batchStopRef.current = false;
    setBatchRunning(true);
    let generated = 0;
    try {
      for (const day of days) {
        if (batchStopRef.current) break;
        const existing = cache?.days[day.date];
        if (existing && existing.locale === locale) continue;
        setGenerating(day.date);
        try {
          const report = await generateOne(day.date);
          onCacheUpdate(day.date, report);
          generated++;
        } catch {
          toast.error(t('summaryDateFailed', { date: day.date }));
          break;
        }
      }
    } finally {
      setGenerating(null);
      setBatchRunning(false);
      if (generated > 0) {
        toast.success(t('summaryBatchComplete', { count: generated }));
      }
    }
  }, [days, cache, generateOne, onCacheUpdate, t, locale]);

  const handleBatchStop = useCallback(() => {
    batchStopRef.current = true;
  }, []);

  const toggleExpand = useCallback((date: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }, []);

  const today = dayjs().format('YYYY-MM-DD');

  useEffect(() => {
    if (batchActions) {
      batchActions.start = handleBatch;
      batchActions.stop = handleBatchStop;
    }
  }, [batchActions, handleBatch, handleBatchStop]);

  useEffect(() => {
    onBatchRunningChange?.(batchRunning);
  }, [batchRunning, onBatchRunningChange]);

  return (
    <div className="space-y-4">
      {days.map((day) => {
        const d = dayjs(day.date);
        const weekday = WEEKDAY_LABELS[d.day()];
        const isToday = day.date === today;
        const report = cache?.days[day.date] ?? null;
        const isGenerating = generating === day.date;
        const isExpanded = expanded.has(day.date);

        return (
          <div key={day.date} className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <span className="text-base font-medium text-muted-foreground">
                  {day.date} ({weekday})
                </span>
                {isToday && (
                  <span className="rounded bg-ui-teal/15 px-1.5 py-0.5 text-[10px] font-medium text-ui-teal">
                    {t('today')}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {report && (
                  <>
                    {isGenerating && (
                      <span className="text-xs text-muted-foreground">{t('generating')}</span>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleGenerate(day.date, true)}
                      disabled={generating !== null}
                      className="text-muted-foreground"
                    >
                      <RefreshCw className={`h-3 w-3${isGenerating ? ' animate-spin' : ''}`} />
                    </Button>
                  </>
                )}
                <span className="text-xs tabular-nums text-muted-foreground">
                  {t('sessionCount', { count: day.sessionCount })} ·{' '}
                  {day.cost === null ? (
                    <span title={t('costUnavailable')} aria-label={t('costUnavailable')}>—</span>
                  ) : formatCostWithComma(day.cost)}
                </span>
              </div>
            </div>
          <Card size="sm">
            <CardContent className="space-y-2">

              {!report && !isGenerating && (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => handleGenerate(day.date)}
                  disabled={generating !== null}
                >
                  <Sparkles className="h-3 w-3" />
                  {t('summarize')}
                </Button>
              )}

              {!report && isGenerating && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner className="h-2.5 w-2.5" />
                  <span>{t('generatingSummary')}</span>
                </div>
              )}

              {report && (
                <>
                  <div className={isGenerating ? 'opacity-40' : undefined}>
                    <div className={markdownClass}>
                    <ReactMarkdown>{report.brief}</ReactMarkdown>
                  </div>
                  {report.detail && (
                    <>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => toggleExpand(day.date)}
                        className="text-muted-foreground"
                        disabled={isGenerating}
                      >
                        {isExpanded ? (
                          <><ChevronDown className="h-3 w-3" />{t('collapse')}</>
                        ) : (
                          <><ChevronRight className="h-3 w-3" />{t('showMore')}</>
                        )}
                      </Button>
                      {isExpanded && (
                        <div className="border-t pt-2">
                          <div className={markdownClass}>
                            <ReactMarkdown>{report.detail}</ReactMarkdown>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
          </div>
        );
      })}

      {days.length === 0 && (
        <p className="py-4 text-center text-xs text-muted-foreground">{t('noActivity')}</p>
      )}
    </div>
  );
};

export default memo(DailyReportSection);

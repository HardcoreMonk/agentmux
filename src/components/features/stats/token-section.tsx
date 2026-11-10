import { useMemo, memo } from 'react';
import { useTranslations } from 'next-intl';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts';
import dayjs from 'dayjs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import type { ChartConfig } from '@/components/ui/chart';
import type { IOverviewResponse } from '@/types/stats';
import { formatNumber, formatNumberWithComma, formatDate, formatAxisTick, formatCostWithComma } from '@/components/features/stats/stats-utils';
import { formatModelDisplayName, normalizeModelName } from '@/lib/model-tokens';

const pct = (value: number, total: number): string =>
  total > 0 ? `${Math.round((value / total) * 100)}%` : '0%';

interface ITokenSectionProps {
  data: IOverviewResponse;
}

const MODEL_COLOR_MAP: Record<string, string> = {
  'gpt-5.5': 'var(--ui-purple)',
  'gpt-5.4': 'var(--ui-pink)',
  'gpt-5.4-mini': 'var(--ui-coral)',
  'gpt-5.2-codex': 'var(--ui-blue)',
  'gpt-5.1-codex': 'var(--ui-teal)',
  'gpt-5-codex': 'var(--ui-amber)',
};

const getModelColor = (model: string): string => {
  const key = normalizeModelName(model);
  if (MODEL_COLOR_MAP[key]) return MODEL_COLOR_MAP[key];
  const lower = model.toLowerCase();
  if (lower.startsWith('claude')) return 'var(--ui-green)';
  if (lower.includes('mini')) return 'var(--ui-coral)';
  if (lower.includes('nano')) return 'var(--ui-teal)';
  if (lower.includes('codex')) return 'var(--ui-blue)';
  return 'var(--ui-gray)';
};

const TokenSection = ({ data }: ITokenSectionProps) => {
  const t = useTranslations('stats');

  const tokenChartConfig: ChartConfig = {
    input: { label: t('inputLabel'), color: 'var(--ui-blue)' },
    output: { label: t('outputLabel'), color: 'var(--ui-teal)' },
    cacheRead: { label: t('cacheReadLabel'), color: 'var(--ui-amber)' },
    cacheCreation: { label: t('cacheWriteLabel'), color: 'var(--ui-pink)' },
  };

  const renderTokenTooltipItem = (value: unknown, name: unknown, color: string, total: number) => {
    const label = tokenChartConfig[String(name)]?.label ?? String(name);
    return (
      <>
        <div
          className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
          style={{ background: color }}
        />
        <div className="flex flex-1 items-center justify-between gap-2 leading-none">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-mono font-medium text-foreground tabular-nums">
            {formatNumberWithComma(Number(value))} ({pct(Number(value), total)})
          </span>
        </div>
      </>
    );
  };

  const modelBarData = useMemo(() => {
    return Object.entries(data.modelTokens)
      .map(([model, tokens]) => ({
        model: formatModelDisplayName(model),
        input: tokens.input,
        output: tokens.output,
        cacheRead: tokens.cacheRead,
        cacheCreation: tokens.cacheCreation,
        total: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation,
        cost: tokens.cost,
        fill: getModelColor(model),
      }))
      .sort((a, b) => b.total - a.total);
  }, [data.modelTokens]);

  const totalCost = useMemo(() => {
    return modelBarData.reduce((sum, d) => sum + (d.cost ?? 0), 0);
  }, [modelBarData]);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">{t('tokenUsage')}</h2>

      {modelBarData.length > 0 && (
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('modelTokens')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
              <ChartContainer config={tokenChartConfig} className="aspect-auto h-48 w-full">
                <BarChart
                  data={modelBarData}
                  layout="vertical"
                  margin={{ top: 0, right: 4, bottom: 0, left: 0 }}
                >
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                  <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatNumber(v)} />
                  <YAxis type="category" dataKey="model" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={100} />
                  <ChartTooltip
                    content={<ChartTooltipContent />}
                    formatter={(value, name, item) => {
                      const d = item.payload;
                      return renderTokenTooltipItem(value, name, item.color ?? '', d.total);
                    }}
                  />
                  <Bar dataKey="input" stackId="stack" fill="var(--ui-blue)" radius={0} />
                  <Bar dataKey="output" stackId="stack" fill="var(--ui-teal)" radius={0} />
                  <Bar dataKey="cacheRead" stackId="stack" fill="var(--ui-amber)" radius={0} />
                  <Bar dataKey="cacheCreation" stackId="stack" fill="var(--ui-pink)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ChartContainer>
              <div className="flex flex-col justify-center space-y-1.5 lg:min-w-[180px]">
                {modelBarData.map((d) => (
                  <div key={d.model} className="space-y-0.5">
                    <div className="flex items-center justify-between gap-4 text-xs">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: d.fill }} />
                        <span>{d.model}</span>
                      </div>
                      {d.cost === null ? (
                        <span className="tabular-nums font-medium" title={t('costUnavailable')} aria-label={t('costUnavailable')}>—</span>
                      ) : (
                        <span className="tabular-nums font-medium">{formatCostWithComma(d.cost)}</span>
                      )}
                    </div>
                    <div className="flex gap-2 pl-4 text-[10px] text-muted-foreground/60">
                      <span>I {formatNumber(d.input)} ({pct(d.input, d.total)})</span>
                      <span>O {formatNumber(d.output)} ({pct(d.output, d.total)})</span>
                      {(d.cacheRead > 0 || d.cacheCreation > 0) && (
                        <span>C {formatNumber(d.cacheRead + d.cacheCreation)} ({pct(d.cacheRead + d.cacheCreation, d.total)})</span>
                      )}
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-4 border-t border-foreground/5 pt-1.5 text-xs font-medium">
                  <span className="text-muted-foreground">{t('total')}</span>
                  <span className="tabular-nums">{formatCostWithComma(totalCost)}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {data.dailyTokens.length > 0 && (
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('dailyTokenTrend')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={tokenChartConfig} className="aspect-auto h-48 w-full">
              <AreaChart data={data.dailyTokens} margin={{ top: 4, right: 4, bottom: 0, left: 8 }}>
                <defs>
                  <linearGradient id="fillInput" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--ui-blue)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--ui-blue)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="fillOutput" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--ui-teal)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--ui-teal)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="fillCacheRead" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--ui-amber)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--ui-amber)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="fillCacheCreation" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--ui-pink)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--ui-pink)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={formatDate}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                  width={48}
                  tickFormatter={formatAxisTick}
                />
                <ChartTooltip
                  content={<ChartTooltipContent />}
                  labelFormatter={(v) => dayjs(v).format('YYYY-MM-DD')}
                  formatter={(value, name, item) => {
                    const d = item.payload;
                    const total = d.input + d.output + d.cacheRead + d.cacheCreation;
                    return renderTokenTooltipItem(value, name, item.color ?? '', total);
                  }}
                />
                <Area
                  dataKey="input"
                  type="monotone"
                  fill="url(#fillInput)"
                  stroke="var(--ui-blue)"
                  strokeWidth={1.5}
                  stackId="1"
                />
                <Area
                  dataKey="output"
                  type="monotone"
                  fill="url(#fillOutput)"
                  stroke="var(--ui-teal)"
                  strokeWidth={1.5}
                  stackId="1"
                />
                <Area
                  dataKey="cacheRead"
                  type="monotone"
                  fill="url(#fillCacheRead)"
                  stroke="var(--ui-amber)"
                  strokeWidth={1.5}
                  stackId="1"
                />
                <Area
                  dataKey="cacheCreation"
                  type="monotone"
                  fill="url(#fillCacheCreation)"
                  stroke="var(--ui-pink)"
                  strokeWidth={1.5}
                  stackId="1"
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}
    </section>
  );
};

export default memo(TokenSection);

import { useEffect, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import dayjs from 'dayjs';
import { useTranslations } from 'next-intl';
import { Controller, useForm } from 'react-hook-form';
import { AlertTriangle, Pin, RefreshCw, Search } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import AgentProviderIcon from '@/components/icons/agent-provider-icon';
import { AGENT_PANEL_TYPES } from '@/lib/panel-type';
import { AGENT_PROVIDER_META, getAgentProviderMeta } from '@/lib/agent-provider-meta';
import { cn } from '@/lib/utils';
import type { TAgentPanelType } from '@/types/terminal';
import type {
  ISavedSessionFilter,
  ISessionSearchPage,
  ISessionSearchQuery,
  TSessionRelationship,
} from '@/lib/session-catalog/contracts';
import type { IRuntimeSessionCatalogHealth } from '@/lib/runtime/contracts';

const searchFormSchema = z.object({
  query: z.string().max(512),
  models: z.string().max(400),
  projects: z.string().max(800),
  tags: z.string().max(800),
  dateFrom: z.string(),
  dateTo: z.string(),
  pinned: z.boolean(),
  provider: z.enum(['all', ...AGENT_PANEL_TYPES]),
});

type TSearchForm = z.infer<typeof searchFormSchema>;

interface ISessionExplorerProps {
  query: ISessionSearchQuery;
  page: ISessionSearchPage;
  health: IRuntimeSessionCatalogHealth | null;
  savedFilters?: ISavedSessionFilter[];
  loading: boolean;
  error: string | null;
  selectedIndex: number;
  onQueryChange: (query: ISessionSearchQuery) => void;
  onSearch: (query: ISessionSearchQuery) => void | Promise<void>;
  onLoadMore?: () => void | Promise<void>;
  onSelectIndex: (index: number) => void;
  onOpenSession: (sessionId: string) => void;
  onTogglePin: (sessionId: string) => void | Promise<void>;
  onUpdateTags?: (sessionId: string, tags: string[]) => void | Promise<void>;
  onRebuild: () => void | Promise<void>;
  onApplySavedFilter?: (filter: ISavedSessionFilter) => void;
  onSaveFilter?: (name: string) => void | Promise<void>;
  onDeleteFilter?: (id: string) => void | Promise<void>;
}

const splitList = (value: string): string[] | undefined => {
  const values = [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
  return values.length > 0 ? values : undefined;
};

const PROVIDER_FILTERS = ['all', ...AGENT_PANEL_TYPES] as const;

// A single provider selects it; none or both means no provider filter.
const providerFilterValue = (providers?: TAgentPanelType[]): TSearchForm['provider'] =>
  providers?.length === 1 ? providers[0] : 'all';

const toDateStart = (value: string): string | undefined => value ? `${value}T00:00:00.000Z` : undefined;
const toDateEnd = (value: string): string | undefined => value ? `${value}T23:59:59.999Z` : undefined;

export const getNextSessionResultIndex = (
  current: number,
  key: string,
  count: number,
): number => {
  if (count === 0 || (key !== 'ArrowDown' && key !== 'ArrowUp')) return current;
  if (key === 'ArrowDown') return current < 0 ? 0 : (current + 1) % count;
  return current <= 0 ? count - 1 : current - 1;
};

const relationshipKey = (relationship?: TSessionRelationship): string => {
  if (!relationship) return 'unknown';
  return relationship;
};

const TagsEditor = ({
  sessionId,
  tags,
  label,
  onUpdate,
}: {
  sessionId: string;
  tags: string[];
  label: string;
  onUpdate?: (sessionId: string, tags: string[]) => void | Promise<void>;
}) => {
  if (!onUpdate) return null;
  return (
    <Input
      key={`${sessionId}:${tags.join(',')}`}
      defaultValue={tags.join(', ')}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        void onUpdate(sessionId, splitList(event.currentTarget.value) ?? []);
      }}
      onClick={(event) => event.stopPropagation()}
      aria-label={label}
      className="h-8 min-w-28 max-w-52 text-xs"
    />
  );
};

const SessionExplorer = ({
  query,
  page,
  health,
  savedFilters = [],
  loading,
  error,
  selectedIndex,
  onQueryChange,
  onSearch,
  onLoadMore,
  onSelectIndex,
  onOpenSession,
  onTogglePin,
  onUpdateTags,
  onRebuild,
  onApplySavedFilter,
  onSaveFilter,
  onDeleteFilter,
}: ISessionExplorerProps) => {
  const t = useTranslations('sessionExplorer');
  const listRef = useRef<HTMLDivElement>(null);
  const [filterName, setFilterName] = useState('');
  const form = useForm<TSearchForm>({
    resolver: zodResolver(searchFormSchema),
    defaultValues: {
      query: query.query,
      models: query.models?.join(', ') ?? '',
      projects: query.projects?.join(', ') ?? '',
      tags: query.tags?.join(', ') ?? '',
      dateFrom: query.dateFrom?.slice(0, 10) ?? '',
      dateTo: query.dateTo?.slice(0, 10) ?? '',
      pinned: query.pinned ?? false,
      provider: providerFilterValue(query.providers),
    },
  });

  useEffect(() => {
    const selected = listRef.current?.querySelector<HTMLElement>(`[data-result-index="${selectedIndex}"]`);
    selected?.focus();
  }, [selectedIndex]);

  const submit = form.handleSubmit((values) => {
    const next: ISessionSearchQuery = {
      query: values.query,
      models: splitList(values.models),
      projects: splitList(values.projects),
      tags: splitList(values.tags),
      providers: values.provider === 'all' ? undefined : [values.provider],
      pinned: values.pinned ? true : undefined,
      dateFrom: toDateStart(values.dateFrom),
      dateTo: toDateEnd(values.dateTo),
      limit: query.limit ?? 50,
    };
    onQueryChange(next);
    void onSearch(next);
  });

  const degraded = error !== null || health?.state === 'degraded' || page.health === 'degraded';

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-agent-active" />
          <h1 className="text-sm font-semibold">{t('title')}</h1>
          <span className={cn(
            'rounded px-2 py-0.5 text-[11px] font-medium',
            degraded ? 'bg-destructive/10 text-destructive' : 'bg-agent-active/10 text-agent-active',
          )}>
            {t(`health.${health?.state ?? page.health}`)}
          </span>
        </div>
        <div className="text-right text-[11px] text-muted-foreground">
          <div>{t('indexedSessions', { count: health?.indexedSessions ?? page.total })}</div>
          <div>{t('lastIndexed', {
            time: health?.lastIndexedAt ? dayjs(health.lastIndexedAt).format('YYYY-MM-DD HH:mm') : t('never'),
          })}</div>
        </div>
      </header>

      <form onSubmit={submit} className="grid shrink-0 gap-2 border-b bg-muted/20 p-3 md:grid-cols-12">
        <Input {...form.register('query')} aria-label={t('query')} placeholder={t('queryPlaceholder')} className="min-h-11 md:col-span-4" />
        <Input {...form.register('models')} aria-label={t('model')} placeholder={t('model')} className="min-h-11 md:col-span-2" />
        <Input {...form.register('projects')} aria-label={t('project')} placeholder={t('project')} className="min-h-11 md:col-span-2" />
        <Input {...form.register('tags')} aria-label={t('tags')} placeholder={t('tags')} className="min-h-11 md:col-span-2" />
        <Button type="submit" className="min-h-11 md:col-span-2" disabled={loading}>{t('search')}</Button>
        <Controller
          name="provider"
          control={form.control}
          render={({ field }) => (
            <div role="group" aria-label={t('providerFilter.label')} className="flex gap-1 md:col-span-12">
              {PROVIDER_FILTERS.map((option) => {
                const selected = field.value === option;
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={selected}
                    data-filter={option}
                    onClick={() => {
                      field.onChange(option);
                      void submit();
                    }}
                    className={cn(
                      'inline-flex min-h-11 min-w-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 text-sm [word-break:keep-all] transition-colors md:max-w-40',
                      'hover:bg-agent-active/5 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                      selected
                        ? 'border-agent-active bg-agent-active/10 font-medium text-foreground'
                        : 'border-border text-muted-foreground',
                    )}
                  >
                    {option !== 'all' && <AgentProviderIcon panelType={option} className="h-3.5 w-3.5 shrink-0" />}
                    {option === 'all' ? t('providerFilter.all') : AGENT_PROVIDER_META[option].label}
                  </button>
                );
              })}
            </div>
          )}
        />
        <Input {...form.register('dateFrom')} type="date" aria-label={t('dateFrom')} className="min-h-11 md:col-span-2" />
        <Input {...form.register('dateTo')} type="date" aria-label={t('dateTo')} className="min-h-11 md:col-span-2" />
        <label className="flex min-h-11 items-center gap-2 rounded-md border px-3 text-xs md:col-span-2">
          <Controller
            name="pinned"
            control={form.control}
            render={({ field }) => (
              <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} />
            )}
          />
          {t('pinnedOnly')}
        </label>
        <div className="flex min-h-11 items-center gap-2 md:col-span-6">
          <select
            aria-label={t('savedFilters')}
            className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            defaultValue=""
            onChange={(event) => {
              const filter = savedFilters.find((candidate) => candidate.id === event.target.value);
              if (filter) onApplySavedFilter?.(filter);
            }}
          >
            <option value="">{t('savedFilters')}</option>
            {savedFilters.map((filter) => <option key={filter.id} value={filter.id}>{filter.name}</option>)}
          </select>
          {onSaveFilter && (
            <>
              <Input value={filterName} onChange={(event) => setFilterName(event.target.value)} aria-label={t('filterName')} placeholder={t('filterName')} className="h-9 max-w-44 text-xs" />
              <Button type="button" variant="outline" size="sm" onClick={() => {
                if (!filterName.trim()) return;
                void onSaveFilter(filterName.trim());
                setFilterName('');
              }}>{t('saveFilter')}</Button>
            </>
          )}
          {onDeleteFilter && savedFilters.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => void onDeleteFilter(savedFilters[0].id)}>{t('deleteFilter')}</Button>
          )}
        </div>
      </form>

      {degraded && (
        <div className="flex flex-wrap items-center gap-3 border-b border-destructive/20 bg-destructive/5 px-4 py-3 text-xs">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">{t('degradedTitle')}</div>
            <div className="text-muted-foreground">{t('rebuildSafety')}</div>
          </div>
          <AlertDialog>
            <AlertDialogTrigger render={<Button type="button" variant="outline" size="sm" className="min-h-11" />}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t('rebuild')}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('rebuildTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('rebuildSafety')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={() => void onRebuild()}>{t('rebuild')}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      <div
        ref={listRef}
        role="listbox"
        aria-label={t('results')}
        className="min-h-0 flex-1 overflow-y-auto p-2"
        onKeyDown={(event) => {
          if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'option') return;
          const next = getNextSessionResultIndex(selectedIndex, event.key, page.results.length);
          if (next !== selectedIndex) {
            event.preventDefault();
            onSelectIndex(next);
          } else if (event.key === 'Enter' && selectedIndex >= 0) {
            event.preventDefault();
            onOpenSession(page.results[selectedIndex].entry.sessionId);
          }
        }}
      >
        {loading && page.results.length === 0 && <div className="p-8 text-center text-xs text-muted-foreground">{t('loading')}</div>}
        {!loading && page.results.length === 0 && <div className="p-8 text-center text-xs text-muted-foreground">{t('empty')}</div>}
        {page.results.map((result, index) => (
          <div
            key={result.entry.sessionId}
            role="option"
            aria-selected={selectedIndex === index}
            data-result-index={index}
            tabIndex={selectedIndex === index ? 0 : -1}
            className={cn(
              'relative mb-1 flex min-h-11 w-full items-start gap-3 rounded-md border px-3 py-2 pl-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selectedIndex === index ? 'border-border bg-accent/70 text-foreground shadow-sm' : 'hover:bg-muted/50',
            )}
            onFocus={() => onSelectIndex(index)}
            onClick={() => {
              onSelectIndex(index);
              onOpenSession(result.entry.sessionId);
            }}
          >
            {selectedIndex === index && (
              <span
                aria-hidden="true"
                data-selection-marker="true"
                className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-focus-indicator"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">{result.entry.projectLabel}</span>
                {getAgentProviderMeta(result.entry.provider) && (
                  <span
                    data-provider={result.entry.provider}
                    title={t('providerBadge', { agent: AGENT_PROVIDER_META[result.entry.provider].label })}
                    className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 [word-break:keep-all]"
                  >
                    <AgentProviderIcon panelType={result.entry.provider} className="h-3 w-3 shrink-0" />
                    {AGENT_PROVIDER_META[result.entry.provider].label}
                  </span>
                )}
                {result.entry.model && <span>{result.entry.model}</span>}
                <span className="rounded bg-muted px-1.5 py-0.5">{t(`relationship.${relationshipKey(result.entry.relationship)}`)}</span>
                <span>{dayjs(result.entry.lastActivityAt).format('YYYY-MM-DD HH:mm')}</span>
                <span>{t('turns', { count: result.entry.turnCount })}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-5">{result.snippet || t('noSnippet')}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {result.annotation?.tags.map((tag) => <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{tag}</span>)}
                <TagsEditor
                  sessionId={result.entry.sessionId}
                  tags={result.annotation?.tags ?? []}
                  label={t('editTags')}
                  onUpdate={onUpdateTags}
                />
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn('min-h-11 min-w-11', result.annotation?.pinned && 'text-agent-active')}
              aria-label={result.annotation?.pinned ? t('unpin') : t('pin')}
              onClick={(event) => {
                event.stopPropagation();
                void onTogglePin(result.entry.sessionId);
              }}
            >
              <Pin className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        {page.nextCursor && onLoadMore && (
          <div className="flex justify-center py-3">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => void onLoadMore()}>{t('loadMore')}</Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SessionExplorer;

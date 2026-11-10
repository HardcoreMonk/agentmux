import { type ReactNode, useCallback, useRef } from 'react';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Spinner from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import SessionListItem from '@/components/features/workspace/session-list-item';
import AgentProviderIcon from '@/components/icons/agent-provider-icon';
import { AGENT_PANEL_TYPES } from '@/lib/panel-type';
import { AGENT_PROVIDER_META } from '@/lib/agent-provider-meta';
import { cn } from '@/lib/utils';
import type { TSessionProviderFilter } from '@/hooks/use-session-provider-filter';
import type { ISessionMeta } from '@/types/timeline';

interface ISessionListViewProps {
  sessions: ISessionMeta[];
  total: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  resumingSessionId: string | null;
  onSelectSession: (session: ISessionMeta) => void;
  onRefresh: () => Promise<void>;
  onLoadMore: () => Promise<void>;
  onNewSession?: () => void;
  emptyView?: ReactNode;
  providerFilter?: TSessionProviderFilter;
  onProviderFilterChange?: (filter: TSessionProviderFilter) => void;
}

const SessionListSkeleton = () => (
  <div className="flex flex-col">
    {[1, 2, 3].map((i) => (
      <div key={i} className="border-b border-border/50 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="h-3.5 w-24 animate-pulse rounded bg-muted" />
          <div className="h-3.5 w-16 animate-pulse rounded bg-muted" />
        </div>
        <div className="mt-2 flex items-center justify-between pl-[18px]">
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="h-3.5 w-8 animate-pulse rounded bg-muted" />
        </div>
      </div>
    ))}
  </div>
);

const SessionListError = ({
  error,
  retryLabel,
  onRetry,
}: {
  error: string;
  retryLabel: string;
  onRetry: () => void;
}) => (
  <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
    <p className="text-sm">{error}</p>
    <Button variant="outline" size="sm" onClick={onRetry}>
      {retryLabel}
    </Button>
  </div>
);

const PROVIDER_FILTERS: readonly TSessionProviderFilter[] = ['all', ...AGENT_PANEL_TYPES];

const SessionProviderFilter = ({
  value,
  onChange,
}: {
  value: TSessionProviderFilter;
  onChange: (filter: TSessionProviderFilter) => void;
}) => {
  const t = useTranslations('session');
  return (
    <div role="group" aria-label={t('providerFilter.label')} className="flex gap-1 border-b px-4 py-2">
      {PROVIDER_FILTERS.map((option) => {
        const selected = value === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            data-filter={option}
            onClick={() => onChange(option)}
            className={cn(
              'inline-flex min-h-11 min-w-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 text-sm [word-break:keep-all] transition-colors',
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
  );
};

const SessionListView = ({
  sessions,
  total,
  isLoading,
  isLoadingMore,
  hasMore,
  error,
  resumingSessionId,
  onSelectSession,
  onRefresh,
  onLoadMore,
  onNewSession,
  emptyView,
  providerFilter,
  onProviderFilterChange,
}: ISessionListViewProps) => {
  const t = useTranslations('terminal');
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleRefresh = useCallback(async () => {
    await onRefresh();
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [onRefresh]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMore || isLoadingMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
      onLoadMore();
    }
  }, [hasMore, isLoadingMore, onLoadMore]);

  const isResumeInProgress = !!resumingSessionId;
  const sessionCountLabel = total > 0 ? `(${total})` : '';

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">
            {t('sessions')}
            {sessionCountLabel}
          </span>
          {onNewSession && (
            <Button
              variant="outline"
              size="sm"
              onClick={onNewSession}
            >
              <Plus size={12} />
              {t('newConversation')}
            </Button>
          )}
        </div>
      </div>

      {providerFilter && onProviderFilterChange && (
        <SessionProviderFilter value={providerFilter} onChange={onProviderFilterChange} />
      )}

      {isLoading && sessions.length === 0 ? (
        <SessionListSkeleton />
      ) : error ? (
        <SessionListError error={error} retryLabel={t('retryLoad')} onRetry={handleRefresh} />
      ) : (
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto"
          onScroll={handleScroll}
        >
          {sessions.length === 0 && emptyView ? (
            <div className="h-full">{emptyView}</div>
          ) : (
            sessions.map((session) => (
              <SessionListItem
                key={`${session.sessionId}:${session.jsonlPath ?? ''}`}
                session={session}
                isResuming={session.sessionId === resumingSessionId}
                isDisabled={isResumeInProgress}
                onSelect={onSelectSession}
              />
            ))
          )}
          {isLoadingMore && (
            <div className="flex items-center justify-center py-3">
              <Spinner size={14} className="text-muted-foreground" />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SessionListView;

import { memo } from 'react';
import { useTranslations } from 'next-intl';
import dayjs from 'dayjs';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import AgentProviderIcon from '@/components/icons/agent-provider-icon';
import { getAgentProviderMeta } from '@/lib/agent-provider-meta';
import { SessionRelationshipBadge } from '@/components/features/workspace/session-relationship-indicator';

import type { ISessionMeta } from '@/types/timeline';

interface ISessionListItemProps {
  session: ISessionMeta;
  isResuming: boolean;
  isDisabled: boolean;
  onSelect: (session: ISessionMeta) => void;
}

const handleArrowNavigation = (e: React.KeyboardEvent<HTMLButtonElement>) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const next = e.currentTarget.nextElementSibling as HTMLElement | null;
    next?.focus();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    const prev = e.currentTarget.previousElementSibling as HTMLElement | null;
    prev?.focus();
  }
};

const formatRelativeTime = (dateStr: string, t: ReturnType<typeof useTranslations>): string => {
  const now = dayjs();
  const target = dayjs(dateStr);
  const diffMinutes = now.diff(target, 'minute');

  if (diffMinutes < 1) return t('justNow');
  if (diffMinutes < 60) return t('minutesAgo', { count: diffMinutes });

  const diffHours = now.diff(target, 'hour');
  if (diffHours < 24) return t('hoursAgo', { count: diffHours });

  const diffDays = now.diff(target, 'day');
  if (diffDays === 1) return t('yesterday');
  if (diffDays < 7) return t('daysAgo', { count: diffDays });

  const diffWeeks = now.diff(target, 'week');
  if (diffWeeks < 4) return t('weeksAgo', { count: diffWeeks });

  const diffMonths = now.diff(target, 'month');
  if (diffMonths < 12) return t('monthsAgo', { count: diffMonths });

  return t('yearsAgo', { count: now.diff(target, 'year') });
};

const SessionListItem = ({
  session,
  isResuming,
  isDisabled,
  onSelect,
}: ISessionListItemProps) => {
  const t = useTranslations('session');
  const absoluteTime = dayjs(session.lastActivityAt).format('MM/DD HH:mm');
  const relativeTime = formatRelativeTime(session.lastActivityAt, t);
  const displayMessage = session.firstMessage || t('noMessage');
  const providerLabel = getAgentProviderMeta(session.providerId)?.label;

  return (
    <button
      type="button"
      className={cn(
        'min-h-11 w-full cursor-pointer border-b border-border/50 py-3 pl-1 pr-4 text-left transition-colors hover:bg-agent-active/5 focus-visible:bg-agent-active/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        isDisabled && !isResuming && 'pointer-events-none opacity-50',
        isResuming && 'bg-agent-active/5',
      )}
      onClick={() => onSelect(session)}
      onKeyDown={handleArrowNavigation}
      disabled={isDisabled}
      aria-label={t('sessionLabel', { message: displayMessage })}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs">
          {isResuming ? (
            <Loader2
              size={14}
              className="shrink-0 animate-spin text-agent-active"
            />
          ) : (
            <span className="inline-block h-1.5 w-1.5 shrink-0" />
          )}
          <span className="text-muted-foreground">
            {absoluteTime}
          </span>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {relativeTime}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 pl-[12px]">
        <span className="min-w-0 truncate text-sm font-medium text-left">
          {displayMessage}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {session.providerId && providerLabel && (
            <span
              data-provider={session.providerId}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground"
              title={t('providerBadge', { agent: providerLabel })}
            >
              <AgentProviderIcon panelType={session.providerId} className="h-3 w-3 shrink-0" />
              {providerLabel}
            </span>
          )}
          <SessionRelationshipBadge relationship={session.relationship} />
          <span className="text-xs text-muted-foreground">
            {t('turnCount', { count: session.turnCount })}
          </span>
        </div>
      </div>
    </button>
  );
};

export default memo(SessionListItem);

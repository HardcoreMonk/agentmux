import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  Braces,
  ChevronRight,
  FileDiff,
  Globe,
  PackageSearch,
  TerminalSquare,
} from 'lucide-react';
import type { ITimelineRichDetails, TToolStatus } from '@/types/timeline';
import {
  getRichTimelinePresentation,
  type TRichTimelineEntry,
  type TRichTimelineIcon,
} from '@/lib/rich-timeline-presentation';
import { cn } from '@/lib/utils';
import { getAgentLabel } from '@/lib/agent-provider-meta';
import type { TPanelType } from '@/types/terminal';

const icons: Record<TRichTimelineIcon, typeof TerminalSquare> = {
  terminal: TerminalSquare,
  web: Globe,
  package: PackageSearch,
  diff: FileDiff,
  warning: AlertTriangle,
  braces: Braces,
};

const statusClass = (status: TToolStatus): string => {
  if (status === 'error') return 'text-ui-red';
  if (status === 'success') return 'text-ui-teal';
  return 'text-ui-amber';
};

const RichDetails = ({ details }: { details: ITimelineRichDetails }) => {
  const t = useTranslations('timeline');
  return (
    <details className="group mt-1.5">
      <summary className="flex min-h-7 cursor-pointer list-none items-center gap-1 text-[11px] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
        {t('richDetails')}
        {details.truncated && <span className="opacity-60">· {t('richTruncated')}</span>}
      </summary>
      <div className="mt-1 space-y-2 border-l border-border/60 pl-3">
        {Object.entries(details.fields).map(([label, value]) => (
          <div key={label} className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
              {label}
            </div>
            <pre className="mt-0.5 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-4 text-foreground/80">
              {value}
            </pre>
          </div>
        ))}
      </div>
    </details>
  );
};

const RichTimelineItem = ({ entry, panelType }: { entry: TRichTimelineEntry; panelType?: TPanelType }) => {
  const t = useTranslations('timeline');
  const presentation = getRichTimelinePresentation(entry);
  const Icon = icons[presentation.icon];
  const details = 'details' in entry ? entry.details : undefined;

  return (
    <div className="min-w-0 py-0.5 text-xs">
      <div className="flex min-w-0 items-start gap-2">
        <Icon size={13} className={cn('mt-0.5 shrink-0', statusClass(presentation.status))} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 font-medium text-foreground/80">{t(presentation.label, { agent: getAgentLabel(panelType) })}</span>
            <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
              {presentation.summary}
            </span>
            {presentation.meta && (
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">
                {presentation.meta}
              </span>
            )}
          </div>
          {details && <RichDetails details={details} />}
        </div>
      </div>
    </div>
  );
};

export default RichTimelineItem;

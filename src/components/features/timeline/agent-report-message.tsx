import { memo, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Inbox } from 'lucide-react';
import { parseAgentReportHeader } from '@/lib/agent-report';
import { cn } from '@/lib/utils';

interface IAgentReportMessageProps {
  text: string;
}

const AgentReportMessage = ({ text }: IAgentReportMessageProps) => {
  const t = useTranslations('timeline');
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const textRef = useRef<HTMLParagraphElement | null>(null);

  const parsed = parseAgentReportHeader(text);
  const newlineIdx = text.indexOf('\n');
  const body = parsed
    ? newlineIdx >= 0
      ? text.slice(newlineIdx + 1)
      : ''
    : text;

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollHeight - el.clientHeight > 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [body, expanded]);

  const hasText = body.length > 0;
  const clamp = !expanded;
  const showToggle = overflowing || expanded;

  return (
    <div className="animate-in fade-in duration-150">
      <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Inbox size={14} className="shrink-0" />
          <span className="[word-break:keep-all]">{t('agentReport')}</span>
          {parsed && (
            <>
              <span className="text-foreground">{parsed.childLabel}</span>
              {parsed.event === 'blocked' ? (
                <span className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-ui-amber [word-break:keep-all]">
                  <AlertTriangle size={12} className="shrink-0" />
                  <span>{t('agentReportBlocked')}</span>
                </span>
              ) : (
                <span className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-positive [word-break:keep-all]">
                  <CheckCircle2 size={12} className="shrink-0" />
                  <span>{t('agentReportDone')}</span>
                </span>
              )}
            </>
          )}
        </div>
        {hasText && (
          <p
            ref={textRef}
            className={cn('text-sm whitespace-pre-wrap break-words', clamp && 'line-clamp-6')}
          >
            {body}
          </p>
        )}
        {hasText && showToggle && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs mt-1.5 text-muted-foreground hover:underline"
          >
            {expanded ? '접기' : '더보기'}
          </button>
        )}
      </div>
    </div>
  );
};

export default memo(AgentReportMessage);

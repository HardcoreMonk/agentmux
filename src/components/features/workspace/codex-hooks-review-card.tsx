import { useState } from 'react';
import { Loader2, ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { codexHooksReviewKeys, type ICodexHooksReviewInfo, type TCodexHooksAnswer } from '@/lib/codex-screen';

interface ICodexHooksReviewCardProps {
  info: ICodexHooksReviewInfo;
  hookCount: number;
  fingerprintTrusted: boolean;
  onRespond: (answer: TCodexHooksAnswer) => void;
}

const BUTTON_CLASS = 'flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border/50 px-3 py-2 text-sm font-medium transition-colors hover:border-ui-amber/30 hover:bg-ui-amber/5 active:bg-ui-amber/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-amber/60 disabled:opacity-50 [word-break:keep-all]';

const CodexHooksReviewCard = ({ info, hookCount, fingerprintTrusted, onRespond }: ICodexHooksReviewCardProps) => {
  const t = useTranslations('terminal');
  const [sending, setSending] = useState<TCodexHooksAnswer | null>(null);

  const handle = (answer: TCodexHooksAnswer) => {
    if (sending) return;
    setSending(answer);
    onRespond(answer);
  };

  const canTrust = info.changedCount === hookCount
    && !fingerprintTrusted
    && codexHooksReviewKeys(info, 'trust') !== null;

  return (
    <div className="w-full max-w-md rounded-lg border border-ui-amber/20 bg-card px-4 py-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-ui-amber [word-break:keep-all]">
        <ShieldAlert size={14} />
        <span>{t('codexHooksTitle')}</span>
      </div>
      {info.trusting ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground [word-break:keep-all]">
          <Loader2 size={14} className="animate-spin" />
          <span>{t('codexHooksTrusting')}</span>
        </div>
      ) : (
        <>
          {info.changedCount !== null && (
            <p className="mb-1 text-sm text-foreground [word-break:keep-all]">
              {t('codexHooksChanged', { count: info.changedCount })}
            </p>
          )}
          <p className="mb-3 text-xs text-muted-foreground [word-break:keep-all]">
            {canTrust ? t('codexHooksTrustDescription') : t('codexHooksReviewOutside')}
          </p>
          <div className="flex flex-col gap-1.5">
            {canTrust && (
              <button type="button" disabled={sending !== null} onClick={() => handle('trust')} className={BUTTON_CLASS}>
                <ShieldCheck size={14} />
                <span>{t('codexHooksTrustButton')}</span>
              </button>
            )}
            <button type="button" disabled={sending !== null} onClick={() => handle('skip')} className={BUTTON_CLASS}>
              <ShieldOff size={14} />
              <span>{t('codexHooksSkipButton')}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default CodexHooksReviewCard;

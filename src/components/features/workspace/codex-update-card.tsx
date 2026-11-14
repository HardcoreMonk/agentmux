import { useState } from 'react';
import { CircleAlert, CircleCheck, Download, Loader2, RotateCw, SkipForward } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ICodexUpdatePromptInfo, TCodexUpdateAnswer } from '@/lib/codex-screen';

interface ICodexUpdateCardProps {
  info: ICodexUpdatePromptInfo;
  onRespond: (answer: TCodexUpdateAnswer) => void;
  onRestart: () => void;
}

const BUTTON_CLASS = 'flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border/50 px-3 py-2 text-sm font-medium transition-colors hover:border-ui-amber/30 hover:bg-ui-amber/5 active:bg-ui-amber/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-amber/60 disabled:opacity-50 [word-break:keep-all]';

const CodexUpdateCard = ({ info, onRespond, onRestart }: ICodexUpdateCardProps) => {
  const t = useTranslations('terminal');
  const [sending, setSending] = useState<TCodexUpdateAnswer | null>(null);
  const [restarting, setRestarting] = useState(false);

  const handle = (answer: TCodexUpdateAnswer) => {
    if (sending) return;
    setSending(answer);
    onRespond(answer);
  };

  const handleRestart = () => {
    if (restarting) return;
    setRestarting(true);
    onRestart();
  };

  const title = info.currentVersion && info.latestVersion
    ? t('codexUpdateTitle', { current: info.currentVersion, latest: info.latestVersion })
    : t('codexUpdateTitleNoVersion');

  return (
    <div className="w-full max-w-md rounded-lg border border-ui-amber/20 bg-card px-4 py-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-ui-amber [word-break:keep-all]">
        <Download size={14} />
        <span>{title}</span>
      </div>
      {info.status === 'prompt' && (
        <>
          {info.updateCommand && (
            <div className="mb-3 break-all rounded bg-background/50 px-2 py-1.5 font-mono text-xs text-foreground">
              {info.updateCommand}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <button type="button" disabled={sending !== null} onClick={() => handle('update')} className={BUTTON_CLASS}>
              <Download size={14} />
              <span>{t('codexUpdateNow')}</span>
            </button>
            <button type="button" disabled={sending !== null} onClick={() => handle('skip')} className={BUTTON_CLASS}>
              <SkipForward size={14} />
              <span>{t('codexUpdateSkip')}</span>
            </button>
            <button type="button" disabled={sending !== null} onClick={() => handle('skip-version')} className={BUTTON_CLASS}>
              <SkipForward size={14} />
              <span>{t('codexUpdateSkipVersion')}</span>
            </button>
          </div>
        </>
      )}
      {info.status === 'updating' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground [word-break:keep-all]">
          <Loader2 size={14} className="animate-spin" />
          <span>{t('codexUpdating')}</span>
        </div>
      )}
      {(info.status === 'success' || info.status === 'failed') && (
        <>
          <div className="mb-3 flex items-start gap-2 text-sm text-foreground [word-break:keep-all]">
            {info.status === 'success' ? <CircleCheck size={14} className="mt-0.5 shrink-0" /> : <CircleAlert size={14} className="mt-0.5 shrink-0" />}
            <span>{info.status === 'success' ? t('codexUpdateSuccess') : t('codexUpdateFailed')}</span>
          </div>
          <button type="button" disabled={restarting} onClick={handleRestart} className={BUTTON_CLASS}>
            <RotateCw size={14} />
            <span>{t('codexUpdateRestart')}</span>
          </button>
        </>
      )}
    </div>
  );
};

export default CodexUpdateCard;

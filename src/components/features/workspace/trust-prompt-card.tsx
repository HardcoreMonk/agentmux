import { useState } from 'react';
import { LogOut, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { TTrustAnswer } from '@/lib/trust-prompt-detector';

interface ITrustPromptCardProps {
  folderPath: string | null;
  onRespond: (answer: TTrustAnswer) => void;
}

const BUTTON_CLASS = 'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-border/50 px-3 py-2 text-sm font-medium transition-colors hover:border-ui-amber/30 hover:bg-ui-amber/5 active:bg-ui-amber/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-amber/60 disabled:opacity-50 [word-break:keep-all]';

const TrustPromptCard = ({ folderPath, onRespond }: ITrustPromptCardProps) => {
  const t = useTranslations('terminal');
  const [sending, setSending] = useState<TTrustAnswer | null>(null);

  const handle = (answer: TTrustAnswer) => {
    if (sending) return;
    setSending(answer);
    onRespond(answer);
  };

  return (
    <div className="w-full max-w-md rounded-lg border border-ui-amber/20 bg-card px-4 py-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-ui-amber [word-break:keep-all]">
        <ShieldCheck size={14} />
        <span>{t('trustPromptTitle')}</span>
      </div>
      {folderPath && (
        <div className="mb-3 break-all rounded bg-background/50 px-2 py-1.5 font-mono text-xs text-foreground">
          {folderPath}
        </div>
      )}
      <div className="flex gap-1.5">
        <button type="button" disabled={sending !== null} onClick={() => handle('yes')} className={BUTTON_CLASS}>
          <ShieldCheck size={14} />
          <span>{t('trustPromptTrust')}</span>
        </button>
        <button type="button" disabled={sending !== null} onClick={() => handle('no')} className={BUTTON_CLASS}>
          <LogOut size={14} />
          <span>{t('trustPromptExit')}</span>
        </button>
      </div>
    </div>
  );
};

export default TrustPromptCard;

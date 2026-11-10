import { useTranslations } from 'next-intl';
import { MessageSquare, Plus, X } from 'lucide-react';
import { getAgentLabel } from '@/lib/agent-provider-meta';
import type { TPanelType } from '@/types/terminal';
import { Button } from '@/components/ui/button';

interface ISessionEmptyViewProps {
  onClose?: () => void;
  onNewSession?: () => void;
  panelType?: TPanelType;
}

const SessionEmptyView = ({ onClose, onNewSession, panelType }: ISessionEmptyViewProps) => {
  const t = useTranslations('session.empty');

  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      {onClose && (
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-2 right-2 h-7 w-7 p-0 text-muted-foreground"
          onClick={onClose}
          aria-label={t('closeLabel')}
        >
          <X size={14} />
        </Button>
      )}
      <MessageSquare size={32} className="opacity-50" />
      <div className="text-center">
        <p className="text-sm font-medium">{t('noSession')}</p>
        <p className="mt-1 text-xs opacity-70">
          {t('startNewSession', { br: '\n', agent: getAgentLabel(panelType) }).split('\n').map((line, i) => (
            <span key={i}>{i > 0 && <br />}{line}</span>
          ))}
        </p>
      </div>
      <div className="flex gap-2">
        {onNewSession && (
          <Button
            variant="outline"
            size="sm"
            onClick={onNewSession}
          >
            <Plus size={14} />
            {t('newConversation')}
          </Button>
        )}
        {onClose && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
          >
            {t('close')}
          </Button>
        )}
      </div>
    </div>
  );
};

export default SessionEmptyView;

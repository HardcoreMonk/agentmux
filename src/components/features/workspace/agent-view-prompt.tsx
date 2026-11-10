import { useTranslations } from 'next-intl';
import AgentProviderIcon from '@/components/icons/agent-provider-icon';
import { getAgentProviderMeta } from '@/lib/agent-provider-meta';
import type { TAgentPanelType } from '@/types/terminal';

interface IAgentViewPromptProps {
  providerPanelType: TAgentPanelType;
  onAccept: () => void;
  onDismiss: () => void;
}

const BUTTON_CLASS = 'flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-md border border-border/50 px-3 py-2 text-sm font-medium transition-colors hover:bg-muted active:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [word-break:keep-all]';

const AgentViewPrompt = ({ providerPanelType, onAccept, onDismiss }: IAgentViewPromptProps) => {
  const t = useTranslations('terminal');
  const label = getAgentProviderMeta(providerPanelType)?.label ?? providerPanelType;

  return (
    <div role="status" className="flex w-full shrink-0 justify-center bg-card px-3 py-2">
      <div className="w-full max-w-md rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium [word-break:keep-all]">
          <AgentProviderIcon panelType={providerPanelType} className="h-4 w-4 shrink-0" />
          <span>{t('switchToAgentView', { agent: label })}</span>
        </div>
        <div className="flex gap-1.5">
          <button type="button" onClick={onAccept} className={BUTTON_CLASS}>
            {t('switchToAgentViewAccept')}
          </button>
          <button type="button" onClick={onDismiss} className={BUTTON_CLASS}>
            {t('switchToAgentViewDismiss')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AgentViewPrompt;

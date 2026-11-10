import { useTranslations } from 'next-intl';
import Spinner from '@/components/ui/spinner';
import AgentProviderIcon from '@/components/icons/agent-provider-icon';
import { getAgentProviderMeta } from '@/lib/agent-provider-meta';
import type { TAgentBootDisplay } from '@/lib/agent-boot-display';
import type { TPanelType } from '@/types/terminal';

interface IAgentBootViewProps {
  panelType: TPanelType;
  display: TAgentBootDisplay;
  onCheckTerminal?: () => void;
}

const LINK_CLASS = 'inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md px-3 text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground active:bg-muted/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring [word-break:keep-all]';

// Boot progress for the agent view. trust / bypass / null render nothing: the trust card and the
// bypass card are drawn by their owners. Two lines at most, fixed height so the layout never jumps.
const AgentBootView = ({ panelType, display, onCheckTerminal }: IAgentBootViewProps) => {
  const t = useTranslations('timeline');
  if (display !== 'starting' && display !== 'waiting-session' && display !== 'recover') return null;

  const meta = getAgentProviderMeta(panelType);
  const agent = meta?.label ?? panelType;
  const titleKey = display === 'starting' ? 'bootStarting' : display === 'waiting-session' ? 'bootWaitingSession' : 'bootRecoverTitle';
  const hintKey = display === 'starting' ? 'bootStartingHint' : display === 'waiting-session' ? 'bootWaitingSessionHint' : 'bootRecoverHint';

  return (
    <div role="status" data-provider={meta?.panelType} className="flex min-h-24 flex-col items-center justify-center gap-1 px-4 text-center [word-break:keep-all]">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {meta && <AgentProviderIcon panelType={meta.panelType} className="h-4 w-4 shrink-0" />}
        <span>{t(titleKey, { agent })}</span>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground/80">
        {display !== 'recover' && <Spinner className="h-3 w-3 shrink-0" />}
        <span>{t(hintKey, { agent })}</span>
      </div>
      {display === 'recover' && onCheckTerminal && (
        <button type="button" className={LINK_CLASS} onClick={onCheckTerminal}>
          {t('bootCheckTerminal')}
        </button>
      )}
    </div>
  );
};

export default AgentBootView;

import { useTranslations } from 'next-intl';
import { GitCompareArrows, X } from 'lucide-react';
import DiffPanel from '@/components/features/workspace/diff-panel';
import type { IGitSidePanelTarget } from '@/lib/git-side-panel-target';
import type { TAgentPanelType } from '@/types/terminal';

interface IGitSidePanelProps {
  target: IGitSidePanelTarget | null;
  canAsk: boolean;
  askAgentPanelType: TAgentPanelType;
  refreshKey: number;
  onClose: () => void;
  onSendToAgent: (text: string) => void;
}

const GitSidePanel = ({
  target,
  canAsk,
  askAgentPanelType,
  refreshKey,
  onClose,
  onSendToAgent,
}: IGitSidePanelProps) => {
  const t = useTranslations('diff');
  const closeLabel = t('sidePanelClose');

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-card">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-2.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <GitCompareArrows className="h-3.5 w-3.5 text-muted-foreground" />
          <span>Git</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {target ? (
          <DiffPanel
            key={target.sessionName}
            sessionName={target.sessionName}
            refreshKey={refreshKey}
            askAgentPanelType={askAgentPanelType}
            compact
            onSendToAgent={canAsk ? onSendToAgent : undefined}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-center">
            <span className="text-xs text-muted-foreground [word-break:keep-all]">
              {t('sidePanelEmpty')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default GitSidePanel;

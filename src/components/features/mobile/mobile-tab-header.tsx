import { useState } from 'react';
import { X, Plus, GitCompareArrows, Copy, Terminal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import AgentProviderIcon from '@/components/icons/agent-provider-icon';
import TabStatusIndicator from '@/components/features/workspace/tab-status-indicator';
import CopyPaneDrawer from '@/components/features/workspace/copy-pane-drawer';
import useTabStore from '@/hooks/use-tab-store';
import ProcessIcon from '@/components/icons/process-icon';
import { cn } from '@/lib/utils';
import { AGENT_PANEL_TYPES, isAgentPanelType } from '@/lib/panel-type';
import { AGENT_PROVIDER_META } from '@/lib/agent-provider-meta';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import type { TPanelType } from '@/types/terminal';

// Four labeled buttons do not fit 360px next to the tab name and actions, so the
// switcher uses 44px icon buttons; the text label lives in aria-label/title.
const PANEL_MODES = [
  { type: 'terminal' as const, label: 'Terminal', icon: <Terminal size={16} /> },
  ...AGENT_PANEL_TYPES.map((type) => ({
    type: type as TPanelType,
    label: AGENT_PROVIDER_META[type].label,
    icon: <AgentProviderIcon panelType={type} className="h-4 w-4" />,
  })),
  { type: 'diff' as const, label: 'Diff', icon: <GitCompareArrows size={16} /> },
];

interface IMobileTabHeaderProps {
  tabId: string;
  tabName: string;
  sessionName: string | null;
  panelType: TPanelType;
  onSwitchPanelType: (type: TPanelType) => void;
  onCreateTab: () => void;
  onClose: () => void;
}

const MobileTabHeader = ({
  tabId,
  tabName,
  sessionName,
  panelType,
  onSwitchPanelType,
  onCreateTab,
  onClose,
}: IMobileTabHeaderProps) => {
  const t = useTranslations('mobile');
  const tc = useTranslations('common');
  const tt = useTranslations('terminal');
  const [copyOpen, setCopyOpen] = useState(false);
  const showCopy = panelType === 'terminal' && !!sessionName;
  const tabEntry = useTabStore((s) => s.tabs[tabId]);
  const processColor = tabEntry?.terminalStatus === 'server'
    ? 'text-ui-green'
    : tabEntry?.terminalStatus === 'running'
      ? 'text-ui-blue'
      : 'text-muted-foreground/50';

  return (
    <div className="flex h-11 shrink-0 items-center border-b border-border/50 bg-background">
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
        <TabStatusIndicator tabId={tabId} panelType={panelType} />
        {isAgentPanelType(panelType) ? (
          <AgentProviderIcon panelType={panelType} className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : panelType === 'diff' ? (
          <GitCompareArrows className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ProcessIcon
            process={tabEntry?.currentProcess}
            className={cn('h-3.5 w-3.5 shrink-0', processColor)}
          />
        )}
        <span className="truncate text-xs text-foreground">{tabName}</span>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 pr-0.5">
        <div className="flex items-center gap-px">
          {PANEL_MODES.map((mode) => (
            <button
              key={mode.type}
              className={cn(
                'flex h-11 w-11 touch-manipulation items-center justify-center rounded transition-colors active:bg-accent/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                panelType === mode.type
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground/60 hover:bg-accent/40 hover:text-muted-foreground',
              )}
              onClick={() => onSwitchPanelType(mode.type)}
              aria-pressed={panelType === mode.type}
              aria-label={mode.label}
              title={mode.label}
            >
              {mode.icon}
            </button>
          ))}
        </div>

        {showCopy && (
          <button
            className="flex h-10 w-10 touch-manipulation items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/40 active:bg-accent/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => setCopyOpen(true)}
            aria-label={tt('copyPaneLabel')}
          >
            <Copy size={16} />
          </button>
        )}

        <button
          className="flex h-10 w-10 touch-manipulation items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/40 active:bg-accent/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={onCreateTab}
          aria-label={t('newTab')}
        >
          <Plus size={16} />
        </button>

        <AlertDialog>
          <AlertDialogTrigger
            className="flex h-10 w-10 touch-manipulation items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/40 active:bg-accent/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label={t('closeTab')}
          >
            <X size={16} />
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('closeTab')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('closeTabConfirm', { name: tabName })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-ui-red hover:bg-ui-red/80"
                onClick={onClose}
              >
                {tc('close')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <CopyPaneDrawer
        open={copyOpen}
        onOpenChange={setCopyOpen}
        sessionName={sessionName}
      />
    </div>
  );
};

export default MobileTabHeader;

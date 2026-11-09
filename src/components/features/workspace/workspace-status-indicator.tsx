import { memo, useMemo } from 'react';
import { GitCompareArrows, Globe } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Spinner from '@/components/ui/spinner';
import useTabStore, { selectTabDisplayStatus } from '@/hooks/use-tab-store';
import ProcessIcon from '@/components/icons/process-icon';
import { isAgentPanelType } from '@/lib/panel-type';
import { cn } from '@/lib/utils';
import { getWorkspaceActivityStatus } from '@/lib/workspace-activity';
import type { TTabDisplayStatus, TTerminalStatus } from '@/types/status';
import type { ITab, TPanelType } from '@/types/terminal';

interface IWorkspaceStatusIndicatorProps {
  workspaceId: string;
  tabs?: ITab[];
  id?: string;
}

const ACTIVITY_LABEL = {
  checking: 'activityChecking',
  'needs-input': 'activityNeedsInput',
  busy: 'activityBusy',
  'ready-for-review': 'activityNeedsReview',
  unknown: 'activityUnknown',
  idle: 'activityIdle',
} as const;

const DotByStatus = ({ status, panelType, terminalStatus, process }: { status: TTabDisplayStatus; panelType?: TPanelType; terminalStatus?: TTerminalStatus; process?: string | null }) => {
  let inner: React.ReactNode;

  if (isAgentPanelType(panelType)) {
    if (status === 'busy') {
      inner = <Spinner className="h-2 w-2 text-muted-foreground" />;
    } else if (status === 'ready-for-review') {
      inner = <span className="h-2 w-2 rounded-full bg-agent-active animate-pulse" aria-hidden="true" />;
    } else if (status === 'needs-input') {
      inner = <span className="h-2 w-2 rounded-full bg-ui-amber animate-pulse" aria-hidden="true" />;
    } else if (status === 'unknown') {
      inner = <span className="h-2 w-2 rounded-full bg-muted-foreground/50" aria-hidden="true" />;
    } else {
      inner = <span className="h-2 w-2 rounded-full border border-muted-foreground/40" aria-hidden="true" />;
    }
  } else if (panelType === 'web-browser') {
    inner = <Globe className="h-2.5 w-2.5 text-muted-foreground/50" aria-hidden="true" />;
  } else if (panelType === 'diff') {
    inner = <GitCompareArrows className="h-2.5 w-2.5 text-muted-foreground/50" aria-hidden="true" />;
  } else {
    const colorClass =
      terminalStatus === 'server' ? 'text-ui-green'
      : terminalStatus === 'running' ? 'text-ui-blue'
      : 'text-muted-foreground/50';
    inner = <ProcessIcon process={process} className={`h-2.5 w-2.5 ${colorClass}`} />;
  }

  return (
    <span className="flex h-3 w-3 shrink-0 items-center justify-center">
      {inner}
    </span>
  );
};

const WorkspaceStatusIndicator = ({ workspaceId, tabs: layoutTabs, id }: IWorkspaceStatusIndicatorProps) => {
  const t = useTranslations('terminal');
  const tw = useTranslations('workspace');
  const wsConnected = useTabStore((state) => state.statusWsConnected);
  const statusSynced = useTabStore((state) => state.statusSynced);
  const tabs = useTabStore((state) => state.tabs);
  const tabOrder = useTabStore((state) => state.tabOrders[workspaceId]);
  const tabEntries = useMemo(() => {
    if (layoutTabs) {
      return layoutTabs.map((tab) => ({
        tabId: tab.id,
        status: tabs[tab.id]?.workspaceId === workspaceId ? selectTabDisplayStatus(tabs, tab.id) : 'unknown' as const,
        panelType: tab.panelType ?? tabs[tab.id]?.panelType,
        terminalStatus: tabs[tab.id]?.terminalStatus,
        currentProcess: tabs[tab.id]?.currentProcess,
      }));
    }

    const wsTabIds = new Set<string>();
    for (const [tabId, entry] of Object.entries(tabs)) {
      if (entry.workspaceId === workspaceId) wsTabIds.add(tabId);
    }

    const ordered = (tabOrder ?? []).filter((id) => wsTabIds.has(id));
    for (const id of wsTabIds) {
      if (!ordered.includes(id)) ordered.push(id);
    }

    return ordered.map((tabId) => ({
      tabId,
      status: selectTabDisplayStatus(tabs, tabId),
      panelType: tabs[tabId]?.panelType,
      terminalStatus: tabs[tabId]?.terminalStatus,
      currentProcess: tabs[tabId]?.currentProcess,
    }));
  }, [tabs, tabOrder, workspaceId, layoutTabs]);

  const activity = getWorkspaceActivityStatus(tabEntries, wsConnected && statusSynced);
  const label = tw(ACTIVITY_LABEL[activity]);

  return (
    <span id={id} role="group" className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1" aria-label={`${t('tabStatus')}: ${label}`}>
      <span className={cn(
        'max-w-full text-xs font-normal leading-tight',
        activity === 'needs-input' ? 'text-ui-amber'
          : activity === 'ready-for-review' ? 'text-agent-active'
          : activity === 'busy' ? 'text-foreground'
          : 'text-muted-foreground',
      )}>
        {label}
      </span>
      {tabEntries.length > 0 && (
        <span className="flex max-w-full flex-wrap items-center gap-0.5" aria-hidden="true">
          {tabEntries.map(({ tabId, status, panelType, terminalStatus, currentProcess }) => (
            <DotByStatus key={tabId} status={status} panelType={panelType} terminalStatus={terminalStatus} process={currentProcess} />
          ))}
        </span>
      )}
    </span>
  );
};

export default memo(WorkspaceStatusIndicator);

import { useRef, useEffect, useMemo } from 'react';
import { Globe, GitCompareArrows, CornerDownRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Spinner from '@/components/ui/spinner';
import useTabStore, { selectTabDisplayStatus } from '@/hooks/use-tab-store';
import { cn } from '@/lib/utils';
import ProcessIcon from '@/components/icons/process-icon';
import { isAgentPanelType } from '@/lib/panel-type';
import type { IWorkspace, IPaneNode, TPanelType } from '@/types/terminal';

interface IMobileWorkspaceTabBarProps {
  workspaces: IWorkspace[];
  activeWorkspaceId: string | null;
  workspaceLayouts: Record<string, IPaneNode[]>;
  selectedPaneId: string | null;
  selectedTabId: string | null;
  onSelect: (workspaceId: string, paneId: string, tabId: string) => void;
}

interface ITabDot {
  workspaceId: string;
  paneId: string;
  tabId: string;
  panelType?: TPanelType;
  createdByTabId?: string | null;
}

const MobileWorkspaceTabBar = ({
  workspaces,
  activeWorkspaceId,
  workspaceLayouts,
  selectedPaneId,
  selectedTabId,
  onSelect,
}: IMobileWorkspaceTabBarProps) => {
  const t = useTranslations('mobile');
  const tw = useTranslations('workspace');
  const activeRef = useRef<HTMLButtonElement>(null);
  const statusTabs = useTabStore((s) => s.tabs);
  const workspaceNameById = useMemo(
    () => new Map(workspaces.map((ws) => [ws.id, ws.name])),
    [workspaces],
  );
  const items = useMemo(() => {
    const result: (ITabDot | 'divider')[] = [];

    for (const ws of workspaces) {
      const panes = workspaceLayouts[ws.id] ?? [];
      const wsTabs: ITabDot[] = [];

      for (const pane of panes) {
        const sorted = [...pane.tabs].sort((a, b) => a.order - b.order);
        for (const tab of sorted) {
          wsTabs.push({ workspaceId: ws.id, paneId: pane.id, tabId: tab.id, panelType: tab.panelType, createdByTabId: tab.createdByTabId });
        }
      }

      if (wsTabs.length > 0) {
        if (result.length > 0) result.push('divider');
        result.push(...wsTabs);
      }
    }

    return result;
  }, [workspaces, workspaceLayouts]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [selectedTabId]);

  const totalTabs = items.filter((i) => i !== 'divider').length;
  if (totalTabs === 0) return null;

  return (
    <div data-mobile-workspace-tab-bar="true" className="shrink-0 border-t bg-background">
      <div
        className="flex h-10 items-center justify-center overflow-x-auto px-4"
        style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
      >
        {items.map((item, i) => {
          if (item === 'divider') {
            return (
              <span
                key={`d-${i}`}
                className="mx-0.5 h-3 w-px shrink-0 bg-border"
              />
            );
          }

          const isActive =
            item.workspaceId === activeWorkspaceId &&
            item.paneId === selectedPaneId &&
            item.tabId === selectedTabId;
          const isAgentPanel = isAgentPanelType(item.panelType);
          const status = selectTabDisplayStatus(statusTabs, item.tabId);
          const termStatus = statusTabs[item.tabId]?.terminalStatus;
          const currentProcess = statusTabs[item.tabId]?.currentProcess;
          const iconColorClass = termStatus === 'server'
            ? 'text-ui-green'
            : termStatus === 'running'
              ? 'text-ui-blue'
              : 'text-muted-foreground/50';
          const workspaceName = workspaceNameById.get(item.workspaceId) ?? 'Workspace';
          const tabLabel = isActive
            ? t('currentTab', { name: workspaceName })
            : t('switchTab', { name: workspaceName });
          // aria-label replaces the button's text, so the sr-only marker must be part of it.
          const ariaLabel = item.createdByTabId ? `${tabLabel}, ${tw('createdByAgent')}` : tabLabel;

          return (
            <button
              key={item.tabId}
              ref={isActive ? activeRef : undefined}
              className={cn(
                'flex h-8 w-8 shrink-0 touch-manipulation items-center justify-center rounded-md transition-colors hover:bg-accent/40 active:bg-accent/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                isActive && 'bg-accent/30',
              )}
              title={item.createdByTabId ? tw('createdByAgent') : undefined}
              onClick={() => onSelect(item.workspaceId, item.paneId, item.tabId)}
              aria-current={isActive ? 'true' : undefined}
              aria-label={ariaLabel}
            >
              {isActive ? (
                <span className="h-2 w-2 rounded-[2px] bg-foreground" />
              ) : isAgentPanel && status === 'busy' ? (
                <Spinner className="h-2 w-2 text-muted-foreground" />
              ) : isAgentPanel && status === 'ready-for-review' ? (
                <span className="h-2 w-2 rounded-full bg-agent-active animate-pulse" />
              ) : isAgentPanel && status === 'needs-input' ? (
                <span className="h-2 w-2 rounded-full bg-ui-amber animate-pulse" />
              ) : isAgentPanel && status === 'unknown' ? (
                <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
              ) : isAgentPanel ? (
                <span className="h-2 w-2 rounded-full border border-muted-foreground/40" />
              ) : item.panelType === 'web-browser' ? (
                <Globe className="h-2.5 w-2.5 text-muted-foreground/50" />
              ) : item.panelType === 'diff' ? (
                <GitCompareArrows className="h-2.5 w-2.5 text-muted-foreground/50" />
              ) : (
                <ProcessIcon process={currentProcess} className={cn('h-3 w-3', iconColorClass)} />
              )}
              {item.createdByTabId && (
                <>
                  <CornerDownRight aria-hidden="true" className="ml-0.5 h-2.5 w-2.5 text-muted-foreground" />
                  <span className="sr-only">{tw('createdByAgent')}</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      <div style={{ height: 'env(safe-area-inset-bottom)' }} />
    </div>
  );
};

export default MobileWorkspaceTabBar;

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { AlertTriangle, RefreshCw, Monitor, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Spinner from '@/components/ui/spinner';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import useLayout, { collectPanes } from '@/hooks/use-layout';
import useWorkspaceStore from '@/hooks/use-workspace-store';
import useTabMetadataStore from '@/hooks/use-tab-metadata-store';
import type { ITabMetadata } from '@/hooks/use-tab-metadata-store';
import type { TPanelType } from '@/types/terminal';
import MobileTabHeader from '@/components/features/mobile/mobile-tab-header';
import MobileSurfaceView from '@/components/features/mobile/mobile-surface-view';
import MobileNewTabDialog from '@/components/features/mobile/mobile-new-tab-dialog';
import { findAgentNewTabItemByCommand } from '@/lib/agent-new-tab-items';
import { formatTabTitle } from '@/lib/tab-title';
import { dismissTab } from '@/hooks/use-agent-status';
import useTabStore from '@/hooks/use-tab-store';
import type { TCliState } from '@/types/timeline';
import useMobileLayoutActions from '@/hooks/use-mobile-layout-actions';
import { useAutoDeleteEmptyWorkspace } from '@/hooks/use-auto-delete-empty-workspace';
import { isAgentPanelType } from '@/lib/panel-type';

const MobileTerminalPage = () => {
  const t = useTranslations('terminal');
  const tm = useTranslations('mobile');
  const tc = useTranslations('common');
  const isLoading = useWorkspaceStore((s) => s.isLoading);
  const error = useWorkspaceStore((s) => s.error);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const workspaceCount = workspaces.length;
  const prevWorkspaceIdRef = useRef<string | null>(null);

  const handleFetchError = useCallback(() => {
    const prevId = prevWorkspaceIdRef.current;
    if (prevId) {
      useWorkspaceStore.getState().switchWorkspace(prevId);
      toast.error(t('cannotSwitch'));
    }
  }, [t]);

  const layout = useLayout({
    workspaceId: activeWorkspaceId,
    onFetchError: handleFetchError,
  });

  const panes = useMemo(() => {
    if (!layout.layout) return [];
    return collectPanes(layout.layout.root);
  }, [layout.layout]);

  const allTabsEmpty = !!(
    layout.layout &&
    !layout.isLoading &&
    panes.every((p) => p.tabs.length === 0)
  );

  const layoutUpdatedAt = layout.layout?.updatedAt;
  const hydratedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!layout.layout || !layoutUpdatedAt) return;
    if (hydratedRef.current === layoutUpdatedAt) return;
    hydratedRef.current = layoutUpdatedAt;
    const metadata: Record<string, ITabMetadata> = {};
    for (const pane of collectPanes(layout.layout.root)) {
      for (const tab of pane.tabs) {
        if (tab.title || tab.cwd) {
          metadata[tab.id] = { title: tab.title, cwd: tab.cwd };
        }
      }
    }
    useTabMetadataStore.getState().hydrate(metadata);
  }, [layoutUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!layout.layout) return;
    const allTabIds = new Set(
      collectPanes(layout.layout.root).flatMap((p) => p.tabs.map((t) => t.id)),
    );
    useTabMetadataStore.getState().retainOnly(allTabIds);
  }, [layout.layout]);

  useAutoDeleteEmptyWorkspace(allTabsEmpty, layout.clearLayout);

  // Derive active pane/tab from layout store (same as desktop)
  const activePaneId = layout.layout?.activePaneId ?? null;
  const currentPane = (activePaneId ? panes.find((p) => p.id === activePaneId) : null) ?? panes[0] ?? null;
  const selectedPaneId = currentPane?.id ?? null;
  const selectedTabId = currentPane?.activeTabId ?? null;
  const currentTab = currentPane?.tabs.find((t) => t.id === selectedTabId) ?? null;
  const currentPanelType: TPanelType = currentTab?.panelType ?? 'terminal';

  const handleSelectWorkspace = useCallback(
    (workspaceId: string) => {
      const { activeWorkspaceId: currentId } = useWorkspaceStore.getState();
      if (workspaceId === currentId) return;

      prevWorkspaceIdRef.current = currentId;
      useTabMetadataStore.getState().reset();
      layout.clearLayout();
      useWorkspaceStore.getState().switchWorkspace(workspaceId);
    },
    [layout],
  );

  useEffect(() => {
    useMobileLayoutActions.getState().register({
      onSelectWorkspace: handleSelectWorkspace,
    });
    return () => useMobileLayoutActions.getState().unregister();
  }, [handleSelectWorkspace]);

  const [newTabDialogOpen, setNewTabDialogOpen] = useState(false);
  const [agentCliState, setAgentCliState] = useState<TCliState>('inactive');

  const handleCliStateChange = useCallback((state: TCliState) => {
    setAgentCliState(state);
  }, []);

  useEffect(() => {
    if (selectedTabId) dismissTab(selectedTabId);
  }, [selectedTabId]);

  useEffect(() => {
    if (!selectedTabId || !isAgentPanelType(currentPanelType) || agentCliState === 'inactive') return;
    if (agentCliState === 'idle') {
      dismissTab(selectedTabId);
    }
  }, [selectedTabId, agentCliState, currentPanelType]);

  const currentTabNeedsAttention = useTabStore((s) => {
    if (!selectedTabId) return false;
    const entry = s.tabs[selectedTabId];
    return entry?.cliState === 'ready-for-review' || entry?.cliState === 'needs-input';
  });

  useEffect(() => {
    if (currentTabNeedsAttention && selectedTabId) {
      dismissTab(selectedTabId);
    }
  }, [currentTabNeedsAttention, selectedTabId]);

  const tabMetadata = useTabMetadataStore((s) =>
    selectedTabId ? s.metadata[selectedTabId] : undefined,
  );
  const currentTabName = useMemo(() => {
    if (!currentTab) return '';
    if (currentTab.name) return currentTab.name;
    const rawTitle = tabMetadata?.title || currentTab.title;
    const formatted = rawTitle ? formatTabTitle(rawTitle) : '';
    if (formatted) return formatted;
    return `Tab ${currentTab.order + 1}`;
  }, [currentTab, tabMetadata]);

  const handleSwitchPanelType = useCallback((next: TPanelType) => {
    if (!currentPane || !selectedTabId) return;
    layout.updateTabPanelType(currentPane.id, selectedTabId, next);
  }, [currentPane, selectedTabId, layout]);

  const handleOpenNewTabDialog = useCallback(() => {
    setNewTabDialogOpen(true);
  }, []);

  const handleCreateTab = useCallback(async (panelType?: TPanelType, options?: { command?: string }) => {
    if (!currentPane) return;
    const startAgent = !!findAgentNewTabItemByCommand(options?.command);
    const newTab = await layout.createTabInPane(currentPane.id, panelType, undefined, startAgent);
    if (newTab) {
      useTabStore.getState().initTab(newTab.id, { panelType, workspaceId: activeWorkspaceId ?? '' });
      if (startAgent) {
        useTabStore.getState().setSessionView(newTab.id, 'check');
      }
    }
  }, [currentPane, layout, activeWorkspaceId]);

  const handleCloseTab = useCallback(() => {
    if (!currentPane || !selectedTabId) return;
    layout.deleteTabInPane(currentPane.id, selectedTabId);
  }, [currentPane, selectedTabId, layout]);

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center">
        <Spinner className="h-4 w-4 text-muted-foreground" />
        <span className="mt-3 text-sm text-muted-foreground">{t('connecting')}</span>
      </div>
    );
  }

  if (error && !workspaceCount) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <div className="flex w-full max-w-xs flex-col items-center gap-3 rounded-xl border border-border/70 bg-card/80 px-5 py-5 ring-1 ring-border/30">
          <AlertTriangle className="h-5 w-5 text-ui-amber" />
          <span className="text-sm text-muted-foreground">{error}</span>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 transition-transform active:scale-[0.99]"
            onClick={useWorkspaceStore.getState().fetchWorkspaces}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {tc('retry')}
          </Button>
        </div>
      </div>
    );
  }

  if (!activeWorkspaceId && !isLoading && !error) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <div className="flex w-full max-w-xs flex-col items-center gap-3 rounded-xl border border-border/70 bg-card/80 px-5 py-5 ring-1 ring-border/30">
          <Monitor className="h-8 w-8 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">{tm('noWorkspace')}</span>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 transition-transform active:scale-[0.99]"
            onClick={async () => {
              const created = await useWorkspaceStore.getState().createWorkspace('');
              if (created) useWorkspaceStore.getState().switchWorkspace(created.id);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('newWorkspace')}
          </Button>
        </div>
      </div>
    );
  }

  if (!layout.layout || layout.isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center">
        <Spinner className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }

  if (layout.error && !layout.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <div className="flex w-full max-w-xs flex-col items-center gap-3 rounded-xl border border-border/70 bg-card/80 px-5 py-5 ring-1 ring-border/30">
          <AlertTriangle className="h-5 w-5 text-ui-amber" />
          <span className="text-sm text-muted-foreground">{layout.error}</span>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 transition-transform active:scale-[0.99]"
            onClick={() => layout.fetchLayout()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {tc('retry')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      {currentPane && selectedTabId && (
        <MobileTabHeader
          key={selectedTabId}
          tabId={selectedTabId}
          tabName={currentTabName}
          sessionName={currentTab?.sessionName ?? null}
          panelType={currentPanelType}
          onSwitchPanelType={handleSwitchPanelType}
          onCreateTab={handleOpenNewTabDialog}
          onClose={handleCloseTab}
        />
      )}

      {currentPane && selectedTabId && (
        <MobileSurfaceView
          key={`${selectedPaneId}-${selectedTabId}`}
          paneId={currentPane.id}
          tabs={currentPane.tabs}
          activeTabId={selectedTabId}
          panelType={currentPanelType}
          onCreateTab={layout.createTabInPane}
          onDeleteTab={layout.deleteTabInPane}
          onSwitchTab={layout.switchTabInPane}
          onRemoveTabLocally={layout.removeTabLocally}
          onUpdateTabPanelType={layout.updateTabPanelType}
          onCliStateChange={handleCliStateChange}
          onOpenNewTabDialog={handleOpenNewTabDialog}
        />
      )}

      <MobileNewTabDialog
        open={newTabDialogOpen}
        onOpenChange={setNewTabDialogOpen}
        onCreateTab={handleCreateTab}
      />
    </>
  );
};

export default MobileTerminalPage;

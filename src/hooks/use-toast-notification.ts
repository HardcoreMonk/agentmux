import { useEffect } from 'react';
import Router from 'next/router';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';
import useTabStore from '@/hooks/use-tab-store';
import useWorkspaceStore from '@/hooks/use-workspace-store';
import useConfigStore from '@/hooks/use-config-store';
import { navigateToTab, useLayoutStore } from '@/hooks/use-layout';
import { findPane } from '@/lib/layout-tree';
import { playCompletionSound } from '@/lib/notification-sound';

const truncate = (s: string, n: number): string =>
  s.length <= n ? s : s.slice(0, n).trimEnd() + '…';

const getFocusedTabId = (): string | null => {
  if (Router.router?.pathname !== '/') return null;
  const layout = useLayoutStore.getState().layout;
  if (!layout?.activePaneId) return null;
  const pane = findPane(layout.root, layout.activePaneId);
  return pane?.activeTabId ?? null;
};

const toastIdFor = (tabId: string) => `tab-complete:${tabId}`;

const useToastNotification = () => {
  useEffect(() => {
    const unsubTabs = useTabStore.subscribe((state, prev) => {
      if (typeof document === 'undefined' || document.hidden) return;
      const { toastOnCompleteEnabled, soundOnCompleteEnabled, toastDuration } = useConfigStore.getState();

      let focusedTabId: string | null | undefined;
      let playedSound = false;

      for (const [tabId, tab] of Object.entries(state.tabs)) {
        const prevTab = prev.tabs[tabId];
        if (!prevTab) continue;

        const notice = tab.agentReportNotice;
        if (notice && notice.at !== prevTab.agentReportNotice?.at) {
          const key = notice.kind === 'paused' ? 'agentReportsPaused' : 'agentReportsExpired';
          const workspaceId = tab.workspaceId;
          toast.warning(t('notification', key, { count: String(notice.count) }), {
            id: `agent-report:${tabId}`,
            description: tab.tabName || tabId,
            action: {
              label: t('notification', 'openTab'),
              onClick: () => navigateToTab(workspaceId, tabId),
            },
          });
        }

        if (!toastOnCompleteEnabled) continue;
        if (prevTab.cliState === tab.cliState) continue;
        if (tab.cliState !== 'ready-for-review') continue;
        if (focusedTabId === undefined) focusedTabId = getFocusedTabId();
        if (tabId === focusedTabId) continue;

        const wsName = useWorkspaceStore.getState().workspaces.find((w) => w.id === tab.workspaceId)?.name
          ?? tab.workspaceId;
        const body = tab.lastUserMessage ? truncate(tab.lastUserMessage, 120) : (tab.tabName || tabId);
        const workspaceId = tab.workspaceId;
        const title = `${t('notification', 'toastCompleteTitle')} · ${wsName}`;

        toast.success(title, {
          id: toastIdFor(tabId),
          description: body,
          duration: toastDuration,
          classNames: {
            description: 'line-clamp-2',
          },
          action: {
            label: t('notification', 'openTab'),
            onClick: () => navigateToTab(workspaceId, tabId),
          },
        });

        if (soundOnCompleteEnabled && !playedSound) {
          playCompletionSound();
          playedSound = true;
        }
      }
    });

    let prevFocused = getFocusedTabId();
    const syncFocus = () => {
      const next = getFocusedTabId();
      if (next === prevFocused) return;
      prevFocused = next;
      if (next) toast.dismiss(toastIdFor(next));
    };
    const unsubLayout = useLayoutStore.subscribe(syncFocus);
    Router.events.on('routeChangeComplete', syncFocus);

    return () => {
      unsubTabs();
      unsubLayout();
      Router.events.off('routeChangeComplete', syncFocus);
    };
  }, []);
};

export default useToastNotification;

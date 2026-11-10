import { useCallback, useState } from 'react';
import { isAgentPanelType } from '@/lib/panel-type';
import type { TAgentPanelType } from '@/types/terminal';

export type TSessionProviderFilter = 'all' | TAgentPanelType;

const storageKey = (tabId: string) => `agentmux:session-provider-filter:${tabId}`;

const readStoredFilter = (tabId: string): TSessionProviderFilter => {
  if (typeof window === 'undefined') return 'all';
  try {
    const stored = window.localStorage.getItem(storageKey(tabId));
    return isAgentPanelType(stored) ? stored : 'all';
  } catch {
    return 'all';
  }
};

// Remembers the session list provider filter per tab. Panels only mount client-side, so reading storage in render is safe.
const useSessionProviderFilter = (tabId: string | undefined) => {
  const [state, setState] = useState<{ tabId: string | undefined; filter: TSessionProviderFilter }>(() => ({
    tabId,
    filter: tabId ? readStoredFilter(tabId) : 'all',
  }));
  let filter = state.filter;
  if (state.tabId !== tabId) {
    filter = tabId ? readStoredFilter(tabId) : 'all';
    setState({ tabId, filter });
  }

  const setFilter = useCallback((next: TSessionProviderFilter) => {
    setState({ tabId, filter: next });
    if (!tabId) return;
    try {
      window.localStorage.setItem(storageKey(tabId), next);
    } catch {
      // Storage can be blocked; the filter just will not persist.
    }
  }, [tabId]);

  return { filter, setFilter, providers: filter === 'all' ? undefined : [filter] as TAgentPanelType[] };
};

export default useSessionProviderFilter;

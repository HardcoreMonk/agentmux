import { create } from 'zustand';
import type { TCliState } from '@/types/timeline';
import type { ICurrentAction, ILastEvent, TTabDisplayStatus, TTerminalStatus } from '@/types/status';
import type { TPanelType } from '@/types/terminal';
import type { ISessionMetaData } from '@/hooks/use-session-meta';
import type { IApprovalPromptMetadata } from '@/lib/permission-prompt';
import { isAgentPanelType } from '@/lib/panel-type';

export type TSessionView = 'session-list' | 'check' | 'timeline';

export interface ISessionMetaCache {
  meta: ISessionMetaData;
  sessionId: string | null;
  jsonlPath: string | null;
}

export interface ITabState {
  terminalConnected: boolean;
  agentProcess: boolean | null;
  agentProcessCheckedAt: number;
  agentInstalled: boolean;
  sessionView: TSessionView;
  cliState: TCliState;
  isTimelineLoading: boolean;
  workspaceId: string;
  tabName?: string;
  panelType?: TPanelType;
  terminalStatus?: TTerminalStatus;
  listeningPorts?: number[];
  currentProcess?: string;
  agentSummary?: string | null;
  lastUserMessage?: string | null;
  lastAssistantMessage?: string | null;
  currentAction?: ICurrentAction | null;
  readyForReviewAt?: number | null;
  busySince?: number | null;
  dismissedAt?: number | null;
  agentSessionId?: string | null;
  compactingSince?: number | null;
  lastEvent?: ILastEvent | null;
  eventSeq?: number;
  approvalPromptMetadata?: IApprovalPromptMetadata | null;
  localUpdatedAt?: number;
  sessionMetaCache?: ISessionMetaCache | null;
}

const SYNC_GRACE_MS = 30_000;

const DEFAULT_TAB_STATE: ITabState = {
  terminalConnected: false,
  agentProcess: null,
  agentProcessCheckedAt: 0,
  agentInstalled: true,
  sessionView: 'session-list',
  cliState: 'inactive',
  isTimelineLoading: true,
  workspaceId: '',
};

interface ITabStore {
  tabs: Record<string, ITabState>;
  tabOrders: Record<string, string[]>;
  statusWsConnected: boolean;
  statusSynced: boolean;

  initTab: (tabId: string, initial?: Partial<ITabState>) => void;
  removeTab: (tabId: string) => void;

  setTerminalConnected: (tabId: string, connected: boolean) => void;
  setAgentProcess: (tabId: string, process: boolean | null, checkedAt: number) => void;
  setAgentInstalled: (tabId: string, installed: boolean) => void;
  setSessionView: (tabId: string, view: TSessionView) => void;
  setTimelineLoading: (tabId: string, loading: boolean) => void;
  setSessionMetaCache: (tabId: string, cache: ISessionMetaCache) => void;
  cancelTab: (tabId: string) => void;
  dismissTab: (tabId: string) => void;
  setWorkspaceId: (tabId: string, workspaceId: string) => void;
  setPanelType: (tabId: string, panelType: TPanelType) => void;
  setCurrentProcess: (tabId: string, process: string | null) => void;
  setTabOrder: (workspaceId: string, tabIds: string[]) => void;
  setStatusWsConnected: (connected: boolean) => void;
  syncAllFromServer: (serverTabs: Record<string, { cliState: TCliState; workspaceId: string; tabName?: string; panelType?: TPanelType; terminalStatus?: TTerminalStatus; listeningPorts?: number[]; currentProcess?: string; agentSummary?: string | null; lastUserMessage?: string | null; lastAssistantMessage?: string | null; currentAction?: ICurrentAction | null; readyForReviewAt?: number | null; busySince?: number | null; dismissedAt?: number | null; agentSessionId?: string | null; compactingSince?: number | null; lastEvent?: ILastEvent | null; eventSeq?: number; approvalPromptMetadata?: IApprovalPromptMetadata | null }>) => void;
  updateFromServer: (tabId: string, update: { cliState: TCliState | null; workspaceId: string; tabName?: string; panelType?: TPanelType; terminalStatus?: TTerminalStatus; listeningPorts?: number[]; currentProcess?: string; agentSummary?: string | null; lastUserMessage?: string | null; lastAssistantMessage?: string | null; currentAction?: ICurrentAction | null; readyForReviewAt?: number | null; busySince?: number | null; dismissedAt?: number | null; agentSessionId?: string | null; compactingSince?: number | null; lastEvent?: ILastEvent | null; eventSeq?: number; approvalPromptMetadata?: IApprovalPromptMetadata | null }) => void;
  applyHookEvent: (tabId: string, event: ILastEvent) => void;
}

const updateTab = (
  tabs: Record<string, ITabState>,
  tabId: string,
  patch: Partial<ITabState>,
): Record<string, ITabState> => {
  const prev = tabs[tabId];
  if (!prev) return tabs;
  return { ...tabs, [tabId]: { ...prev, ...patch } };
};

const readAgentProcessValue = (tab: ITabState): boolean | null =>
  tab.agentProcess ?? null;

const readAgentInstalledValue = (tab: ITabState): boolean =>
  tab.agentInstalled ?? true;

const readAgentProcessCheckedAtValue = (tab: ITabState): number =>
  tab.agentProcessCheckedAt ?? 0;

const applyAgentProcessUpdate = (
  state: { tabs: Record<string, ITabState> },
  tabId: string,
  process: boolean | null,
  checkedAt: number,
) => {
  const prev = state.tabs[tabId];
  if (!prev || readAgentProcessCheckedAtValue(prev) > checkedAt) return state;
  if (
    readAgentProcessValue(prev) === process
    && prev.agentProcess === process
    && prev.agentProcessCheckedAt === checkedAt
  ) {
    return state;
  }
  const patch: Partial<ITabState> = {
    agentProcess: process,
    agentProcessCheckedAt: checkedAt,
  };
  if (process === true && prev.sessionView === 'check') {
    patch.sessionView = 'timeline';
  }
  return { tabs: updateTab(state.tabs, tabId, patch) };
};

const applyAgentInstalledUpdate = (
  state: { tabs: Record<string, ITabState> },
  tabId: string,
  installed: boolean,
) => {
  const prev = state.tabs[tabId];
  if (
    !prev
    || (
      readAgentInstalledValue(prev) === installed
      && prev.agentInstalled === installed
    )
  ) {
    return state;
  }
  return {
    tabs: updateTab(state.tabs, tabId, {
      agentInstalled: installed,
    }),
  };
};

const resolvePanelTypeViewPatch = (
  prev: ITabState,
  panelType: TPanelType,
): Partial<ITabState> => {
  if (!isAgentPanelType(panelType)) return {};
  if (prev.sessionView === 'check') return {};
  if (prev.agentSessionId || prev.agentProcess === true) return {};
  return { sessionView: 'session-list' };
};

const useTabStore = create<ITabStore>((set) => ({
  tabs: {},
  tabOrders: {},
  statusWsConnected: false,
  statusSynced: false,

  initTab: (tabId, initial) =>
    set((state) => {
      const existing = state.tabs[tabId];
      const merged = { ...DEFAULT_TAB_STATE, ...existing, ...initial };
      if (existing?.cliState === 'ready-for-review' && merged.cliState !== 'ready-for-review') {
        merged.cliState = 'ready-for-review';
        merged.readyForReviewAt = existing.readyForReviewAt;
      }
      return { tabs: { ...state.tabs, [tabId]: merged } };
    }),

  removeTab: (tabId) =>
    set((state) => {
      const { [tabId]: _removed, ...rest } = state.tabs;
      return { tabs: rest };
    }),

  setTerminalConnected: (tabId, connected) =>
    set((state) => {
      const prev = state.tabs[tabId];
      if (!prev || prev.terminalConnected === connected) return state;
      return { tabs: updateTab(state.tabs, tabId, { terminalConnected: connected }) };
    }),

  setAgentProcess: (tabId, process, checkedAt) =>
    set((state) => applyAgentProcessUpdate(state, tabId, process, checkedAt)),

  setAgentInstalled: (tabId, installed) =>
    set((state) => applyAgentInstalledUpdate(state, tabId, installed)),

  setSessionView: (tabId, view) =>
    set((state) => {
      const prev = state.tabs[tabId];
      if (!prev || prev.sessionView === view) return state;
      return { tabs: updateTab(state.tabs, tabId, { sessionView: view }) };
    }),

  setTimelineLoading: (tabId, loading) =>
    set((state) => {
      const prev = state.tabs[tabId];
      if (!prev || prev.isTimelineLoading === loading) return state;
      return { tabs: updateTab(state.tabs, tabId, { isTimelineLoading: loading }) };
    }),

  setSessionMetaCache: (tabId, cache) =>
    set((state) => {
      const prev = state.tabs[tabId];
      if (!prev) return state;
      const cached = prev.sessionMetaCache;
      if (
        cached
        && cached.sessionId === cache.sessionId
        && cached.jsonlPath === cache.jsonlPath
        && cached.meta === cache.meta
      ) {
        return state;
      }
      return { tabs: updateTab(state.tabs, tabId, { sessionMetaCache: cache }) };
    }),

  cancelTab: (tabId) =>
    set((state) => {
      const prev = state.tabs[tabId];
      if (!prev || prev.cliState === 'cancelled') return state;
      return { tabs: updateTab(state.tabs, tabId, { cliState: 'cancelled', localUpdatedAt: Date.now() }) };
    }),

  dismissTab: (tabId) =>
    set((state) => {
      const prev = state.tabs[tabId];
      if (!prev || prev.cliState !== 'ready-for-review') return state;
      return { tabs: updateTab(state.tabs, tabId, { cliState: 'idle', dismissedAt: Date.now() }) };
    }),

  setWorkspaceId: (tabId, workspaceId) =>
    set((state) => {
      const prev = state.tabs[tabId];
      if (!prev || prev.workspaceId === workspaceId) return state;
      return { tabs: updateTab(state.tabs, tabId, { workspaceId }) };
    }),

  setPanelType: (tabId, panelType) =>
    set((state) => {
      const prev = state.tabs[tabId];
      if (!prev) return state;
      const patch = {
        panelType,
        ...resolvePanelTypeViewPatch(prev, panelType),
      };
      if (
        prev.panelType === panelType
        && (!patch.sessionView || prev.sessionView === patch.sessionView)
      ) {
        return state;
      }
      return { tabs: updateTab(state.tabs, tabId, patch) };
    }),

  setCurrentProcess: (tabId, process) =>
    set((state) => {
      const prev = state.tabs[tabId];
      if (!prev) return state;
      const value = process ?? undefined;
      if (prev.currentProcess === value) return state;
      return { tabs: updateTab(state.tabs, tabId, { currentProcess: value, localUpdatedAt: Date.now() }) };
    }),

  setTabOrder: (workspaceId, tabIds) =>
    set((state) => {
      const prev = state.tabOrders[workspaceId];
      if (prev && prev.length === tabIds.length && prev.every((id, i) => id === tabIds[i])) return state;
      return { tabOrders: { ...state.tabOrders, [workspaceId]: tabIds } };
    }),

  setStatusWsConnected: (connected) => set({ statusWsConnected: connected, statusSynced: false }),

  // 서버 경로: 초기 sync. 최근 로컬 업데이트된 탭은 로컬 전용 필드만 보존하고 서버 상태는 반영
  syncAllFromServer: (serverTabs) =>
    set((state) => {
      const now = Date.now();
      const next: Record<string, ITabState> = {};
      for (const [tabId, entry] of Object.entries(serverTabs)) {
        const existing = state.tabs[tabId];
        if (existing?.cliState === 'cancelled') {
          next[tabId] = existing;
          continue;
        }
        const graceActive = existing?.localUpdatedAt && now - existing.localUpdatedAt < SYNC_GRACE_MS;
        const agentSummary = entry.agentSummary ?? null;
        const agentSessionId = entry.agentSessionId ?? null;
        const approvalPromptMetadata = entry.approvalPromptMetadata ?? null;
        if (graceActive) {
          next[tabId] = { ...existing, cliState: entry.cliState, workspaceId: entry.workspaceId, tabName: entry.tabName, terminalStatus: entry.terminalStatus, listeningPorts: entry.listeningPorts, agentSummary, lastUserMessage: entry.lastUserMessage, lastAssistantMessage: entry.lastAssistantMessage, currentAction: entry.currentAction, readyForReviewAt: entry.readyForReviewAt, busySince: entry.busySince, dismissedAt: entry.dismissedAt, agentSessionId, compactingSince: entry.compactingSince, lastEvent: entry.lastEvent, eventSeq: entry.eventSeq, approvalPromptMetadata };
        } else if (existing) {
          next[tabId] = { ...existing, cliState: entry.cliState, workspaceId: entry.workspaceId, tabName: entry.tabName, panelType: entry.panelType ?? existing.panelType, terminalStatus: entry.terminalStatus, listeningPorts: entry.listeningPorts, currentProcess: entry.currentProcess, agentSummary, lastUserMessage: entry.lastUserMessage, lastAssistantMessage: entry.lastAssistantMessage, currentAction: entry.currentAction, readyForReviewAt: entry.readyForReviewAt, busySince: entry.busySince, dismissedAt: entry.dismissedAt, agentSessionId, compactingSince: entry.compactingSince, lastEvent: entry.lastEvent, eventSeq: entry.eventSeq, approvalPromptMetadata };
        } else {
          next[tabId] = { ...DEFAULT_TAB_STATE, cliState: entry.cliState, workspaceId: entry.workspaceId, tabName: entry.tabName, panelType: entry.panelType, terminalStatus: entry.terminalStatus, listeningPorts: entry.listeningPorts, currentProcess: entry.currentProcess, agentSummary, lastUserMessage: entry.lastUserMessage, lastAssistantMessage: entry.lastAssistantMessage, currentAction: entry.currentAction, readyForReviewAt: entry.readyForReviewAt, busySince: entry.busySince, dismissedAt: entry.dismissedAt, agentSessionId, compactingSince: entry.compactingSince, lastEvent: entry.lastEvent, eventSeq: entry.eventSeq, approvalPromptMetadata, ...(agentSessionId ? { sessionView: 'timeline' as const } : {}) };
        }
      }
      // 서버에 아직 반영되지 않은 로컬 탭 보존 (split 직후 레이스 컨디션 방지)
      for (const [tabId, existing] of Object.entries(state.tabs)) {
        if (!next[tabId]) {
          next[tabId] = existing;
        }
      }
      return { tabs: next, statusSynced: true };
    }),

  updateFromServer: (tabId, update) =>
    set((state) => {
      if (update.cliState === null) {
        const { [tabId]: _removed, ...rest } = state.tabs;
        return { tabs: rest };
      }
      const existing = state.tabs[tabId];
      if (existing) {
        if (existing.cliState === 'cancelled') return state;
        // stale broadcast: update의 eventSeq가 클라 것보다 작으면 cliState/lastEvent/관련 타임스탬프는 보존하고 나머지 메타데이터만 머지
        const isStale = update.eventSeq !== undefined
          && existing.eventSeq !== undefined
          && update.eventSeq < existing.eventSeq;
        // lastEvent는 클라가 더 최신(큰 seq)을 쥐고 있으면 유지, 아니면 서버값 반영
        const shouldAdoptEvent = update.eventSeq !== undefined
          && (existing.eventSeq === undefined || update.eventSeq >= existing.eventSeq);
        const eventPatch = shouldAdoptEvent
          ? { lastEvent: update.lastEvent, eventSeq: update.eventSeq }
          : {};
        const stateFields = isStale
          ? { cliState: existing.cliState, readyForReviewAt: existing.readyForReviewAt, busySince: existing.busySince, dismissedAt: existing.dismissedAt }
          : { cliState: update.cliState, readyForReviewAt: update.readyForReviewAt, busySince: update.busySince, dismissedAt: update.dismissedAt };
        const agentSummary = update.agentSummary ?? null;
        const agentSessionId = update.agentSessionId ?? null;
        const approvalPromptMetadata = update.approvalPromptMetadata ?? null;
        return { tabs: updateTab(state.tabs, tabId, { ...stateFields, workspaceId: update.workspaceId, tabName: update.tabName, panelType: update.panelType ?? existing.panelType, terminalStatus: update.terminalStatus, listeningPorts: update.listeningPorts, currentProcess: update.currentProcess, agentSummary, lastUserMessage: update.lastUserMessage, lastAssistantMessage: update.lastAssistantMessage, currentAction: update.currentAction, agentSessionId, compactingSince: update.compactingSince, approvalPromptMetadata, ...eventPatch }) };
      }
      const agentSummary = update.agentSummary ?? null;
      const agentSessionId = update.agentSessionId ?? null;
      const approvalPromptMetadata = update.approvalPromptMetadata ?? null;
      return {
        tabs: {
          ...state.tabs,
          [tabId]: { ...DEFAULT_TAB_STATE, cliState: update.cliState, workspaceId: update.workspaceId, tabName: update.tabName, panelType: update.panelType, terminalStatus: update.terminalStatus, listeningPorts: update.listeningPorts, currentProcess: update.currentProcess, agentSummary, lastUserMessage: update.lastUserMessage, lastAssistantMessage: update.lastAssistantMessage, readyForReviewAt: update.readyForReviewAt, busySince: update.busySince, dismissedAt: update.dismissedAt, agentSessionId, compactingSince: update.compactingSince, lastEvent: update.lastEvent, eventSeq: update.eventSeq, approvalPromptMetadata, ...(agentSessionId ? { sessionView: 'timeline' as const } : {}) },
        },
      };
    }),

  applyHookEvent: (tabId, event) =>
    set((state) => {
      const prev = state.tabs[tabId];
      if (!prev) return state;
      if (prev.eventSeq !== undefined && event.seq <= prev.eventSeq) return state;
      return { tabs: updateTab(state.tabs, tabId, { lastEvent: event, eventSeq: event.seq }) };
    }),
}));


// --- helpers ---

export const isCliIdle = (cliState: TCliState): boolean =>
  cliState === 'idle' || cliState === 'ready-for-review';

// --- 파생 selectors ---

export const selectAgentProcess = (tabs: Record<string, ITabState>, tabId: string): boolean | null => {
  const tab = tabs[tabId];
  if (!tab) return null;
  return readAgentProcessValue(tab);
};

export const selectAgentProcessCheckedAt = (tabs: Record<string, ITabState>, tabId: string): number => {
  const tab = tabs[tabId];
  if (!tab) return 0;
  return readAgentProcessCheckedAtValue(tab);
};

export const selectAgentInstalled = (tabs: Record<string, ITabState>, tabId: string): boolean => {
  const tab = tabs[tabId];
  if (!tab) return true;
  return readAgentInstalledValue(tab);
};

export const selectSessionView = (tabs: Record<string, ITabState>, tabId: string): TSessionView => {
  const tab = tabs[tabId];
  if (!tab) return 'session-list';
  return tab.sessionView;
};

export const selectTabDisplayStatus = (tabs: Record<string, ITabState>, tabId: string): TTabDisplayStatus => {
  const tab = tabs[tabId];
  if (!tab || tab.cliState === 'inactive') return 'idle';
  if (tab.cliState === 'busy') return 'busy';
  if (tab.cliState === 'ready-for-review') return 'ready-for-review';
  if (tab.cliState === 'needs-input') return 'needs-input';
  if (tab.cliState === 'unknown') return 'unknown';
  return 'idle';
};

export const selectWorkspaceStatus = (
  tabs: Record<string, ITabState>,
  wsId: string,
): { busyCount: number; attentionCount: number } => {
  let busyCount = 0;
  let attentionCount = 0;
  for (const entry of Object.values(tabs)) {
    if (entry.workspaceId !== wsId) continue;
    if (entry.cliState === 'busy') busyCount++;
    else if (entry.cliState === 'ready-for-review' || entry.cliState === 'needs-input') attentionCount++;
  }
  return { busyCount, attentionCount };
};

export const selectWorkspacePortsLabel = (
  tabs: Record<string, ITabState>,
  wsId: string,
): string => {
  const ports = new Set<number>();
  for (const entry of Object.values(tabs)) {
    if (entry.workspaceId !== wsId) continue;
    if (entry.listeningPorts) {
      for (const p of entry.listeningPorts) ports.add(p);
    }
  }
  if (ports.size === 0) return '';
  return ':' + [...ports].sort((a, b) => a - b).join(', :');
};

export const selectGlobalStatus = (
  tabs: Record<string, ITabState>,
): { busyCount: number; attentionCount: number } => {
  let busyCount = 0;
  let attentionCount = 0;
  for (const entry of Object.values(tabs)) {
    if (entry.cliState === 'busy') busyCount++;
    else if (entry.cliState === 'ready-for-review' || entry.cliState === 'needs-input') attentionCount++;
  }
  return { busyCount, attentionCount };
};

export default useTabStore;

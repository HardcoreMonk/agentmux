import { useState, useCallback, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import Spinner from '@/components/ui/spinner';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import useTimeline from '@/hooks/use-timeline';
import useStartingPrompt from '@/hooks/use-starting-prompt';
import useAgentBootElapsed from '@/hooks/use-agent-boot-elapsed';
import useSessionList from '@/hooks/use-session-list';
import useSessionProviderFilter from '@/hooks/use-session-provider-filter';
import useTabStore, { selectAgentInstalled, selectAgentProcess, selectSessionView } from '@/hooks/use-tab-store';
import useSessionMeta from '@/hooks/use-session-meta';
import useGitBranch from '@/hooks/use-git-branch';
import useGitStatus from '@/hooks/use-git-status';
import useTmuxInfo from '@/hooks/use-tmux-info';
import useMessageCounts from '@/hooks/use-message-counts';
import SessionListView from '@/components/features/workspace/session-list-view';
import SessionEmptyView from '@/components/features/workspace/session-empty-view';
import BypassPromptCard from '@/components/features/workspace/bypass-prompt-card';
import AgentBootView from '@/components/features/workspace/agent-boot-view';
import TimelineView from '@/components/features/timeline/timeline-view';
import WebInputBar from '@/components/features/workspace/web-input-bar';
import QuickPromptBar from '@/components/features/workspace/quick-prompt-bar';
import { MetaCompact } from '@/components/features/workspace/session-meta-content';
import MobileMetaSheet from './mobile-meta-sheet';
import useQuickPrompts from '@/hooks/use-quick-prompts';
import { DEFAULT_AGENT_PANEL_TYPE, isAgentPanelType } from '@/lib/panel-type';
import {
  selectAgentPanelContentMode,
  selectAgentSessionListRenderMode,
} from '@/lib/session-list-rendering';
import { decideSessionSelectAction } from '@/lib/session-select-action';
import { getAgentLabel, getAgentProviderMeta } from '@/lib/agent-provider-meta';
import { isAgentBootActive, resolveAgentBootDisplay } from '@/lib/agent-boot-display';
import type { ISessionMeta, TCliState } from '@/types/timeline';
import type { TPanelType } from '@/types/terminal';

interface IMobileAgentPanelProps {
  tabId?: string;
  wsId?: string;
  sessionName: string;
  agentSessionId?: string | null;
  panelType?: TPanelType;
  cwd?: string;
  // The parent draws the trust card; the panel only hides its boot progress while it is up.
  trustPromptVisible?: boolean;
  // Switches the tab to the terminal view (recovery action once boot takes too long).
  onCheckTerminal?: () => void;
  sendStdin: (data: string) => void;
  terminalWsConnected: boolean;
  focusTerminal: () => void;
  focusInputRef: React.MutableRefObject<(() => void) | undefined>;
  setInputValueRef: React.MutableRefObject<((v: string) => void) | undefined>;
  onCliStateChange: (state: TCliState) => void;
  onInputVisibleChange: (visible: boolean) => void;
  onRestartSession?: () => void;
  onNewSession?: () => void;
  // Resumes a session of another provider in this tab; resolves true when the server accepted it.
  onResumeOtherProvider?: (session: ISessionMeta) => Promise<boolean>;
}

const MobileAgentPanel = ({
  tabId,
  wsId,
  sessionName,
  agentSessionId,
  panelType = DEFAULT_AGENT_PANEL_TYPE,
  cwd,
  trustPromptVisible = false,
  onCheckTerminal,
  sendStdin,
  terminalWsConnected,
  focusTerminal,
  focusInputRef,
  setInputValueRef,
  onCliStateChange,
  onInputVisibleChange,
  onRestartSession,
  onNewSession,
  onResumeOtherProvider,
}: IMobileAgentPanelProps) => {
  const t = useTranslations('terminal');
  const tSession = useTranslations('session');
  const tTimeline = useTranslations('timeline');
  const agentLabel = getAgentLabel(panelType);
  const { prompts: quickPrompts } = useQuickPrompts();
  const [resumingSessionId, setResumingSessionId] = useState<string | null>(null);
  const [metaSheetOpen, setMetaSheetOpen] = useState(false);
  const scrollToBottomRef = useRef<(() => void) | undefined>(undefined);

  const agentProcess = useTabStore((s) => tabId ? selectAgentProcess(s.tabs, tabId) : null);
  const agentInstalled = useTabStore((s) => tabId ? selectAgentInstalled(s.tabs, tabId) : true);
  const storeCliState = useTabStore((s) => tabId ? s.tabs[tabId]?.cliState ?? 'inactive' : 'inactive');
  const compactingSince = useTabStore((s) => tabId ? s.tabs[tabId]?.compactingSince ?? null : null);
  const tabAgentSummary = useTabStore((s) => tabId ? s.tabs[tabId]?.agentSummary ?? null : null);
  const tabLastUserMessage = useTabStore((s) => tabId ? s.tabs[tabId]?.lastUserMessage ?? null : null);
  const isAgentPanel = isAgentPanelType(panelType);

  const handleResumeStarted = useCallback(() => {
    setResumingSessionId(null);
  }, []);

  const handleResumeBlocked = useCallback(
    (payload: { reason: string; processName?: string }) => {
      setResumingSessionId(null);
      toast.warning(t('resumeBlocked'), {
        description: payload.processName
          ? t('resumeBlockedProcess', { name: payload.processName })
          : undefined,
      });
    },
    [t],
  );

  const handleResumeError = useCallback(() => {
    setResumingSessionId(null);
    toast.error(t('resumeFailed'));
  }, [t]);

  const {
    entries,
    tasks,
    sessionId,
    jsonlPath,
    sessionSummary,
    initMeta,
    sessionStats,
    agentProcess: agentProcessFromTimeline,
    wsStatus,
    isLoading: isTimelineLoading,
    error: timelineError,
    loadMore: loadMoreTimeline,
    hasMore: timelineHasMore,
    retrySession,
    sendResume,
    openJsonlSession,
    addPendingUserMessage,
    removePendingUserMessage,
  } = useTimeline({
    sessionName,
    agentSessionId,
    panelType,
    enabled: !!sessionName,
    resumeCallbacks: {
      onResumeStarted: handleResumeStarted,
      onResumeBlocked: handleResumeBlocked,
      onResumeError: handleResumeError,
    },
    onSync: tabId ? (state) => {
      const checkedAt = Date.now();
      if (state.agentProcess !== null) {
        useTabStore.getState().setAgentProcess(tabId, state.agentProcess, checkedAt);
      }
      if (!state.agentInstalled) {
        useTabStore.getState().setAgentInstalled(tabId, false);
      }
      useTabStore.getState().setTimelineLoading(tabId, state.isLoading);
    } : undefined,
    getCliState: tabId ? () => useTabStore.getState().tabs[tabId]?.cliState : undefined,
  });

  const view = useTabStore((s) => tabId ? selectSessionView(s.tabs, tabId) : 'session-list' as const);

  const providerFilter = useSessionProviderFilter(tabId);

  const {
    sessions,
    total: sessionListTotal,
    hasMore: sessionListHasMore,
    isLoading: isSessionListLoading,
    isLoadingMore: isSessionListLoadingMore,
    error: sessionListError,
    refetch: refetchSessions,
    loadMore: loadMoreSessions,
  } = useSessionList({
    tmuxSession: sessionName,
    enabled: isAgentPanel && !!sessionName && view === 'session-list',
    cwd,
    panelType,
    providers: providerFilter.providers,
  });

  const prevAgentProcessRef = useRef(agentProcess);
  useEffect(() => {
    const prev = prevAgentProcessRef.current;
    prevAgentProcessRef.current = agentProcess;
    if (prev !== true && agentProcess === true && agentProcessFromTimeline !== true) {
      retrySession();
    }
  }, [agentProcess, agentProcessFromTimeline, retrySession]);

  const { meta } = useSessionMeta(entries, sessionSummary, initMeta, sessionStats, tabAgentSummary, tabLastUserMessage);
  const { branch, isLoading: isBranchLoading } = useGitBranch(sessionName);
  const { status: gitStatus } = useGitStatus(sessionName, metaSheetOpen);
  const tmuxInfo = useTmuxInfo(sessionName, metaSheetOpen);
  const messageCounts = useMessageCounts(jsonlPath, metaSheetOpen);
  const metaWithCounts = messageCounts
    ? { ...meta, userCount: messageCounts.userCount, assistantCount: messageCounts.assistantCount }
    : meta;

  const isInputVisible = view === 'timeline';

  const startingPromptOptions = useStartingPrompt(view === 'check', sessionName);
  const contentMode = selectAgentPanelContentMode({ agentProcess, view });
  const bypassPrompt = !!startingPromptOptions?.isBypassPrompt && startingPromptOptions.options.length > 0;
  const hasEntries = entries.length > 0;
  const bootElapsedMs = useAgentBootElapsed(isAgentBootActive({ view, agentProcess, hasEntries, cliState: storeCliState }));
  const bootDisplay = resolveAgentBootDisplay({
    view,
    agentProcess,
    hasEntries,
    trustPrompt: trustPromptVisible,
    bypassPrompt,
    startingPrompt: !!startingPromptOptions && !bypassPrompt,
    cliState: storeCliState,
    elapsedMs: bootElapsedMs,
  });

  useEffect(() => {
    onCliStateChange(storeCliState);
  }, [storeCliState, onCliStateChange]);

  useEffect(() => {
    onInputVisibleChange(isInputVisible);
  }, [isInputVisible, onInputVisibleChange]);

  const handleScrollToBottom = useCallback(() => {
    if (storeCliState !== 'idle') return;
    scrollToBottomRef.current?.();
  }, [storeCliState]);

  const handleSelectQuickPrompt = useCallback((prompt: string) => {
    setInputValueRef.current?.(prompt);
    focusInputRef.current?.();
  }, [setInputValueRef, focusInputRef]);

  const handleSelectSession = useCallback(
    (session: ISessionMeta) => {
      if (resumingSessionId) return;
      const action = session.providerId
        ? decideSessionSelectAction({
          tabPanelType: panelType,
          itemProviderId: session.providerId,
          agentProcess: agentProcess === true,
        })
        : 'open';
      if (action === 'blocked-running') {
        toast.warning(tSession('switchWhileRunning', {
          agent: getAgentProviderMeta(panelType)?.label ?? panelType,
        }));
        return;
      }
      if (action === 'resume-other-provider') {
        if (!onResumeOtherProvider) return;
        setResumingSessionId(session.sessionId);
        void onResumeOtherProvider(session).finally(() => setResumingSessionId(null));
        return;
      }
      setResumingSessionId(session.sessionId);
      if (session.jsonlPath) {
        if (openJsonlSession(session.jsonlPath, session.sessionId)) {
          if (tabId) {
            useTabStore.getState().setSessionView(tabId, 'timeline');
          }
        } else {
          retrySession();
        }
        setResumingSessionId(null);
        return;
      }
      sendResume(session.sessionId, sessionName);
    },
    [agentProcess, onResumeOtherProvider, openJsonlSession, panelType, resumingSessionId, retrySession, sendResume, sessionName, tSession, tabId],
  );

  const handleRefreshSessions = useCallback(async () => {
    await refetchSessions();
  }, [refetchSessions]);

  if (!agentInstalled) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-muted text-muted-foreground">
        <span className="text-sm font-medium">{tTimeline('installAgent', { agent: agentLabel })}</span>
        <span className="text-xs">{tTimeline('installAgentHint', { agent: agentLabel, path: getAgentProviderMeta(panelType)?.configDir ?? '' })}</span>
      </div>
    );
  }

  if (contentMode === 'check') {
    return (
      <div className="animate-delayed-fade-in flex min-h-0 flex-1 flex-col items-center justify-center bg-muted">
        <AgentBootView panelType={panelType} display={bootDisplay} onCheckTerminal={onCheckTerminal} />
        {bootDisplay === 'bypass' && startingPromptOptions && (
          <BypassPromptCard
            sessionName={sessionName}
            options={startingPromptOptions.options}
            fallback={
              <span className="text-xs text-muted-foreground">{t('checkTerminal')}</span>
            }
          />
        )}
      </div>
    );
  }

  if (contentMode === 'session-list') {
    const renderMode = selectAgentSessionListRenderMode({
      isAgentPanel,
      isLoading: isSessionListLoading,
      sessionCount: sessions.length,
    });

    if (renderMode === 'empty') {
      return (
        <div className="flex min-h-0 flex-1 flex-col bg-muted">
          <SessionEmptyView onNewSession={onNewSession} panelType={panelType} />
        </div>
      );
    }
    if (renderMode === 'spinner') {
      return (
        <div className="animate-delayed-fade-in flex min-h-0 flex-1 flex-col items-center justify-center bg-muted">
          <Spinner className="h-4 w-4 text-muted-foreground" />
        </div>
      );
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-muted">
        <SessionListView
          sessions={sessions}
          total={sessionListTotal}
          isLoading={isSessionListLoading}
          isLoadingMore={isSessionListLoadingMore}
          hasMore={sessionListHasMore}
          error={sessionListError}
          resumingSessionId={resumingSessionId}
          onSelectSession={handleSelectSession}
          onRefresh={handleRefreshSessions}
          onLoadMore={loadMoreSessions}
          onNewSession={onNewSession}
          providerFilter={providerFilter.filter}
          onProviderFilterChange={providerFilter.setFilter}
          emptyView={<SessionEmptyView onNewSession={onNewSession} panelType={panelType} />}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-muted">
      <div
        className="flex shrink-0 cursor-pointer items-center justify-between border-b px-4 py-1.5 hover:bg-muted/30"
        role="button"
        tabIndex={0}
        onClick={() => setMetaSheetOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setMetaSheetOpen(true);
          }
        }}
      >
        <MetaCompact
          title={meta.title}
          totalCost={meta.totalCost}
          branch={branch}
          usedPercentage={meta.usedPercentage}
          currentContextTokens={meta.currentContextTokens}
          contextWindowSize={meta.contextWindowSize}
        />
        <ChevronDown
          size={14}
          className="shrink-0 text-muted-foreground"
        />
      </div>

      <div className="min-h-0 flex-1">
        {(bootDisplay === 'waiting-session' || bootDisplay === 'recover') && !timelineError ? (
          <div className="flex h-full w-full flex-col items-center justify-center">
            <AgentBootView panelType={panelType} display={bootDisplay} onCheckTerminal={onCheckTerminal} />
          </div>
        ) : (
        <TimelineView
          entries={entries}
          tasks={tasks}
          sessionId={sessionId}
          sessionName={sessionName}
          tabId={tabId}
          initMeta={initMeta}
          sessionStats={sessionStats}
          cliState={storeCliState}
          compactingSince={compactingSince}
          wsStatus={wsStatus}
          isLoading={isTimelineLoading}
          error={timelineError}
          onRetry={retrySession}
          onLoadMore={loadMoreTimeline}
          hasMore={timelineHasMore}
          scrollToBottomRef={scrollToBottomRef}
          panelType={panelType}
        />
        )}
      </div>

      <div className="shrink-0 pb-3">
        <WebInputBar
          tabId={tabId}
          panelType={panelType}
          wsId={wsId}
          sessionName={sessionName}
          agentSessionId={agentSessionId}
          cliState={storeCliState}
          sendStdin={sendStdin}
          terminalWsConnected={terminalWsConnected}
          visible={isInputVisible}
          focusTerminal={focusTerminal}
          focusInputRef={focusInputRef}
          setInputValueRef={setInputValueRef}
          maxRows={3}
          onRestartSession={onRestartSession}
          onSend={handleScrollToBottom}
          onOptimisticSend={addPendingUserMessage}
          onAddPendingMessage={addPendingUserMessage}
          onRemovePendingMessage={removePendingUserMessage}
        />
        <QuickPromptBar
          prompts={quickPrompts}
          visible={isInputVisible}
          onSelect={handleSelectQuickPrompt}
        />
      </div>

      <MobileMetaSheet
        open={metaSheetOpen}
        onOpenChange={setMetaSheetOpen}
        meta={metaWithCounts}
        toolCount={messageCounts?.toolCount ?? null}
        toolBreakdown={messageCounts?.toolBreakdown ?? null}
        branch={branch}
        isBranchLoading={isBranchLoading}
        sessionId={sessionId}
        gitStatus={gitStatus}
        tmuxInfo={tmuxInfo}
      />
    </div>
  );
};

export default MobileAgentPanel;

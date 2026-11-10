import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { RefreshCw, GitBranch, Columns2, Rows2, ArrowUp, ArrowDown, ArrowDownUp, Archive } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAgentLabel } from '@/lib/agent-provider-meta';
import { DEFAULT_AGENT_PANEL_TYPE } from '@/lib/panel-type';
import Spinner from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import useIsMobile from '@/hooks/use-is-mobile';
import DiffHistoryView from '@/components/features/workspace/diff-history-view';
import DiffFileList from '@/components/features/workspace/diff-file-list';

interface IDiffPanelProps {
  sessionName: string;
  onSendToAgent?: (text: string) => void;
}

interface IHeadCommit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  timestamp: number;
}

interface ISyncStep {
  name: 'fetch' | 'pull' | 'push';
  ok: boolean;
  skipped: boolean;
  stdout: string;
  stderr: string;
}

type TViewMode = 'split' | 'unified';
type TTab = 'changes' | 'history';
type TSyncErrorKind = 'no-upstream' | 'auth' | 'diverged' | 'rejected' | 'local-changes' | 'timeout' | 'unknown';

interface IDiffResponse {
  isGitRepo: boolean;
  diff?: string;
  hash?: string;
  ahead?: number;
  behind?: number;
  branch?: string;
  upstream?: string | null;
  isDetached?: boolean;
  stash?: number;
  headCommit?: IHeadCommit | null;
  fetched?: boolean;
  untrackedSkipped?: number;
  untrackedTotal?: number;
}

const POLL_INTERVAL = 10_000;
const FETCH_INTERVAL = 3 * 60_000;
const DIFF_FETCH_TIMEOUT_MS = 15_000;
const ERROR_TOAST_DURATION = 15_000;
const MAX_STDERR_LENGTH = 800;

const ERROR_MESSAGE_KEYS = {
  'no-upstream': 'syncErrorNoUpstream',
  auth: 'syncErrorAuth',
  diverged: 'syncErrorDiverged',
  rejected: 'syncErrorRejected',
  'local-changes': 'syncErrorLocalChanges',
  timeout: 'syncErrorTimeout',
  unknown: 'syncErrorGeneric',
} as const;

const AGENT_PROMPT_KEYS = {
  'no-upstream': 'agentPromptNoUpstream',
  auth: 'agentPromptAuth',
  diverged: 'agentPromptDiverged',
  rejected: 'agentPromptRejected',
  'local-changes': 'agentPromptLocalChanges',
  timeout: 'agentPromptTimeout',
  unknown: 'agentPromptGeneric',
} as const;

const fetchWithTimeout = async (url: string) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), DIFF_FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
};

const DiffPanel = ({ sessionName, onSendToAgent }: IDiffPanelProps) => {
  const t = useTranslations('diff');
  const isMobile = useIsMobile();

  const [diff, setDiff] = useState('');
  const [isGitRepo, setIsGitRepo] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [ahead, setAhead] = useState(0);
  const [behind, setBehind] = useState(0);
  const [branch, setBranch] = useState('');
  const [upstream, setUpstream] = useState<string | null>(null);
  const [isDetached, setIsDetached] = useState(false);
  const [stash, setStash] = useState(0);
  const [headCommit, setHeadCommit] = useState<IHeadCommit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skippedUntracked, setSkippedUntracked] = useState(0);
  const [totalUntracked, setTotalUntracked] = useState(0);
  const [viewMode, setViewMode] = useState<TViewMode>(() => {
    if (typeof window === 'undefined') return 'split';
    const saved = localStorage.getItem('diff-output-format');
    return saved === 'line-by-line' ? 'unified' : 'split';
  });
  const [activeTab, setActiveTab] = useState<TTab>(() => {
    if (typeof window === 'undefined') return 'changes';
    return (localStorage.getItem('diff-active-tab') as TTab) || 'changes';
  });
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const pollTimerRef = useRef(0);
  const currentHashRef = useRef('');
  const lastFetchAtRef = useRef(0);

  const fetchDiff = useCallback(async (opts: { remoteFetch?: boolean } = {}) => {
    setLoading(true);
    setHasUpdate(false);
    setError(null);
    try {
      const params = new URLSearchParams({ session: sessionName });
      if (opts.remoteFetch) params.set('fetch', 'true');
      const res = await fetchWithTimeout(`/api/layout/diff?${params}`);
      if (!res.ok) throw new Error(`diff request failed: ${res.status}`);
      const data = await res.json() as IDiffResponse;
      setIsGitRepo(data.isGitRepo);
      setSkippedUntracked(data.untrackedSkipped ?? 0);
      setTotalUntracked(data.untrackedTotal ?? 0);
      if (data.isGitRepo) {
        setDiff(data.diff ?? '');
        setAhead(data.ahead ?? 0);
        setBehind(data.behind ?? 0);
        setBranch(data.branch ?? '');
        setUpstream(data.upstream ?? null);
        setIsDetached(Boolean(data.isDetached));
        setStash(data.stash ?? 0);
        setHeadCommit(data.headCommit ?? null);
        currentHashRef.current = data.hash ?? '';
        if (data.fetched) lastFetchAtRef.current = Date.now();
      }
    } catch (err) {
      const message = (err as Error).name === 'AbortError'
        ? t('loadTimeout')
        : t('loadFailed');
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [sessionName, t]);

  const pollForChanges = useCallback(async () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const shouldFetch = Date.now() - lastFetchAtRef.current >= FETCH_INTERVAL;
    try {
      const params = new URLSearchParams({ session: sessionName, hashOnly: 'true' });
      if (shouldFetch) params.set('fetch', 'true');
      const res = await fetchWithTimeout(`/api/layout/diff?${params}`);
      if (!res.ok) return;
      const data = await res.json() as IDiffResponse;
      if (!data.isGitRepo) return;
      if (data.fetched) lastFetchAtRef.current = Date.now();
      setAhead(data.ahead ?? 0);
      setBehind(data.behind ?? 0);
      if (data.hash && data.hash !== currentHashRef.current) {
        setHasUpdate(true);
      }
    } catch {
      // ignore
    }
  }, [sessionName]);

  const handleRefresh = useCallback(() => {
    fetchDiff({ remoteFetch: true });
    setHistoryRefreshToken((n) => n + 1);
  }, [fetchDiff]);

  const handleTabChange = useCallback((tab: TTab) => {
    setActiveTab(tab);
    localStorage.setItem('diff-active-tab', tab);
  }, []);

  const handleSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch(`/api/git/sync?session=${sessionName}`, { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        toast.error(t('syncErrorGeneric'));
        return;
      }

      if (data.ok) {
        const { pulled, pushed } = data.summary ?? { pulled: 0, pushed: 0 };
        if (pulled === 0 && pushed === 0) {
          toast.success(t('syncUpToDate'));
        } else {
          const parts: string[] = [];
          if (pulled > 0) parts.push(`↓${pulled}`);
          if (pushed > 0) parts.push(`↑${pushed}`);
          toast.success(`${t('syncSuccess')} · ${parts.join(' ')}`);
        }
      } else {
        const kind: TSyncErrorKind = data.errorKind ?? 'unknown';
        const messageKey = ERROR_MESSAGE_KEYS[kind];
        const failedStep = (data.steps as ISyncStep[] | undefined)?.find((s) => !s.ok && !s.skipped);
        const stderr = failedStep?.stderr ?? failedStep?.stdout ?? '';

        toast.error(t(messageKey), {
          duration: ERROR_TOAST_DURATION,
          action: onSendToAgent ? {
            label: t('askAgent', { agent: getAgentLabel(DEFAULT_AGENT_PANEL_TYPE) }),
            onClick: () => {
              const promptKey = AGENT_PROMPT_KEYS[kind];
              const intro = t(promptKey, {
                branch: branch || 'HEAD',
                upstream: data.upstream ?? '',
              });
              const trimmedStderr = stderr.length > MAX_STDERR_LENGTH
                ? stderr.slice(0, MAX_STDERR_LENGTH) + '\n...(truncated)'
                : stderr;
              const body = trimmedStderr
                ? `${intro}\n\n\`\`\`\n${trimmedStderr.trim()}\n\`\`\``
                : intro;
              onSendToAgent(body);
            },
          } : undefined,
        });
      }

      fetchDiff();
      setHistoryRefreshToken((n) => n + 1);
    } catch {
      toast.error(t('syncErrorGeneric'));
    } finally {
      setSyncing(false);
    }
  }, [sessionName, syncing, t, fetchDiff, onSendToAgent, branch]);

  useEffect(() => {
    fetchDiff().then(() => pollForChanges());
  }, [fetchDiff, pollForChanges]);

  useEffect(() => {
    if (isGitRepo === false) return;

    pollTimerRef.current = window.setInterval(pollForChanges, POLL_INTERVAL);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') pollForChanges();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(pollTimerRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isGitRepo, pollForChanges]);

  if (loading && isGitRepo === null) {
    return (
      <div className="flex h-full items-center justify-center bg-card">
        <Spinner className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  if (isGitRepo === false) {
    return (
      <div className="flex h-full items-center justify-center bg-card">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <GitBranch className="h-10 w-10 opacity-20" />
          <span className="text-sm">{t('notGitRepo')}</span>
        </div>
      </div>
    );
  }

  const tabButtonClass = (tab: TTab) =>
    cn(
      'rounded px-2 py-0.5 text-xs font-medium transition-colors',
      activeTab === tab
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground',
    );

  const branchLabel = isDetached && headCommit
    ? `(detached @ ${headCommit.shortHash})`
    : branch || '—';

  const hasSyncWork = ahead > 0 || behind > 0;
  const SyncIcon = behind > 0 && ahead === 0
    ? ArrowDown
    : ahead > 0 && behind === 0
      ? ArrowUp
      : ArrowDownUp;
  const syncCountLabel = [
    behind > 0 ? `↓${behind}` : '',
    ahead > 0 ? `↑${ahead}` : '',
  ].filter(Boolean).join(' ');
  const syncTitle = syncing
    ? t('syncing')
    : hasSyncWork ? `${t('sync')} · ${syncCountLabel}` : t('sync');

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex shrink-0 flex-col gap-1 border-b border-border px-3 py-1.5">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded bg-secondary p-0.5">
            <button
              type="button"
              className={tabButtonClass('changes')}
              onClick={() => handleTabChange('changes')}
            >
              {t('tabChanges')}
            </button>
            <button
              type="button"
              className={tabButtonClass('history')}
              onClick={() => handleTabChange('history')}
            >
              {t('tabHistory')}
            </button>
          </div>

          <TooltipProvider>
            <div className="ml-auto flex items-center gap-1">
              {hasUpdate && activeTab === 'changes' && (
                <span className="text-xs text-ui-blue">{t('hasChanges')}</span>
              )}

              {activeTab === 'changes' && !isMobile && (
                <Tooltip>
                  <TooltipTrigger
                    className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={() => setViewMode((m) => {
                      const next: TViewMode = m === 'split' ? 'unified' : 'split';
                      localStorage.setItem('diff-output-format', next === 'unified' ? 'line-by-line' : 'side-by-side');
                      return next;
                    })}
                    aria-label={viewMode === 'split' ? t('lineByLine') : t('sideBySide')}
                  >
                    {viewMode === 'split' ? <Rows2 className="h-3.5 w-3.5" /> : <Columns2 className="h-3.5 w-3.5" />}
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{viewMode === 'split' ? t('lineByLine') : t('sideBySide')}</TooltipContent>
                </Tooltip>
              )}

              <Tooltip>
                <TooltipTrigger
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded hover:bg-accent disabled:opacity-50',
                    hasSyncWork && !syncing
                      ? 'text-ui-blue'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={handleSync}
                  disabled={syncing || loading}
                  aria-label={syncTitle}
                >
                  {syncing
                    ? <Spinner className="h-3.5 w-3.5" />
                    : <SyncIcon className="h-3.5 w-3.5" />}
                </TooltipTrigger>
                <TooltipContent side="bottom">{syncTitle}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded',
                    hasUpdate && activeTab === 'changes'
                      ? 'text-ui-blue hover:bg-accent'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    loading && 'animate-spin',
                  )}
                  onClick={handleRefresh}
                  disabled={loading}
                  aria-label={t('refresh')}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('refresh')}</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </div>

        <div className="flex min-w-0 items-center gap-2 text-xs">
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <span className="truncate font-medium text-foreground" title={branchLabel}>
              {branchLabel}
            </span>
            {upstream && (
              <span className="shrink-0 text-muted-foreground">→</span>
            )}
            {upstream && (
              <span className="truncate text-muted-foreground" title={upstream}>
                {upstream}
              </span>
            )}
          </div>

          {(ahead > 0 || behind > 0) && (
            <div className="flex shrink-0 items-center gap-1.5 font-mono text-[11px]">
              {ahead > 0 && (
                <span className="flex items-center gap-0.5 text-ui-blue" title={`${ahead} commit(s) to push`}>
                  <ArrowUp className="h-3 w-3" />
                  {ahead}
                </span>
              )}
              {behind > 0 && (
                <span className="flex items-center gap-0.5 text-agent-active" title={`${behind} commit(s) to pull`}>
                  <ArrowDown className="h-3 w-3" />
                  {behind}
                </span>
              )}
            </div>
          )}

          {stash > 0 && (
            <span
              className="flex shrink-0 items-center gap-0.5 font-mono text-[11px] text-muted-foreground"
              title={`${stash} stash(es)`}
            >
              <Archive className="h-3 w-3" />
              {stash}
            </span>
          )}
        </div>

      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {activeTab === 'history' ? (
          <DiffHistoryView sessionName={sessionName} refreshToken={historyRefreshToken} viewMode={viewMode} />
        ) : (
          <>
            {error && !loading && (
              <div className="m-2 rounded border border-negative/30 bg-negative/10 px-3 py-2 text-xs text-negative">
                {error}
              </div>
            )}
            {skippedUntracked > 0 && (
              <div className="m-2 rounded border border-ui-amber/30 bg-ui-amber/10 px-3 py-2 text-xs text-ui-amber">
                {t('untrackedLimited', { skipped: skippedUntracked, total: totalUntracked })}
              </div>
            )}
            {!diff && !error && (
              <div className="flex h-full items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                  <GitBranch className="h-10 w-10 opacity-20" />
                  <span className="text-sm">{t('noChanges')}</span>
                </div>
              </div>
            )}
            {diff && <DiffFileList diff={diff} viewMode={viewMode} sessionName={sessionName} />}
          </>
        )}
      </div>
    </div>
  );
};

export default DiffPanel;

import { useState, useCallback, useEffect, useRef } from 'react';
import type { ISessionMeta } from '@/types/timeline';
import type { TAgentPanelType, TPanelType } from '@/types/terminal';
import { DEFAULT_AGENT_PANEL_TYPE } from '@/lib/panel-type';
import { buildSessionListQuery } from '@/lib/session-select-action';

const DEFAULT_LIMIT = 50;
const REFRESH_RETRY_MS = 1000;

interface ISessionListResponse {
  sessions: ISessionMeta[];
  total: number;
  hasMore: boolean;
  refreshing?: boolean;
}

interface IUseSessionListOptions {
  tmuxSession: string;
  enabled: boolean;
  cwd?: string;
  panelType?: TPanelType;
  providers?: TAgentPanelType[];
}

interface IUseSessionListReturn {
  sessions: ISessionMeta[];
  total: number;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  loadMore: () => Promise<void>;
}

const useSessionList = ({
  tmuxSession,
  enabled,
  cwd,
  panelType = DEFAULT_AGENT_PANEL_TYPE,
  providers,
}: IUseSessionListOptions): IUseSessionListReturn => {
  const [sessions, setSessions] = useState<ISessionMeta[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshRetryTick, setRefreshRetryTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const isLoadingMoreRef = useRef(false);

  const providersKey = providers?.join(',') ?? '';
  const sessionKey = `${panelType}:${tmuxSession}:${cwd ?? ''}:${providersKey}`;
  const [prevSessionKey, setPrevSessionKey] = useState(sessionKey);
  if (sessionKey !== prevSessionKey) {
    setPrevSessionKey(sessionKey);
    setSessions([]);
    setTotal(0);
    setHasMore(false);
    setIsLoading(true);
    setIsRefreshing(false);
    setRefreshRetryTick(0);
    setError(null);
  }

  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;
  const panelTypeRef = useRef(panelType);
  panelTypeRef.current = panelType;
  const providersRef = useRef(providers);
  providersRef.current = providers;

  const buildUrl = useCallback((offset: number) => {
    const params = buildSessionListQuery({
      tmuxSession,
      limit: DEFAULT_LIMIT,
      offset,
      panelType: panelTypeRef.current,
      cwd: cwdRef.current,
      providers: providersRef.current,
    });
    return `/api/timeline/sessions?${params.toString()}`;
  }, [tmuxSession]);

  const fetchSessions = useCallback(async (showLoading = true) => {
    if (!tmuxSession) return;
    if (showLoading) setIsLoading(true);
    setError(null);
    let keepLoading = false;

    try {
      const url = buildUrl(0);
      const res = await fetch(url);
      if (!res.ok) throw new Error('세션 목록을 불러올 수 없습니다');
      const data = await res.json() as ISessionListResponse;
      const refreshing = data.refreshing === true;
      setSessions(data.sessions);
      setTotal(data.total);
      setHasMore(data.hasMore);
      setIsRefreshing(refreshing);
      keepLoading = refreshing && data.sessions.length === 0;
    } catch (err) {
      setError(err instanceof Error ? err.message : '세션 목록을 불러올 수 없습니다');
      setIsRefreshing(false);
    } finally {
      setIsLoading(keepLoading);
    }
  }, [buildUrl, tmuxSession]);

  useEffect(() => {
    if (enabled) {
      fetchSessions();
    }
  }, [enabled, fetchSessions, sessionKey]);

  useEffect(() => {
    if (!enabled || !isRefreshing) return;
    const timer = window.setTimeout(() => {
      setRefreshRetryTick((tick) => tick + 1);
    }, REFRESH_RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, isRefreshing, refreshRetryTick]);

  useEffect(() => {
    if (!enabled || refreshRetryTick === 0) return;
    fetchSessions(false);
  }, [enabled, fetchSessions, refreshRetryTick]);

  const prevCwdRef = useRef(cwd);
  useEffect(() => {
    if (prevCwdRef.current !== cwd) {
      prevCwdRef.current = cwd;
      if (enabled) {
        fetchSessions();
      }
    }
  }, [cwd, enabled, fetchSessions]);

  const refetch = useCallback(async () => {
    await fetchSessions();
  }, [fetchSessions]);

  const loadMore = useCallback(async () => {
    if (!tmuxSession || isLoadingMoreRef.current || !hasMore) return;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);

    try {
      const offset = sessions.length;
      const url = buildUrl(offset);
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json() as ISessionListResponse;
      setSessions((prev) => [...prev, ...data.sessions]);
      setTotal(data.total);
      setHasMore(data.hasMore);
      setIsRefreshing(data.refreshing === true);
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [buildUrl, tmuxSession, hasMore, sessions.length]);

  return {
    sessions,
    total,
    hasMore,
    isLoading,
    isLoadingMore,
    error,
    refetch,
    loadMore,
  };
};

export default useSessionList;

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  sessionSearchPageSchema,
  type ISavedSessionFilter,
  type ISessionSearchPage,
  type ISessionSearchQuery,
} from '@/lib/session-catalog/contracts';
import type { IRuntimeSessionCatalogHealth } from '@/lib/runtime/contracts';
import type { ITimelineEntry } from '@/types/timeline';

interface ISessionReplayState {
  sessionId: string | null;
  entries: ITimelineEntry[];
  beforeByte: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
}

const EMPTY_PAGE: ISessionSearchPage = {
  results: [],
  nextCursor: null,
  total: 0,
  health: 'building',
};

const EMPTY_REPLAY: ISessionReplayState = {
  sessionId: null,
  entries: [],
  beforeByte: Number.MAX_SAFE_INTEGER,
  hasMore: false,
  loading: false,
  error: null,
};

const readJson = async <T,>(response: Response): Promise<T> => {
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `request-${response.status}`);
  return data;
};

const queryString = (query: ISessionSearchQuery): string => {
  const params = new URLSearchParams();
  params.set('query', query.query);
  for (const model of query.models ?? []) params.append('models', model);
  for (const project of query.projects ?? []) params.append('projects', project);
  for (const tag of query.tags ?? []) params.append('tags', tag);
  if (query.providers?.length) params.set('providers', query.providers.join(','));
  if (query.pinned !== undefined) params.set('pinned', String(query.pinned));
  if (query.dateFrom) params.set('dateFrom', query.dateFrom);
  if (query.dateTo) params.set('dateTo', query.dateTo);
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit) params.set('limit', String(query.limit));
  return params.toString();
};

const useSessionCatalog = () => {
  const [query, setQuery] = useState<ISessionSearchQuery>({ query: '', limit: 50 });
  const [page, setPage] = useState<ISessionSearchPage>(EMPTY_PAGE);
  const [health, setHealth] = useState<IRuntimeSessionCatalogHealth | null>(null);
  const [savedFilters, setSavedFilters] = useState<ISavedSessionFilter[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replay, setReplay] = useState<ISessionReplayState>(EMPTY_REPLAY);

  const refreshHealth = useCallback(async () => {
    const response = await fetch('/api/sessions/health');
    const value = await readJson<IRuntimeSessionCatalogHealth>(response);
    setHealth(value);
    return value;
  }, []);

  const refreshSavedFilters = useCallback(async () => {
    const response = await fetch('/api/sessions/saved-filters');
    const value = await readJson<{ filters: ISavedSessionFilter[] }>(response);
    setSavedFilters(value.filters);
  }, []);

  const search = useCallback(async (nextQuery: ISessionSearchQuery, append = false) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/sessions/search?${queryString(nextQuery)}`);
      const value = sessionSearchPageSchema.parse(await readJson<unknown>(response));
      setPage((previous) => append
        ? { ...value, results: [...previous.results, ...value.results] }
        : value);
      setQuery({ ...nextQuery, cursor: undefined });
      if (!append) setSelectedIndex(value.results.length > 0 ? 0 : -1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'catalog-unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.allSettled([
      search({ query: '', limit: 50 }),
      refreshHealth(),
      refreshSavedFilters(),
    ]);
  }, [refreshHealth, refreshSavedFilters, search]);

  const loadMore = useCallback(async () => {
    if (!page.nextCursor || loading) return;
    await search({ ...query, cursor: page.nextCursor }, true);
  }, [loading, page.nextCursor, query, search]);

  const updateAnnotation = useCallback(async (
    sessionId: string,
    input: { pinned: boolean; tags: string[]; expectedVersion: number },
  ) => {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/annotation`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const annotation = await readJson<ISessionSearchPage['results'][number]['annotation']>(response);
    setPage((previous) => ({
      ...previous,
      results: previous.results.map((result) => result.entry.sessionId === sessionId
        ? { ...result, annotation }
        : result),
    }));
  }, []);

  const togglePin = useCallback(async (sessionId: string) => {
    const result = page.results.find((candidate) => candidate.entry.sessionId === sessionId);
    if (!result) return;
    try {
      await updateAnnotation(sessionId, {
        pinned: !result.annotation?.pinned,
        tags: result.annotation?.tags ?? [],
        expectedVersion: result.annotation?.version ?? 0,
      });
    } catch {
      toast.error('Session annotation update failed.');
    }
  }, [page.results, updateAnnotation]);

  const updateTags = useCallback(async (sessionId: string, tags: string[]) => {
    const result = page.results.find((candidate) => candidate.entry.sessionId === sessionId);
    if (!result) return;
    try {
      await updateAnnotation(sessionId, {
        pinned: result.annotation?.pinned ?? false,
        tags,
        expectedVersion: result.annotation?.version ?? 0,
      });
    } catch {
      toast.error('Session annotation update failed.');
    }
  }, [page.results, updateAnnotation]);

  const rebuild = useCallback(async () => {
    try {
      await readJson(await fetch('/api/sessions/rebuild', { method: 'POST' }));
      await refreshHealth();
    } catch {
      toast.error('Session Catalog rebuild failed.');
    }
  }, [refreshHealth]);

  const saveFilter = useCallback(async (name: string) => {
    const id = `filter-${Date.now().toString(36)}`;
    await readJson(await fetch('/api/sessions/saved-filters', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, query }),
    }));
    await refreshSavedFilters();
  }, [query, refreshSavedFilters]);

  const deleteFilter = useCallback(async (id: string) => {
    await readJson(await fetch(`/api/sessions/saved-filters?id=${encodeURIComponent(id)}`, { method: 'DELETE' }));
    await refreshSavedFilters();
  }, [refreshSavedFilters]);

  const loadReplayPage = useCallback(async (sessionId: string, beforeByte: number, append: boolean) => {
    setReplay((previous) => ({ ...previous, sessionId, loading: true, error: null }));
    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/entries?beforeByte=${beforeByte}&limit=100`,
      );
      const value = await readJson<{
        entries: ITimelineEntry[];
        startByteOffset: number;
        hasMore: boolean;
      }>(response);
      setReplay((previous) => ({
        sessionId,
        entries: append ? [...value.entries, ...previous.entries] : value.entries,
        beforeByte: value.startByteOffset,
        hasMore: value.hasMore,
        loading: false,
        error: null,
      }));
    } catch (cause) {
      setReplay((previous) => ({
        ...previous,
        loading: false,
        error: cause instanceof Error ? cause.message : 'catalog-unavailable',
      }));
    }
  }, []);

  const openReplay = useCallback((sessionId: string) => {
    setReplay({ ...EMPTY_REPLAY, sessionId });
    void loadReplayPage(sessionId, Number.MAX_SAFE_INTEGER, false);
  }, [loadReplayPage]);

  const closeReplay = useCallback(() => setReplay(EMPTY_REPLAY), []);
  const loadMoreReplay = useCallback(async () => {
    if (!replay.sessionId || !replay.hasMore || replay.loading) return;
    await loadReplayPage(replay.sessionId, replay.beforeByte, true);
  }, [loadReplayPage, replay]);

  return {
    query,
    setQuery,
    page,
    health,
    savedFilters,
    selectedIndex,
    setSelectedIndex,
    loading,
    error,
    search,
    loadMore,
    togglePin,
    updateTags,
    rebuild,
    saveFilter,
    deleteFilter,
    replay,
    openReplay,
    closeReplay,
    loadMoreReplay,
  };
};

export default useSessionCatalog;

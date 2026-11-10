import { existsSync, watch, type FSWatcher } from 'fs';
import { stat } from 'fs/promises';
import {
  createRuntimeEvent,
  createRuntimeReply,
  parseRuntimeCommandPayload,
  type IRuntimeCommand,
  type IRuntimeEvent,
  type IRuntimeReply,
} from '@/lib/runtime/ipc';
import { validateWorkerCommandEnvelope, type IInvalidWorkerCommand } from '@/lib/runtime/worker-command-validation';
import { getProviderByPanelType, isAllowedAgentJsonlPath, type IAgentProvider } from '@/lib/providers';
import { DEFAULT_AGENT_PANEL_TYPE, normalizePanelType } from '@/lib/panel-type';
import { listSessionPage } from '@/lib/session-list';
import { findSessionRelationshipByJsonlPath } from '@/lib/session-index';
import { countTimelineMessages, emptyMessageCounts, type IMessageCountResult } from '@/lib/timeline-message-counts';
import type { ISessionWatcher } from '@/lib/session-detection';
import type {
  IRuntimeTimelineEntriesBeforeInput,
  IRuntimeSessionCatalogHealth,
  IRuntimeSessionCatalogReadEntriesInput,
  IRuntimeSessionCatalogRebuildResult,
  IRuntimeTimelineLiveSubscribePayload,
  IRuntimeTimelineLiveSubscribeResult,
  IRuntimeTimelineLiveUnsubscribeResult,
  IRuntimeTimelineSessionWatchSubscribePayload,
  IRuntimeTimelineSessionWatchSubscribeResult,
  IRuntimeTimelineSessionWatchUnsubscribeResult,
  IRuntimeTimelineSessionListInput,
  TRuntimeTimelineEntriesBeforeResult,
  TRuntimeTimelineCatalogSearchInput,
  TRuntimeSessionCatalogSearchResult,
} from '@/lib/runtime/contracts';
import type { IInitMeta, ISessionInfo, ITimelineEntry, ITimelineInitMessage } from '@/types/timeline';

interface IMessageCountCacheEntry {
  counts: IMessageCountResult;
  mtime: number;
  size: number;
}

interface ICreateTimelineWorkerServiceOptions {
  sendEvent?: (event: IRuntimeEvent) => void;
  getProvider?: (panelType: string) => IAgentProvider | null | undefined;
  catalog?: ITimelineCatalogService;
}

export interface ITimelineCatalogService {
  health(): IRuntimeSessionCatalogHealth | Promise<IRuntimeSessionCatalogHealth>;
  search(input: TRuntimeTimelineCatalogSearchInput): TRuntimeSessionCatalogSearchResult | Promise<TRuntimeSessionCatalogSearchResult>;
  readEntries(input: IRuntimeSessionCatalogReadEntriesInput): Promise<TRuntimeTimelineEntriesBeforeResult>;
  rebuild(): Promise<IRuntimeSessionCatalogRebuildResult>;
  observeFile(jsonlPath: string): Promise<void>;
  close(): void;
}

interface ILiveSubscriber {
  subscriberId: string;
  jsonlPath: string;
}

interface ILiveWatcher {
  watcher: FSWatcher | null;
  jsonlPath: string;
  offset: number;
  pendingBuffer: string;
  subscribers: Set<string>;
  provider: IAgentProvider;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  retryCount: number;
  processing: boolean;
  pendingChange: boolean;
}

interface ISessionWatchSubscriber {
  subscriberId: string;
  watchKey: string;
}

interface ISessionWatch {
  watcher: ISessionWatcher;
  sessionName: string;
  panePid: number;
  panelType: string;
  subscribers: Set<string>;
}

const CACHE_LIMIT = 100;
const MAX_INIT_ENTRIES = 64;
const DEBOUNCE_MS = 50;
const MAX_WATCHER_RETRIES = 3;

export const createTimelineWorkerService = (options: ICreateTimelineWorkerServiceOptions = {}) => {
  const messageCountsCache = new Map<string, IMessageCountCacheEntry>();
  const liveSubscribers = new Map<string, ILiveSubscriber>();
  const liveWatchers = new Map<string, ILiveWatcher>();
  const sessionWatchSubscribers = new Map<string, ISessionWatchSubscriber>();
  const sessionWatchers = new Map<string, ISessionWatch>();
  const getProvider = options.getProvider ?? getProviderByPanelType;

  // Catalog indexing is best-effort background work. The catalog rejects paths
  // outside its root (e.g. Claude transcripts), so an unobserved rejection here
  // would crash the timeline worker process.
  const observeCatalogFile = (jsonlPath: string): void => {
    options.catalog?.observeFile(jsonlPath).catch(() => undefined);
  };

  const ok = <TPayload>(command: IRuntimeCommand, payload: TPayload): IRuntimeReply<TPayload> =>
    createRuntimeReply({
      commandId: command.id,
      source: 'timeline',
      target: command.source,
      type: `${command.type}.reply`,
      ok: true,
      payload,
    });

  const fail = (command: IRuntimeCommand, code: string, message: string, retryable = false): IRuntimeReply<null> =>
    createRuntimeReply({
      commandId: command.id,
      source: 'timeline',
      target: command.source,
      type: `${command.type}.reply`,
      ok: false,
      payload: null,
      error: { code, message, retryable },
    });

  const invalidCommand = (command: IRuntimeCommand, error: IInvalidWorkerCommand): IRuntimeReply<null> =>
    createRuntimeReply({
      commandId: command.id,
      source: 'timeline',
      target: 'supervisor',
      type: `${command.type}.reply`,
      ok: false,
      payload: null,
      error,
    });

  const assertAllowedJsonlPath = (command: IRuntimeCommand, jsonlPath: string): IRuntimeReply<null> | null =>
    isAllowedAgentJsonlPath(jsonlPath)
      ? null
      : fail(command, 'timeline-jsonl-path-forbidden', 'Path not allowed');

  const emitEvent = <TPayload>(
    type: 'timeline.live-append' | 'timeline.live-error' | 'timeline.session-changed',
    payload: TPayload,
  ): void => {
    options.sendEvent?.(createRuntimeEvent({
      source: 'timeline',
      target: 'supervisor',
      type,
      delivery: 'realtime',
      payload,
    }));
  };

  const getCachedCounts = (key: string, mtime: number, size: number): IMessageCountResult | null => {
    const cached = messageCountsCache.get(key);
    if (!cached) return null;
    if (cached.mtime !== mtime || cached.size !== size) {
      messageCountsCache.delete(key);
      return null;
    }
    messageCountsCache.delete(key);
    messageCountsCache.set(key, cached);
    return cached.counts;
  };

  const setCachedCounts = (key: string, counts: IMessageCountResult, mtime: number, size: number): void => {
    if (messageCountsCache.has(key)) messageCountsCache.delete(key);
    messageCountsCache.set(key, { counts, mtime, size });
    while (messageCountsCache.size > CACHE_LIMIT) {
      const oldest = messageCountsCache.keys().next().value;
      if (oldest === undefined) break;
      messageCountsCache.delete(oldest);
    }
  };

  const listSessions = async (input: IRuntimeTimelineSessionListInput) => {
    const panelType = normalizePanelType(input.panelType) ?? DEFAULT_AGENT_PANEL_TYPE;
    const page = await listSessionPage(input.tmuxSession, input.cwd, panelType, {
      offset: input.offset,
      limit: input.limit,
      providers: input.providers,
    });
    for (const session of page.sessions) {
      if (session.jsonlPath) observeCatalogFile(session.jsonlPath);
    }
    return page;
  };

  const readEntriesBefore = async (
    command: IRuntimeCommand,
    input: IRuntimeTimelineEntriesBeforeInput,
  ): Promise<IRuntimeReply<TRuntimeTimelineEntriesBeforeResult> | IRuntimeReply<null>> => {
    const forbidden = assertAllowedJsonlPath(command, input.jsonlPath);
    if (forbidden) return forbidden;

    const provider = getProvider(input.panelType);
    if (!provider) {
      return fail(command, 'timeline-provider-unknown', `Unknown panel type: ${input.panelType}`);
    }

    const result = await provider.readEntriesBefore(input.jsonlPath, input.beforeByte, input.limit);
    return ok(command, {
      entries: result.entries,
      startByteOffset: result.startByteOffset,
      hasMore: result.hasMore,
    });
  };

  const computeInitMeta = (
    entries: ITimelineEntry[],
    fileSize: number,
    customTitle?: string,
  ): IInitMeta => {
    let createdAt: string | null = null;
    let updatedAt: string | null = null;
    let lastTimestamp = 0;
    let userCount = 0;
    let assistantCount = 0;

    for (const entry of entries) {
      if (!createdAt && entry.timestamp) createdAt = new Date(entry.timestamp).toISOString();
      if (entry.timestamp) {
        lastTimestamp = Math.max(lastTimestamp, entry.timestamp);
        updatedAt = new Date(entry.timestamp).toISOString();
      }
      if (entry.type === 'user-message') userCount++;
      else if (entry.type === 'assistant-message') assistantCount++;
    }

    return {
      createdAt,
      updatedAt,
      lastTimestamp,
      fileSize,
      userCount,
      assistantCount,
      customTitle,
    };
  };

  const removeLiveWatcher = (jsonlPath: string): void => {
    const watcher = liveWatchers.get(jsonlPath);
    if (!watcher) return;
    if (watcher.watcher) watcher.watcher.close();
    if (watcher.debounceTimer) clearTimeout(watcher.debounceTimer);
    for (const subscriberId of watcher.subscribers) {
      liveSubscribers.delete(subscriberId);
    }
    liveWatchers.delete(jsonlPath);
  };

  const removeLiveSubscriber = (subscriberId: string): boolean => {
    const subscriber = liveSubscribers.get(subscriberId);
    if (!subscriber) return false;
    liveSubscribers.delete(subscriberId);
    const watcher = liveWatchers.get(subscriber.jsonlPath);
    watcher?.subscribers.delete(subscriberId);
    if (watcher && watcher.subscribers.size === 0) {
      removeLiveWatcher(subscriber.jsonlPath);
    }
    return true;
  };

  const emitLiveError = (watcher: ILiveWatcher, code: string, message: string): void => {
    for (const subscriberId of watcher.subscribers) {
      emitEvent('timeline.live-error', {
        subscriberId,
        jsonlPath: watcher.jsonlPath,
        code,
        message,
      });
    }
  };

  const processLiveFileChange = async (watcher: ILiveWatcher): Promise<void> => {
    if (watcher.processing) {
      watcher.pendingChange = true;
      return;
    }

    watcher.processing = true;
    try {
      const { newEntries, newOffset, pendingBuffer } = await watcher.provider.parseIncremental(
        watcher.jsonlPath,
        watcher.offset,
        watcher.pendingBuffer,
      );
      watcher.pendingBuffer = pendingBuffer;
      if (newEntries.length > 0) {
        watcher.offset = newOffset;
        for (const subscriberId of watcher.subscribers) {
          emitEvent('timeline.live-append', {
            subscriberId,
            jsonlPath: watcher.jsonlPath,
            entries: newEntries,
          });
        }
      }
      observeCatalogFile(watcher.jsonlPath);
    } catch (err) {
      emitLiveError(watcher, 'timeline-live-parse-failed', err instanceof Error ? err.message : String(err));
    } finally {
      watcher.processing = false;
      if (watcher.pendingChange) {
        watcher.pendingChange = false;
        void processLiveFileChange(watcher);
      }
    }
  };

  const startLiveWatch = (watcher: ILiveWatcher): void => {
    try {
      watcher.watcher = watch(watcher.jsonlPath, () => {
        if (watcher.debounceTimer) clearTimeout(watcher.debounceTimer);
        watcher.debounceTimer = setTimeout(() => {
          void processLiveFileChange(watcher);
        }, DEBOUNCE_MS);
      });

      watcher.watcher.on('error', () => {
        if (watcher.retryCount < MAX_WATCHER_RETRIES) {
          watcher.retryCount++;
          if (watcher.watcher) watcher.watcher.close();
          watcher.watcher = null;
          setTimeout(() => startLiveWatch(watcher), 1000);
          return;
        }
        emitLiveError(watcher, 'watcher-failed', 'File watch failed (retries exceeded)');
      });
    } catch {
      emitLiveError(watcher, 'watcher-start-failed', 'File watch failed to start');
    }
  };

  const subscribeLive = async (
    command: IRuntimeCommand,
    input: IRuntimeTimelineLiveSubscribePayload,
  ): Promise<IRuntimeReply<IRuntimeTimelineLiveSubscribeResult> | IRuntimeReply<null>> => {
    const forbidden = assertAllowedJsonlPath(command, input.jsonlPath);
    if (forbidden) return forbidden;

    const provider = getProvider(input.panelType);
    if (!provider) {
      return fail(command, 'timeline-provider-unknown', `Unknown panel type: ${input.panelType}`);
    }

    let watcher = liveWatchers.get(input.jsonlPath);
    const isNewWatcher = !watcher;
    if (!watcher) {
      watcher = {
        watcher: null,
        jsonlPath: input.jsonlPath,
        offset: 0,
        pendingBuffer: '',
        subscribers: new Set(),
        provider,
        debounceTimer: null,
        retryCount: 0,
        processing: false,
        pendingChange: false,
      };
      liveWatchers.set(input.jsonlPath, watcher);
    }

    watcher.subscribers.add(input.subscriberId);
    liveSubscribers.set(input.subscriberId, {
      subscriberId: input.subscriberId,
      jsonlPath: input.jsonlPath,
    });

    if (!existsSync(input.jsonlPath)) {
      return ok(command, {
        subscriberId: input.subscriberId,
        subscribed: true,
        init: {
          type: 'timeline:init',
          entries: [],
          sessionId: input.sessionId ?? '',
          totalEntries: 0,
          startByteOffset: 0,
          hasMore: false,
          jsonlPath: input.jsonlPath,
        },
      });
    }

    let result: Awaited<ReturnType<IAgentProvider['readTailEntries']>>;
    try {
      result = await provider.readTailEntries(input.jsonlPath, MAX_INIT_ENTRIES);
    } catch (err) {
      removeLiveSubscriber(input.subscriberId);
      throw err;
    }
    if (isNewWatcher) {
      watcher.offset = result.fileSize;
      startLiveWatch(watcher);
    }

    const relationship = await findSessionRelationshipByJsonlPath(input.jsonlPath).catch(() => null);
    const init: ITimelineInitMessage = {
      type: 'timeline:init',
      entries: result.entries,
      sessionId: input.sessionId ?? '',
      totalEntries: result.entries.length,
      startByteOffset: result.startByteOffset,
      hasMore: result.hasMore,
      jsonlPath: input.jsonlPath,
      summary: result.summary,
      meta: computeInitMeta(result.entries, result.fileSize, result.customTitle),
      ...(relationship ? { relationship } : {}),
    };

    return ok(command, {
      subscriberId: input.subscriberId,
      subscribed: true,
      init,
    });
  };

  const unsubscribeLive = (
    command: IRuntimeCommand,
    subscriberId: string,
  ): IRuntimeReply<IRuntimeTimelineLiveUnsubscribeResult> => {
    const subscriber = liveSubscribers.get(subscriberId);
    if (!subscriber) return ok(command, { subscriberId, unsubscribed: false });

    removeLiveSubscriber(subscriberId);
    return ok(command, { subscriberId, unsubscribed: true });
  };

  const getMessageCounts = async (
    command: IRuntimeCommand,
    jsonlPath: string,
  ): Promise<IRuntimeReply<IMessageCountResult> | IRuntimeReply<null>> => {
    const forbidden = assertAllowedJsonlPath(command, jsonlPath);
    if (forbidden) return forbidden;

    try {
      const st = await stat(jsonlPath);
      const mtime = Math.floor(st.mtimeMs);
      const size = st.size;
      const cached = getCachedCounts(jsonlPath, mtime, size);
      if (cached) return ok(command, cached);
      const counts = await countTimelineMessages(jsonlPath);
      setCachedCounts(jsonlPath, counts, mtime, size);
      return ok(command, counts);
    } catch {
      return ok(command, emptyMessageCounts());
    }
  };

  const sessionWatchKey = (input: Pick<IRuntimeTimelineSessionWatchSubscribePayload, 'panelType' | 'panePid' | 'sessionName'>): string =>
    `${input.panelType}:${input.panePid}:${input.sessionName}`;

  const emitSessionChanged = (watch: ISessionWatch, info: ISessionInfo): void => {
    for (const subscriberId of watch.subscribers) {
      emitEvent('timeline.session-changed', {
        subscriberId,
        sessionName: watch.sessionName,
        info,
      });
    }
  };

  const removeSessionWatch = (watchKey: string): void => {
    const watch = sessionWatchers.get(watchKey);
    if (!watch) return;
    watch.watcher.stop();
    for (const subscriberId of watch.subscribers) {
      sessionWatchSubscribers.delete(subscriberId);
    }
    sessionWatchers.delete(watchKey);
  };

  const removeSessionWatchSubscriber = (subscriberId: string): boolean => {
    const subscriber = sessionWatchSubscribers.get(subscriberId);
    if (!subscriber) return false;
    sessionWatchSubscribers.delete(subscriberId);
    const watch = sessionWatchers.get(subscriber.watchKey);
    watch?.subscribers.delete(subscriberId);
    if (watch && watch.subscribers.size === 0) {
      removeSessionWatch(subscriber.watchKey);
    }
    return true;
  };

  const subscribeSessionWatch = (
    command: IRuntimeCommand,
    input: IRuntimeTimelineSessionWatchSubscribePayload,
  ): IRuntimeReply<IRuntimeTimelineSessionWatchSubscribeResult> | IRuntimeReply<null> => {
    const provider = getProvider(input.panelType);
    if (!provider) {
      return fail(command, 'timeline-provider-unknown', `Unknown panel type: ${input.panelType}`);
    }

    const watchKey = sessionWatchKey(input);
    let watch = sessionWatchers.get(watchKey);
    if (!watch) {
      const subscribers = new Set<string>();
      watch = {
        watcher: provider.watchSessions(
          input.panePid,
          (info) => {
            const current = sessionWatchers.get(watchKey);
            if (current) emitSessionChanged(current, info);
          },
          { skipInitial: input.skipInitial ?? true },
        ),
        sessionName: input.sessionName,
        panePid: input.panePid,
        panelType: input.panelType,
        subscribers,
      };
      sessionWatchers.set(watchKey, watch);
    }

    watch.subscribers.add(input.subscriberId);
    sessionWatchSubscribers.set(input.subscriberId, {
      subscriberId: input.subscriberId,
      watchKey,
    });

    return ok(command, { subscriberId: input.subscriberId, subscribed: true });
  };

  const unsubscribeSessionWatch = (
    command: IRuntimeCommand,
    subscriberId: string,
  ): IRuntimeReply<IRuntimeTimelineSessionWatchUnsubscribeResult> => {
    const unsubscribed = removeSessionWatchSubscriber(subscriberId);
    return ok(command, { subscriberId, unsubscribed });
  };

  return {
    async handleCommand(command: IRuntimeCommand): Promise<IRuntimeReply> {
      const invalid = validateWorkerCommandEnvelope(command, { workerName: 'timeline', namespace: 'timeline' });
      if (invalid) return invalidCommand(command, invalid);
      try {
        if (command.type === 'timeline.health') {
          return ok(command, { ok: true });
        }
        if (command.type === 'timeline.list-sessions') {
          const input = parseRuntimeCommandPayload('timeline.list-sessions', command.payload);
          return ok(command, await listSessions(input));
        }
        if (command.type === 'timeline.read-entries-before') {
          const input = parseRuntimeCommandPayload('timeline.read-entries-before', command.payload);
          return readEntriesBefore(command, input);
        }
        if (command.type === 'timeline.message-counts') {
          const input = parseRuntimeCommandPayload('timeline.message-counts', command.payload);
          return getMessageCounts(command, input.jsonlPath);
        }
        if (command.type === 'timeline.live-subscribe') {
          const input = parseRuntimeCommandPayload('timeline.live-subscribe', command.payload);
          return subscribeLive(command, input);
        }
        if (command.type === 'timeline.live-unsubscribe') {
          const input = parseRuntimeCommandPayload('timeline.live-unsubscribe', command.payload);
          return unsubscribeLive(command, input.subscriberId);
        }
        if (command.type === 'timeline.session-watch-subscribe') {
          const input = parseRuntimeCommandPayload('timeline.session-watch-subscribe', command.payload);
          return subscribeSessionWatch(command, input);
        }
        if (command.type === 'timeline.session-watch-unsubscribe') {
          const input = parseRuntimeCommandPayload('timeline.session-watch-unsubscribe', command.payload);
          return unsubscribeSessionWatch(command, input.subscriberId);
        }
        if (command.type === 'timeline.catalog-health') {
          parseRuntimeCommandPayload('timeline.catalog-health', command.payload);
          return ok(command, options.catalog
            ? await options.catalog.health()
            : {
              state: 'disabled',
              queueLag: 0,
              cursorAgeMs: null,
              rebuildState: 'idle',
              indexedSessions: 0,
              lastIndexedAt: null,
            });
        }
        if (command.type === 'timeline.catalog-search') {
          if (!options.catalog) return fail(command, 'catalog-disabled', 'Session Catalog is disabled.');
          const input = parseRuntimeCommandPayload('timeline.catalog-search', command.payload);
          return ok(command, await options.catalog.search(input));
        }
        if (command.type === 'timeline.catalog-read-entries') {
          if (!options.catalog) return fail(command, 'catalog-disabled', 'Session Catalog is disabled.');
          const input = parseRuntimeCommandPayload('timeline.catalog-read-entries', command.payload);
          return ok(command, await options.catalog.readEntries(input));
        }
        if (command.type === 'timeline.catalog-rebuild') {
          if (!options.catalog) return ok(command, { started: false, state: 'disabled' as const });
          parseRuntimeCommandPayload('timeline.catalog-rebuild', command.payload);
          return ok(command, await options.catalog.rebuild());
        }
        return invalidCommand(command, {
          code: 'invalid-worker-command',
          message: `Unsupported timeline command: ${command.type}`,
          retryable: false,
        });
      } catch (err) {
        const maybeStructured = err as { code?: string; retryable?: boolean } | null;
        return fail(
          command,
          maybeStructured?.code ?? 'command-failed',
          err instanceof Error ? err.message : String(err),
          maybeStructured?.retryable ?? false,
        );
      }
    },

    close(): void {
      messageCountsCache.clear();
      for (const jsonlPath of Array.from(liveWatchers.keys())) {
        removeLiveWatcher(jsonlPath);
      }
      liveSubscribers.clear();
      for (const watchKey of Array.from(sessionWatchers.keys())) {
        removeSessionWatch(watchKey);
      }
      sessionWatchSubscribers.clear();
      options.catalog?.close();
    },
  };
};

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTimelineFileWatcherService } from '@/lib/timeline/file-watcher-service';
import type { IAgentProvider } from '@/lib/providers';
import type { IFileWatcher } from '@/lib/timeline-server-state';
import type { ITimelineEntry, TTimelineServerMessage } from '@/types/timeline';

interface IFakeSocket {
  sent: TTimelineServerMessage[];
  send: (raw: string) => void;
}

const makeSocket = (): IFakeSocket => {
  const socket: IFakeSocket = {
    sent: [],
    send: (raw: string) => {
      socket.sent.push(JSON.parse(raw) as TTimelineServerMessage);
    },
  };
  return socket;
};

const makeProvider = (parseIncremental: IAgentProvider['parseIncremental']): IAgentProvider => ({
  id: 'codex',
  displayName: 'Codex',
  panelType: 'codex',
  statusBehavior: {
    watchJsonlWhenBound: true,
    deferStopHookUntilJsonlIdle: true,
    reconcileStateFromJsonl: true,
    recoverPaneInput: true,
  },
  matchesProcess: () => true,
  isValidSessionId: (id: unknown): id is string => typeof id === 'string',
  detectActiveSession: vi.fn(),
  isAgentRunning: vi.fn(),
  watchSessions: vi.fn(),
  buildResumeCommand: vi.fn(),
  buildLaunchCommand: vi.fn(),
  jsonlRoots: () => [],
  resolveJsonlPath: vi.fn(),
  parseJsonlContent: vi.fn(),
  readTailEntries: vi.fn(),
  readEntriesBefore: vi.fn(),
  parseIncremental,
  readJsonlStatus: vi.fn(),
  readSessionId: vi.fn(),
  writeSessionId: vi.fn(),
  readJsonlPath: vi.fn(),
  writeJsonlPath: vi.fn(),
  readSummary: vi.fn(),
  writeSummary: vi.fn(),
});

const makeWatcher = ({
  provider,
  socket = makeSocket(),
}: {
  provider: IAgentProvider;
  socket?: IFakeSocket;
}): IFileWatcher => ({
  watcher: null,
  jsonlPath: '/tmp/session.jsonl',
  offset: 100,
  pendingBuffer: 'pending',
  connections: new Set([socket as unknown as never]),
  debounceTimer: null,
  retryCount: 0,
  sessionName: 'codexmux:tab',
  provider,
  summaryResolved: false,
  processing: false,
  pendingChange: false,
  initOffsets: new Map(),
});

const flushTicks = async (predicate: () => boolean): Promise<void> => {
  for (let i = 0; i < 20 && !predicate(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('timeline file watcher service', () => {
  it('processes incremental entries and fans out append side effects', async () => {
    const entries: ITimelineEntry[] = [
      { id: 'u1', type: 'user-message', timestamp: 1000, text: 'hello' },
      { id: 'a1', type: 'assistant-message', timestamp: 2000, markdown: 'reply' },
    ];
    const provider = makeProvider(vi.fn(async () => ({
      newEntries: entries,
      newOffset: 150,
      pendingBuffer: '',
    })));
    const socket = makeSocket();
    const fw = makeWatcher({ provider, socket });
    const liveShadowAppends: Array<{ jsonlPath: string; entries: ITimelineEntry[] }> = [];
    const lastMessages: Array<{ sessionName: string; message: string }> = [];
    const summaries: Array<{ sessionName: string; summary: string | null }> = [];

    const service = createTimelineFileWatcherService({
      debounceMs: 10,
      maxWatcherRetries: 1,
      fileWatchers: new Map([[fw.jsonlPath, fw]]),
      canSend: () => true,
      broadcastWatcher: vi.fn(),
      onLiveShadowAppend: (jsonlPath, appended) => liveShadowAppends.push({ jsonlPath, entries: appended }),
      stopLiveShadow: vi.fn(),
      onLastUserMessage: (sessionName, message) => {
        lastMessages.push({ sessionName, message });
      },
      resolveAgentSummary: vi.fn(async () => 'summary'),
      onAgentSummary: (sessionName, _summaryProvider, summary) => {
        summaries.push({ sessionName, summary });
      },
    });

    await service.processFileChange(fw);

    expect(provider.parseIncremental).toHaveBeenCalledWith('/tmp/session.jsonl', 100, 'pending');
    expect(fw.offset).toBe(150);
    expect(fw.pendingBuffer).toBe('');
    expect(fw.summaryResolved).toBe(true);
    expect(socket.sent).toEqual([{ type: 'timeline:append', entries }]);
    expect(liveShadowAppends).toEqual([{ jsonlPath: '/tmp/session.jsonl', entries }]);
    expect(lastMessages).toEqual([{ sessionName: 'codexmux:tab', message: 'hello' }]);
    expect(summaries).toEqual([{ sessionName: 'codexmux:tab', summary: 'summary' }]);
  });

  it('queues one pending process when a file change arrives while processing', async () => {
    let resolveFirst: ((value: Awaited<ReturnType<IAgentProvider['parseIncremental']>>) => void) | undefined;
    const parseIncremental = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce({ newEntries: [], newOffset: 100, pendingBuffer: '' });
    const provider = makeProvider(parseIncremental);
    const fw = makeWatcher({ provider });
    const service = createTimelineFileWatcherService({
      debounceMs: 10,
      maxWatcherRetries: 1,
      fileWatchers: new Map([[fw.jsonlPath, fw]]),
      canSend: () => true,
      broadcastWatcher: vi.fn(),
      onLiveShadowAppend: vi.fn(),
      stopLiveShadow: vi.fn(),
      onLastUserMessage: vi.fn(),
      resolveAgentSummary: vi.fn(async () => null),
      onAgentSummary: vi.fn(),
    });

    const first = service.processFileChange(fw);
    await Promise.resolve();
    await service.processFileChange(fw);

    expect(fw.processing).toBe(true);
    expect(fw.pendingChange).toBe(true);
    resolveFirst?.({ newEntries: [], newOffset: 100, pendingBuffer: '' });
    await first;
    await flushTicks(() => parseIncremental.mock.calls.length === 2);

    expect(parseIncremental).toHaveBeenCalledTimes(2);
    expect(fw.processing).toBe(false);
    expect(fw.pendingChange).toBe(false);
  });

  it('debounces fs watch changes and removes watcher resources', async () => {
    vi.useFakeTimers();
    let changeListener: (() => void) | undefined;
    const close = vi.fn();
    const watchFile = vi.fn((_jsonlPath: string, listener: () => void) => {
      changeListener = listener;
      return { on: vi.fn(), close } as never;
    });
    const provider = makeProvider(vi.fn(async () => ({ newEntries: [], newOffset: 100, pendingBuffer: '' })));
    const fw = makeWatcher({ provider });
    const fileWatchers = new Map([[fw.jsonlPath, fw]]);
    const stopped: string[] = [];
    const service = createTimelineFileWatcherService({
      debounceMs: 25,
      maxWatcherRetries: 1,
      fileWatchers,
      watchFile,
      canSend: () => true,
      broadcastWatcher: vi.fn(),
      onLiveShadowAppend: vi.fn(),
      stopLiveShadow: (jsonlPath) => {
        stopped.push(jsonlPath);
      },
      onLastUserMessage: vi.fn(),
      resolveAgentSummary: vi.fn(async () => null),
      onAgentSummary: vi.fn(),
    });

    service.startFileWatch(fw);
    changeListener?.();
    expect(provider.parseIncremental).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(25);
    expect(provider.parseIncremental).toHaveBeenCalledTimes(1);

    service.removeFileWatcher(fw.jsonlPath);
    expect(close).toHaveBeenCalledTimes(1);
    expect(fileWatchers.has(fw.jsonlPath)).toBe(false);
    expect(stopped).toEqual([fw.jsonlPath]);
  });

  it('retries watcher errors and broadcasts failure after retry budget is exhausted', async () => {
    vi.useFakeTimers();
    const errorHandlers: Array<() => void> = [];
    const closes: Array<ReturnType<typeof vi.fn>> = [];
    const watchFile = vi.fn(() => {
      const close = vi.fn();
      closes.push(close);
      return {
        on: vi.fn((event: string, handler: () => void) => {
          if (event === 'error') errorHandlers.push(handler);
        }),
        close,
      } as never;
    });
    const broadcasts: Array<{ jsonlPath: string; message: TTimelineServerMessage }> = [];
    const provider = makeProvider(vi.fn(async () => ({ newEntries: [], newOffset: 100, pendingBuffer: '' })));
    const fw = makeWatcher({ provider });
    const service = createTimelineFileWatcherService({
      debounceMs: 10,
      maxWatcherRetries: 1,
      retryDelayMs: 5,
      fileWatchers: new Map([[fw.jsonlPath, fw]]),
      watchFile,
      canSend: () => true,
      broadcastWatcher: (jsonlPath, message) => broadcasts.push({ jsonlPath, message }),
      onLiveShadowAppend: vi.fn(),
      stopLiveShadow: vi.fn(),
      onLastUserMessage: vi.fn(),
      resolveAgentSummary: vi.fn(async () => null),
      onAgentSummary: vi.fn(),
    });

    service.startFileWatch(fw);
    errorHandlers[0]();
    expect(fw.retryCount).toBe(1);
    expect(closes[0]).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5);
    expect(watchFile).toHaveBeenCalledTimes(2);

    errorHandlers[1]();
    expect(broadcasts).toEqual([{
      jsonlPath: fw.jsonlPath,
      message: {
        type: 'timeline:error',
        code: 'watcher-failed',
        message: 'File watch failed (retries exceeded)',
      },
    }]);
  });
});

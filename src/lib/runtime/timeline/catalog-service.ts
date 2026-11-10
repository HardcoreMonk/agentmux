import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getDataDir } from '@/lib/app-identity';
import { createSessionCatalogRepository } from '@/lib/session-catalog/index-repository';
import { createSessionCatalogIndexer, type ISessionCatalogIndexFileInput } from '@/lib/session-catalog/indexer';
import { createSessionCatalogQueryService } from '@/lib/session-catalog/query-service';
import { openSessionCatalogDatabase } from '@/lib/session-catalog/schema';
import type {
  IRuntimeSessionCatalogHealth,
  IRuntimeSessionCatalogReadEntriesInput,
  IRuntimeSessionCatalogRebuildResult,
  TRuntimeTimelineCatalogSearchInput,
  TRuntimeSessionCatalogSearchResult,
  TRuntimeTimelineEntriesBeforeResult,
} from '@/lib/runtime/contracts';
import type { TSessionCatalogMode } from '@/lib/runtime/session-catalog-mode';
import { getProviderByPanelType, type IAgentProvider } from '@/lib/providers';
import { isValidClaudeSessionId } from '@/lib/claude-command';
import { getClaudeProjectsDir } from '@/lib/path-validation';
import type { TAgentPanelType } from '@/types/terminal';

export interface ICatalogRoot {
  root: string;
  provider: TAgentPanelType;
}

export interface ICreateTimelineCatalogServiceOptions {
  mode: Exclude<TSessionCatalogMode, 'off'>;
  dbPath?: string;
  roots?: ICatalogRoot[];
  getProvider?: (panelType: string) => IAgentProvider | null | undefined;
  now?: () => string;
}

const defaultHomeDir = (): string => process.env.HOME || process.env.USERPROFILE || os.homedir();

const defaultRoots = (): ICatalogRoot[] => [
  { root: path.join(defaultHomeDir(), '.codex', 'sessions'), provider: 'codex' },
  { root: getClaudeProjectsDir(defaultHomeDir()), provider: 'claude' },
];

// Claude layout: <root>/<project-dir>/<uuid>.jsonl. Subagent transcripts live deeper and are excluded.
const isClaudeTranscriptPath = (root: string, candidate: string): boolean => {
  const segments = path.relative(root, candidate).split(path.sep);
  return segments.length === 2 && isValidClaudeSessionId(path.basename(segments[1], '.jsonl'));
};

const isMissingError = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';

const realpathOrNull = async (target: string): Promise<string | null> => {
  try {
    return await fs.realpath(target);
  } catch (error) {
    if (isMissingError(error)) return null;
    throw error;
  }
};

const defaultDbPath = (): string =>
  path.join(getDataDir(), 'session-catalog', 'index.db');

const catalogError = (code: string, message: string, retryable = false): Error =>
  Object.assign(new Error(message), { code, retryable });

const isContainedPath = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
};

const readChunk = async (filePath: string, startByte: number): Promise<Buffer> => {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const length = Math.max(0, stat.size - startByte);
    const buffer = Buffer.alloc(length);
    if (length === 0) return buffer;
    const result = await handle.read(buffer, 0, length, startByte);
    return buffer.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
};

const collectJsonlFiles = async (root: string, depth = 0): Promise<string[]> => {
  if (depth > 5) return [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await collectJsonlFiles(candidate, depth + 1));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(candidate);
    if (files.length >= 100_000) break;
  }
  return files;
};

export const createTimelineCatalogService = ({
  mode,
  dbPath = defaultDbPath(),
  roots = defaultRoots(),
  getProvider = getProviderByPanelType,
  now = () => new Date().toISOString(),
}: ICreateTimelineCatalogServiceOptions) => {
  const db = openSessionCatalogDatabase(dbPath);
  const repository = createSessionCatalogRepository(db);
  const queryService = createSessionCatalogQueryService(repository);
  const indexer = createSessionCatalogIndexer({ repository, readChunk, now });
  let state: IRuntimeSessionCatalogHealth['state'] = 'ready';
  let rebuildState: IRuntimeSessionCatalogHealth['rebuildState'] = 'idle';
  let queueLag = 0;
  let lastIndexedAt: string | null = null;
  let queue = Promise.resolve();
  let rebuildPromise: Promise<void> | null = null;
  let rebuildAbort: AbortController | null = null;
  let closed = false;

  // A root that does not exist yet (e.g. no Claude install) is empty, not an error.
  const resolveRoots = async (): Promise<ICatalogRoot[]> => {
    const resolved = await Promise.all(roots.map(async (entry) => {
      const root = await realpathOrNull(entry.root);
      return root ? { root, provider: entry.provider } : null;
    }));
    return resolved.filter((entry): entry is ICatalogRoot => entry !== null);
  };

  const resolveIndexInput = async (jsonlPath: string): Promise<ISessionCatalogIndexFileInput> => {
    const [canonicalRoots, canonicalPath] = await Promise.all([
      resolveRoots(),
      fs.realpath(jsonlPath),
    ]);
    const match = canonicalRoots.find((candidate) => isContainedPath(candidate.root, canonicalPath));
    if (
      !match
      || path.extname(canonicalPath) !== '.jsonl'
      || (match.provider === 'claude' && !isClaudeTranscriptPath(match.root, canonicalPath))
    ) {
      throw catalogError('catalog-path-forbidden', 'Session Catalog path is outside the Session Catalog roots.');
    }
    const stat = await fs.stat(canonicalPath);
    if (!stat.isFile()) throw catalogError('catalog-path-forbidden', 'Session Catalog source is not a file.');
    return {
      fileKey: createHash('sha256').update(canonicalPath).digest('hex'),
      canonicalPath,
      fileIdentity: `${stat.dev}:${stat.ino}`,
      mtimeMs: stat.mtimeMs,
      sizeBytes: stat.size,
      provider: match.provider,
    };
  };

  const observeFile = async (jsonlPath: string): Promise<void> => {
    if (closed) throw catalogError('catalog-closed', 'Session Catalog is closed.');
    queueLag++;
    const task = queue.then(async () => {
      const input = await resolveIndexInput(jsonlPath);
      const result = await indexer.indexFile(input);
      if (result.indexed) lastIndexedAt = now();
      state = 'ready';
    });
    queue = task.catch(() => undefined);
    try {
      await task;
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'catalog-path-forbidden') state = 'degraded';
      throw error;
    } finally {
      queueLag--;
    }
  };

  const assertServing = (): void => {
    if (mode !== 'default') {
      throw catalogError('catalog-shadow-only', 'Session Catalog is running in shadow mode.');
    }
    if (state === 'degraded') {
      throw catalogError('catalog-unavailable', 'Session Catalog is degraded.', true);
    }
  };

  const health = (): IRuntimeSessionCatalogHealth => ({
    state,
    queueLag,
    cursorAgeMs: lastIndexedAt ? Math.max(0, Date.now() - new Date(lastIndexedAt).getTime()) : null,
    rebuildState,
    indexedSessions: repository.countSessions(),
    lastIndexedAt,
  });

  const rebuild = async (): Promise<IRuntimeSessionCatalogRebuildResult> => {
    if (rebuildPromise) return { started: false, state: 'already-building' };
    rebuildAbort = new AbortController();
    rebuildState = 'building';
    state = 'building';
    rebuildPromise = (async () => {
      try {
        const inputs: ISessionCatalogIndexFileInput[] = [];
        for (const entry of await resolveRoots()) {
          for (const file of await collectJsonlFiles(entry.root)) {
            if (entry.provider === 'claude' && !isClaudeTranscriptPath(entry.root, file)) continue;
            inputs.push(await resolveIndexInput(file));
          }
        }
        await indexer.rebuild(inputs, { signal: rebuildAbort?.signal, batchSize: 25 });
        lastIndexedAt = now();
        state = 'ready';
      } catch {
        state = 'degraded';
      } finally {
        rebuildState = 'idle';
        rebuildPromise = null;
        rebuildAbort = null;
      }
    })();
    return { started: true, state: 'building' };
  };

  return {
    health,
    search: (input: TRuntimeTimelineCatalogSearchInput): TRuntimeSessionCatalogSearchResult => {
      assertServing();
      return queryService.search(input);
    },
    readEntries: async (input: IRuntimeSessionCatalogReadEntriesInput): Promise<TRuntimeTimelineEntriesBeforeResult> => {
      assertServing();
      const cursor = repository.getFileCursorBySessionId(input.sessionId);
      const entry = repository.getSessionEntry(input.sessionId);
      if (!cursor || !entry) throw catalogError('catalog-session-not-found', 'Session Catalog entry was not found.');
      // The stored provider wins; the caller's panelType is not trusted for catalog replay.
      const provider = getProvider(entry.provider);
      if (!provider) throw catalogError('timeline-provider-unknown', 'Timeline provider was not found.');
      const result = await provider.readEntriesBefore(cursor.canonicalPath, input.beforeByte, input.limit);
      return {
        entries: result.entries,
        startByteOffset: result.startByteOffset,
        hasMore: result.hasMore,
      };
    },
    rebuild,
    observeFile,
    waitForIdle: async (): Promise<void> => {
      await rebuildPromise;
      await queue;
    },
    close: (): void => {
      closed = true;
      rebuildAbort?.abort();
      db.close();
    },
  };
};

export const createUnavailableTimelineCatalogService = () => ({
  health: (): IRuntimeSessionCatalogHealth => ({
    state: 'degraded',
    queueLag: 0,
    cursorAgeMs: null,
    rebuildState: 'idle',
    indexedSessions: 0,
    lastIndexedAt: null,
  }),
  search: (): never => {
    throw catalogError('catalog-unavailable', 'Session Catalog is unavailable.', true);
  },
  readEntries: async (): Promise<never> => {
    throw catalogError('catalog-unavailable', 'Session Catalog is unavailable.', true);
  },
  rebuild: async (): Promise<IRuntimeSessionCatalogRebuildResult> => ({
    started: false,
    state: 'disabled',
  }),
  observeFile: async (): Promise<void> => undefined,
  close: (): void => undefined,
});

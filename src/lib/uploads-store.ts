import { randomBytes } from 'crypto';
import type { Dirent } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { Transform, Writable, type Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { getDataDir } from '@/lib/app-identity';
import type { TUploadPolicy } from '@/lib/upload-request-contract';

const BASE_DIR = getDataDir();
const UPLOADS_DIR = path.join(BASE_DIR, 'uploads');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const STAGED_CLEANUP_MIN_AGE_MS = 30 * 60 * 1000;
const WINDOWS_RETRY_DELAYS_MS = [25, 50, 100, 200] as const;
const STAGED_FILE_PATTERN = /^\.[0-9a-f]{32}\.upload\.part$/;

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

interface IUploadBodySource extends NodeJS.ReadableStream {
  complete: boolean;
}

interface IStreamUploadArtifactInput {
  source: IUploadBodySource;
  policy: TUploadPolicy;
  declaredBytes: number;
  mime: string | null;
  originalName?: string;
  workspaceId?: string;
  tabId?: string;
  signal: AbortSignal;
  onProgress: () => void;
}

type TUploadReceipt = {
  path: string;
  filename: string;
};

type TUploadFailureReason =
  | 'upload-aborted'
  | 'upload-timeout'
  | 'length-mismatch'
  | 'payload-too-large'
  | 'storage-failure'
  | 'upload-server-shutting-down';

type TUploadTerminalCause =
  | { kind: 'abort' }
  | { kind: 'source' }
  | { kind: 'writer' }
  | { kind: 'transaction'; reason: TUploadFailureReason }
  | { kind: 'programming' };

type TUploadTransactionResult =
  | { committed: true; receipt: TUploadReceipt }
  | {
      committed: false;
      statusCode: 400 | 408 | 413 | 500 | 503;
      reason: TUploadFailureReason;
      cleanup: 'complete' | 'failed' | 'not-required';
    };

interface ICleanupResult {
  deleted: number;
  freedBytes: number;
}

interface IUploadsStoreDependencies {
  now?: () => number;
  randomBytes?: (size: number) => Buffer;
  sleep?: (milliseconds: number) => Promise<void>;
}

class UploadTransactionError extends Error {
  readonly reason: TUploadFailureReason;

  constructor(reason: TUploadFailureReason) {
    super(reason);
    this.name = 'UploadTransactionError';
    this.reason = reason;
  }
}

const sanitizeId = (value?: string): string => {
  if (!value) return 'unknown';
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 64) : 'unknown';
};

const sanitizeBase = (value: string | undefined, fallback: string): string => {
  const baseRaw = value ? path.parse(value).name : fallback;
  return baseRaw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || fallback;
};

const sanitizeExtension = (value: string | undefined): string => {
  const extRaw = value ? path.parse(value).ext.replace(/[^a-zA-Z0-9.]/g, '') : '';
  return extRaw.startsWith('.') ? extRaw.slice(0, 16) : '';
};

const isValidMime = (mime: string): mime is keyof typeof MIME_EXTENSIONS =>
  mime in MIME_EXTENSIONS;

const isNodeErrorWithCode = (error: unknown, ...codes: string[]): boolean =>
  error instanceof Error
  && 'code' in error
  && codes.includes(String((error as NodeJS.ErrnoException).code));

const isActualDirectory = async (directory: string): Promise<boolean> => {
  try {
    const stat = await fs.lstat(directory);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return false;
    throw error;
  }
};

const assertActualDirectory = async (directory: string): Promise<void> => {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new UploadTransactionError('storage-failure');
  }
};

const createActualDirectory = async (directory: string): Promise<void> => {
  try {
    await fs.mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (!isNodeErrorWithCode(error, 'EEXIST')) throw error;
  }
  await assertActualDirectory(directory);
};

const prepareUploadDirectory = async (
  workspaceId: string | undefined,
  tabId: string | undefined,
): Promise<{ directory: string; ownedDirectories: string[] }> => {
  await fs.mkdir(BASE_DIR, { recursive: true, mode: 0o700 });
  await assertActualDirectory(BASE_DIR);
  await createActualDirectory(UPLOADS_DIR);
  const workspaceDirectory = path.join(UPLOADS_DIR, sanitizeId(workspaceId));
  await createActualDirectory(workspaceDirectory);
  const directory = path.join(workspaceDirectory, sanitizeId(tabId));
  await createActualDirectory(directory);
  return {
    directory,
    ownedDirectories: [BASE_DIR, UPLOADS_DIR, workspaceDirectory, directory],
  };
};

const assertOwnedDirectories = async (directories: string[]): Promise<void> => {
  for (const directory of directories) await assertActualDirectory(directory);
};

const defaultSleep = async (milliseconds: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

const failureStatus = (reason: TUploadFailureReason): 400 | 408 | 413 | 500 | 503 => {
  if (reason === 'upload-timeout') return 408;
  if (reason === 'payload-too-large') return 413;
  if (reason === 'storage-failure') return 500;
  if (reason === 'upload-server-shutting-down') return 503;
  return 400;
};

const abortReason = (signal: AbortSignal): TUploadFailureReason => {
  if (signal.reason === 'upload-timeout') return 'upload-timeout';
  if (signal.reason === 'upload-server-shutting-down') return 'upload-server-shutting-down';
  return 'upload-aborted';
};

const createUploadsStore = (dependencies: IUploadsStoreDependencies = {}) => {
  const now = dependencies.now ?? Date.now;
  const createRandomBytes = dependencies.randomBytes ?? randomBytes;
  const sleep = dependencies.sleep ?? defaultSleep;
  const reservedFinalPaths = new Set<string>();

  const randomHex = (): string => createRandomBytes(16).toString('hex');

  const retryWindowsRace = async (
    operation: () => Promise<void>,
    beforeAttempt?: () => void,
  ): Promise<void> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        beforeAttempt?.();
        await operation();
        return;
      } catch (error) {
        if (
          !isNodeErrorWithCode(error, 'EPERM', 'EBUSY')
          || attempt >= WINDOWS_RETRY_DELAYS_MS.length
        ) {
          throw error;
        }
        await sleep(WINDOWS_RETRY_DELAYS_MS[attempt]);
      }
    }
  };

  const buildFinalFilename = (
    policy: TUploadPolicy,
    originalName: string | undefined,
    mime: string | null,
  ): string => {
    const stamp = now();
    const random = randomHex();
    if (policy.kind === 'image') {
      if (!mime || !isValidMime(mime)) throw new UploadTransactionError('storage-failure');
      return `${stamp}-${random}-${sanitizeBase(originalName, 'image')}.${MIME_EXTENSIONS[mime]}`;
    }
    return `${stamp}-${random}-${sanitizeBase(originalName, 'file')}${sanitizeExtension(originalName)}`;
  };

  const reserveFinalPath = async (
    directory: string,
    policy: TUploadPolicy,
    originalName: string | undefined,
    mime: string | null,
  ): Promise<{ filename: string; fullPath: string }> => {
    for (let attempt = 0; attempt < 128; attempt += 1) {
      const filename = buildFinalFilename(policy, originalName, mime);
      const fullPath = path.join(directory, filename);
      if (reservedFinalPaths.has(fullPath)) continue;
      reservedFinalPaths.add(fullPath);
      try {
        await fs.stat(fullPath);
        reservedFinalPaths.delete(fullPath);
        continue;
      } catch (error) {
        if (!isNodeErrorWithCode(error, 'ENOENT')) {
          reservedFinalPaths.delete(fullPath);
          throw error;
        }
      }
      return { filename, fullPath };
    }
    throw new UploadTransactionError('storage-failure');
  };

  const createStagedFile = async (directory: string) => {
    for (let attempt = 0; attempt < 128; attempt += 1) {
      const stagedPath = path.join(directory, `.${randomHex()}.upload.part`);
      try {
        const handle = await fs.open(stagedPath, 'wx', 0o600);
        return { handle, stagedPath };
      } catch (error) {
        if (isNodeErrorWithCode(error, 'EEXIST')) continue;
        throw error;
      }
    }
    throw new UploadTransactionError('storage-failure');
  };

  const pathsReferenceSameFile = async (left: string, right: string): Promise<boolean> => {
    try {
      const [leftStat, rightStat] = await Promise.all([fs.lstat(left), fs.lstat(right)]);
      return leftStat.isFile()
        && rightStat.isFile()
        && leftStat.ino !== 0
        && leftStat.dev === rightStat.dev
        && leftStat.ino === rightStat.ino;
    } catch {
      return false;
    }
  };

  const publishStagedFile = async (stagedPath: string, finalPath: string): Promise<void> => {
    try {
      await fs.link(stagedPath, finalPath);
    } catch (error) {
      if (
        isNodeErrorWithCode(error, 'EEXIST')
        && await pathsReferenceSameFile(stagedPath, finalPath)
      ) {
        return;
      }
      throw error;
    }
  };

  const createFileWriter = (
    fileHandle: Awaited<ReturnType<typeof fs.open>>,
    onWriteFailure: () => void,
  ) => {
    let activeWrite: Promise<void> | null = null;
    const writer = new Writable({
      write(chunk: Buffer | string, encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        const write = async (): Promise<void> => {
          let offset = 0;
          while (offset < buffer.length) {
            const { bytesWritten } = await fileHandle.write(
              buffer,
              offset,
              buffer.length - offset,
              null,
            );
            if (bytesWritten === 0) throw new Error('upload write made no progress');
            offset += bytesWritten;
          }
        };
        const operation = write();
        activeWrite = operation;
        void operation.then(
          () => {
            if (activeWrite === operation) activeWrite = null;
            callback();
          },
          (error: Error) => {
            onWriteFailure();
            if (activeWrite === operation) activeWrite = null;
            callback(error);
          },
        );
      },
    });
    const waitForActiveWrite = async (): Promise<void> => {
      const operation = activeWrite;
      if (!operation) return;
      try {
        await operation;
      } catch {
        // The pipeline result owns error classification after the write settles.
      }
    };
    return { writer, waitForActiveWrite };
  };

  const streamUploadArtifact = async (
    input: IStreamUploadArtifactInput,
  ): Promise<TUploadTransactionResult> => {
    if (input.declaredBytes > input.policy.maxBytes) {
      return {
        committed: false,
        statusCode: 413,
        reason: 'payload-too-large',
        cleanup: 'not-required',
      };
    }
    if (!Number.isSafeInteger(input.declaredBytes) || input.declaredBytes <= 0) {
      return {
        committed: false,
        statusCode: 400,
        reason: 'length-mismatch',
        cleanup: 'not-required',
      };
    }

    let directory = '';
    let ownedDirectories: string[] = [];
    let stagedPath: string | null = null;
    let finalPath: string | null = null;
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
    let closeAttempted = false;
    let committed = false;
    let observedBytes = 0;
    let firstFailure: TUploadTerminalCause | null = null;
    let writer: Writable | null = null;
    let waitForActiveWrite = async (): Promise<void> => undefined;
    let cleanupCloseFailed = false;
    let ownedDirectoryValidationFailed = false;

    const sourceErrorListener = (): void => {
      firstFailure ??= { kind: 'source' };
    };
    const writerErrorListener = (): void => {
      firstFailure ??= { kind: 'writer' };
    };
    const abortListener = (): void => {
      firstFailure ??= { kind: 'abort' };
    };
    const readFirstFailure = (): TUploadTerminalCause | null => firstFailure;
    const recordStorageFailure = (): void => {
      firstFailure ??= { kind: 'transaction', reason: 'storage-failure' };
    };
    const runStorageOperation = async <T>(operation: () => Promise<T>): Promise<T> => {
      try {
        return await operation();
      } catch (error) {
        recordStorageFailure();
        throw error;
      }
    };
    const validateOwnedDirectories = async (): Promise<void> => {
      try {
        await assertOwnedDirectories(ownedDirectories);
      } catch (error) {
        recordStorageFailure();
        ownedDirectoryValidationFailed = true;
        throw error;
      }
    };
    input.source.on('error', sourceErrorListener);
    input.source.on('aborted', sourceErrorListener);
    input.signal.addEventListener('abort', abortListener, { once: true });
    if (input.signal.aborted) abortListener();

    const closeHandle = async (): Promise<void> => {
      if (!handle || closeAttempted) return;
      await runStorageOperation(
        () => retryWindowsRace(async () => {
          await handle?.close();
        }),
      );
      closeAttempted = true;
    };

    const removeStagedFile = async (): Promise<'complete' | 'failed' | 'not-required'> => {
      if (!stagedPath || committed) return 'not-required';
      await waitForActiveWrite();
      try {
        await closeHandle();
      } catch {
        cleanupCloseFailed = true;
      }
      try {
        await retryWindowsRace(async () => {
          try {
            await fs.unlink(stagedPath as string);
          } catch (error) {
            if (
              !isNodeErrorWithCode(error, 'ENOENT')
              || ownedDirectoryValidationFailed
            ) {
              throw error;
            }
          }
        });
        return 'complete';
      } catch {
        return 'failed';
      }
    };

    try {
      if (input.signal.aborted) throw new UploadTransactionError(abortReason(input.signal));
      const prepared = await runStorageOperation(
        () => prepareUploadDirectory(input.workspaceId, input.tabId),
      );
      directory = prepared.directory;
      ownedDirectories = prepared.ownedDirectories;
      await runStorageOperation(() => assertOwnedDirectories(ownedDirectories));
      const staged = await runStorageOperation(() => createStagedFile(directory));
      stagedPath = staged.stagedPath;
      handle = staged.handle;
      await validateOwnedDirectories();
      await runStorageOperation(() => staged.handle.chmod(0o600));
      const fileWriter = createFileWriter(handle, writerErrorListener);
      writer = fileWriter.writer;
      waitForActiveWrite = fileWriter.waitForActiveWrite;
      writer.on('error', writerErrorListener);

      const counter = new Transform({
        transform(chunk: Buffer | string, encoding, callback) {
          const chunkBytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk, encoding);
          const nextBytes = observedBytes + chunkBytes;
          if (nextBytes > input.policy.maxBytes) {
            firstFailure ??= { kind: 'transaction', reason: 'payload-too-large' };
            callback(new UploadTransactionError('payload-too-large'));
            return;
          }
          if (nextBytes > input.declaredBytes) {
            firstFailure ??= { kind: 'transaction', reason: 'length-mismatch' };
            callback(new UploadTransactionError('length-mismatch'));
            return;
          }
          observedBytes = nextBytes;
          try {
            input.onProgress();
          } catch (error) {
            firstFailure ??= { kind: 'programming' };
            callback(error as Error);
            return;
          }
          callback(null, chunk);
        },
      });

      await runStorageOperation(
        () => pipeline(input.source as unknown as Readable, counter, fileWriter.writer, {
          signal: input.signal,
        }),
      );
      if (input.signal.aborted) throw new UploadTransactionError(abortReason(input.signal));
      if (observedBytes !== input.declaredBytes || !input.source.complete) {
        firstFailure ??= { kind: 'transaction', reason: 'length-mismatch' };
        throw new UploadTransactionError('length-mismatch');
      }
      await closeHandle();
      if (input.signal.aborted) throw new UploadTransactionError(abortReason(input.signal));
      await validateOwnedDirectories();

      for (let collisionAttempt = 0; collisionAttempt < 128; collisionAttempt += 1) {
        const finalTarget = await runStorageOperation(
          () => reserveFinalPath(
            directory,
            input.policy,
            input.originalName,
            input.mime,
          ),
        );
        finalPath = finalTarget.fullPath;
        try {
          await retryWindowsRace(
            () => publishStagedFile(stagedPath as string, finalTarget.fullPath),
            () => {
              if (input.signal.aborted) {
                throw new UploadTransactionError(abortReason(input.signal));
              }
            },
          );
          committed = true;
          try {
            await retryWindowsRace(async () => {
              try {
                await fs.unlink(stagedPath as string);
              } catch (error) {
                if (!isNodeErrorWithCode(error, 'ENOENT')) throw error;
              }
            });
          } catch {
            // The hard link is the commit point; stale stage cleanup is safe to retry later.
          }
          return {
            committed: true,
            receipt: { path: finalTarget.fullPath, filename: finalTarget.filename },
          };
        } catch (error) {
          reservedFinalPaths.delete(finalTarget.fullPath);
          finalPath = null;
          if (isNodeErrorWithCode(error, 'EEXIST', 'ENOTEMPTY')) continue;
          recordStorageFailure();
          throw error;
        }
      }
      recordStorageFailure();
      throw new UploadTransactionError('storage-failure');
    } catch (error) {
      const terminalCause = readFirstFailure();
      const reasonBeforeCleanup: TUploadFailureReason = terminalCause?.kind === 'abort'
        ? abortReason(input.signal)
        : terminalCause?.kind === 'source'
          ? 'upload-aborted'
          : terminalCause?.kind === 'writer'
            ? 'storage-failure'
            : terminalCause?.kind === 'transaction'
              ? terminalCause.reason
              : error instanceof UploadTransactionError
                ? error.reason
                : input.signal.aborted
                  ? abortReason(input.signal)
                  : 'storage-failure';
      const cleanup = await removeStagedFile();
      if (
        terminalCause?.kind === 'programming'
        && cleanup !== 'failed'
        && !cleanupCloseFailed
      ) {
        throw error;
      }
      const reason = cleanup === 'failed' || cleanupCloseFailed
        ? 'storage-failure'
        : reasonBeforeCleanup;
      return {
        committed: false,
        statusCode: failureStatus(reason),
        reason,
        cleanup,
      };
    } finally {
      input.source.off('error', sourceErrorListener);
      input.source.off('aborted', sourceErrorListener);
      input.signal.removeEventListener('abort', abortListener);
      writer?.off('error', writerErrorListener);
      if (finalPath) reservedFinalPaths.delete(finalPath);
    }
  };

  return { streamUploadArtifact };
};

const defaultStore = createUploadsStore();
const streamUploadArtifact = defaultStore.streamUploadArtifact;

type TRemovalResult = { removed: true; bytes: number } | { removed: false; bytes: 0 };

const removeFileSafe = async (filePath: string, bytes: number): Promise<TRemovalResult> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.unlink(filePath);
      return { removed: true, bytes };
    } catch (error) {
      if (isNodeErrorWithCode(error, 'ENOENT')) return { removed: false, bytes: 0 };
      if (
        !isNodeErrorWithCode(error, 'EPERM', 'EBUSY')
        || attempt >= WINDOWS_RETRY_DELAYS_MS.length
      ) {
        throw error;
      }
      await defaultSleep(WINDOWS_RETRY_DELAYS_MS[attempt]);
    }
  }
};

const readActualDirectoryEntries = async (directory: string): Promise<Dirent[] | null> => {
  let stat;
  try {
    stat = await fs.lstat(directory);
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return null;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return null;
    throw error;
  }
};

const removeEmptyDirs = async (dir: string): Promise<void> => {
  const entries = await readActualDirectoryEntries(dir);
  if (!entries) return;
  if (entries.length === 0 && dir !== UPLOADS_DIR) {
    try {
      await fs.rmdir(dir);
    } catch (error) {
      if (isNodeErrorWithCode(error, 'ENOENT', 'ENOTEMPTY', 'EEXIST', 'ENOTDIR')) return;
      throw error;
    }
  }
};

const walkUploads = async (
  visit: (
    filePath: string,
    filename: string,
    mtimeMs: number,
    size: number,
  ) => Promise<TRemovalResult>,
): Promise<ICleanupResult> => {
  const result: ICleanupResult = { deleted: 0, freedBytes: 0 };

  if (!await isActualDirectory(BASE_DIR)) return result;
  const wsDirs = await readActualDirectoryEntries(UPLOADS_DIR);
  if (!wsDirs) return result;

  for (const ws of wsDirs) {
    if (!ws.isDirectory() || ws.isSymbolicLink()) continue;
    const wsPath = path.join(UPLOADS_DIR, ws.name);
    const tabDirs = await readActualDirectoryEntries(wsPath);
    if (!tabDirs) continue;
    for (const tab of tabDirs) {
      if (!tab.isDirectory() || tab.isSymbolicLink()) continue;
      const tabPath = path.join(wsPath, tab.name);
      const files = await readActualDirectoryEntries(tabPath);
      if (!files) continue;
      for (const file of files) {
        if (!file.isFile() || file.isSymbolicLink()) continue;
        const filePath = path.join(tabPath, file.name);
        let stat;
        try {
          stat = await fs.lstat(filePath);
        } catch (error) {
          if (isNodeErrorWithCode(error, 'ENOENT')) continue;
          throw error;
        }
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        const removal = await visit(filePath, file.name, stat.mtimeMs, stat.size);
        if (removal.removed) {
          result.deleted += 1;
          result.freedBytes += removal.bytes;
        }
      }
      await removeEmptyDirs(tabPath);
    }
    await removeEmptyDirs(wsPath);
  }
  return result;
};

const cleanupExpiredUploads = async (maxAgeMs: number = DEFAULT_TTL_MS): Promise<ICleanupResult> => {
  const cutoff = Date.now() - maxAgeMs;
  return walkUploads(async (filePath, filename, mtimeMs, size) => {
    if (STAGED_FILE_PATTERN.test(filename)) return { removed: false, bytes: 0 };
    if (mtimeMs < cutoff) {
      return removeFileSafe(filePath, size);
    }
    return { removed: false, bytes: 0 };
  });
};

const cleanupAllUploads = async (): Promise<ICleanupResult> =>
  walkUploads(async (filePath, filename, _mtimeMs, size) => {
    if (STAGED_FILE_PATTERN.test(filename)) return { removed: false, bytes: 0 };
    return removeFileSafe(filePath, size);
  });

const cleanupStaleUploadParts = async (
  minimumAgeMs: number = STAGED_CLEANUP_MIN_AGE_MS,
): Promise<ICleanupResult> => {
  const ageMs = Math.max(minimumAgeMs, STAGED_CLEANUP_MIN_AGE_MS);
  const cutoff = Date.now() - ageMs;
  return walkUploads(async (filePath, filename, mtimeMs, size) => {
    if (!STAGED_FILE_PATTERN.test(filename) || mtimeMs >= cutoff) {
      return { removed: false, bytes: 0 };
    }
    return removeFileSafe(filePath, size);
  });
};

export {
  streamUploadArtifact,
  createUploadsStore,
  cleanupExpiredUploads,
  cleanupAllUploads,
  cleanupStaleUploadParts,
  UPLOADS_DIR,
};
export type {
  ICleanupResult,
  IStreamUploadArtifactInput,
  IUploadBodySource,
  TUploadReceipt,
  TUploadTransactionResult,
};

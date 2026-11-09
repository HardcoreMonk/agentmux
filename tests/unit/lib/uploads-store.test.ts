import { createHash } from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { PassThrough, Readable } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FILE_UPLOAD_POLICY,
  IMAGE_UPLOAD_POLICY,
  type TUploadPolicy,
} from '@/lib/upload-request-contract';

type TUploadBodySource = Readable & { complete: boolean };

const CHUNK_BYTES = 64 * 1024;
const STAGED_FILE_PATTERN = /^\.[0-9a-f]{32}\.upload\.part$/;
const DIRECTORY_LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';

let homeDir = '';

const loadStore = async () => {
  vi.resetModules();
  return import('@/lib/uploads-store');
};

const createRepeatedSource = (
  totalBytes: number,
  options: { complete?: boolean; fill?: number; chunkBytes?: number } = {},
): TUploadBodySource => {
  const chunk = Buffer.alloc(options.chunkBytes ?? CHUNK_BYTES, options.fill ?? 0x5a);
  let remaining = totalBytes;
  const source = new Readable({
    read() {
      if (remaining === 0) {
        source.complete = options.complete ?? true;
        this.push(null);
        return;
      }
      const bytes = Math.min(remaining, chunk.length);
      remaining -= bytes;
      this.push(bytes === chunk.length ? chunk : chunk.subarray(0, bytes));
    },
  }) as TUploadBodySource;
  source.complete = false;
  return source;
};

const streamInput = (
  source: TUploadBodySource,
  policy: TUploadPolicy,
  declaredBytes: number,
  overrides: Record<string, unknown> = {},
) => ({
  source,
  policy,
  declaredBytes,
  mime: policy.kind === 'image' ? 'image/png' : null,
  originalName: policy.kind === 'image' ? '../screen shot.png' : '../archive.part',
  workspaceId: 'ws/unsafe',
  tabId: 'tab:unsafe',
  signal: new AbortController().signal,
  onProgress: vi.fn(),
  ...overrides,
});

const listArtifactFiles = async (uploadsDir: string): Promise<string[]> => {
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else files.push(fullPath);
    }
  };
  await walk(uploadsDir);
  return files;
};

const digestFile = async (filePath: string): Promise<string> => {
  const hash = createHash('sha256');
  const file = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(CHUNK_BYTES);
    for (;;) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await file.close();
  }
  return hash.digest('hex');
};

const digestRepeatedBytes = (totalBytes: number, fill: number): string => {
  const hash = createHash('sha256');
  const chunk = Buffer.alloc(CHUNK_BYTES, fill);
  let remaining = totalBytes;
  while (remaining > 0) {
    const bytes = Math.min(remaining, chunk.length);
    hash.update(chunk.subarray(0, bytes));
    remaining -= bytes;
  }
  return hash.digest('hex');
};

const waitFor = async (predicate: () => Promise<boolean>): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition was not met');
};

const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

describe('uploads store streaming transaction', () => {
  beforeEach(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-uploads-store-'));
    vi.stubEnv('HOME', homeDir);
    vi.stubEnv('USERPROFILE', homeDir);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it.each([
    ['image', IMAGE_UPLOAD_POLICY, 10 * 1024 * 1024],
    ['file', FILE_UPLOAD_POLICY, 50 * 1024 * 1024],
  ] as const)('commits an exact-limit %s from repeated bounded chunks', async (_, policy, bytes) => {
    const store = await loadStore();
    const source = createRepeatedSource(bytes);
    const input = streamInput(source, policy, bytes);

    const result = await store.streamUploadArtifact(input);

    expect(result.committed).toBe(true);
    if (!result.committed) throw new Error('expected committed upload');
    await expect(fs.stat(result.receipt.path)).resolves.toMatchObject({ size: bytes });
    expect(input.onProgress).toHaveBeenCalledTimes(bytes / CHUNK_BYTES);
    if (process.platform !== 'win32') {
      expect((await fs.stat(result.receipt.path)).mode & 0o777).toBe(0o600);
    }
  }, 30_000);

  it('preserves the exact size and SHA-256 of a 37MiB stream', async () => {
    const store = await loadStore();
    const bytes = 37 * 1024 * 1024;
    const fill = 0xa7;

    const result = await store.streamUploadArtifact(streamInput(
      createRepeatedSource(bytes, { fill }),
      FILE_UPLOAD_POLICY,
      bytes,
    ));

    expect(result.committed).toBe(true);
    if (!result.committed) throw new Error('expected committed upload');
    expect(await digestFile(result.receipt.path)).toBe(digestRepeatedBytes(bytes, fill));
    expect((await fs.stat(result.receipt.path)).size).toBe(bytes);
  }, 30_000);

  it('uses an exclusive same-directory staged file and closes it before publication', async () => {
    const store = await loadStore();
    const source = new PassThrough() as PassThrough & { complete: boolean };
    source.complete = false;
    const events: string[] = [];
    const realOpen = fs.open.bind(fs);
    const realLink = fs.link.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      events.push(`open:${String(args[1])}:${Number(args[2]).toString(8)}`);
      const handle = await realOpen(...args);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        events.push('close');
        await close();
      };
      return handle;
    });
    vi.spyOn(fs, 'link').mockImplementation(async (existingPath, newPath) => {
      events.push(`link:${path.dirname(String(existingPath)) === path.dirname(String(newPath))}`);
      await realLink(existingPath, newPath);
    });

    const transaction = store.streamUploadArtifact(streamInput(
      source as TUploadBodySource,
      FILE_UPLOAD_POLICY,
      2,
      { originalName: 'report.part' },
    ));
    source.write(Buffer.from('a'));
    await waitFor(async () => (await listArtifactFiles(store.UPLOADS_DIR)).length === 1);

    const [stagedPath] = await listArtifactFiles(store.UPLOADS_DIR);
    expect(path.basename(stagedPath)).toMatch(STAGED_FILE_PATTERN);
    if (process.platform !== 'win32') {
      expect((await fs.stat(stagedPath)).mode & 0o777).toBe(0o600);
    }
    source.complete = true;
    source.end(Buffer.from('b'));

    const result = await transaction;
    expect(result.committed).toBe(true);
    expect(events[0]).toBe('open:wx:600');
    expect(events.indexOf('close')).toBeLessThan(events.indexOf('link:true'));
  });

  it('generates a 128-bit final name while preserving sanitized basename and extension', async () => {
    const store = await loadStore();
    const result = await store.streamUploadArtifact(streamInput(
      createRepeatedSource(1),
      FILE_UPLOAD_POLICY,
      1,
      { originalName: '../unsafe report!!.part' },
    ));

    expect(result.committed).toBe(true);
    if (!result.committed) throw new Error('expected committed upload');
    expect(result.receipt.filename).toMatch(/^\d+-[0-9a-f]{32}-unsafe_report__\.part$/);
    expect(path.dirname(result.receipt.path)).toBe(path.join(store.UPLOADS_DIR, 'wsunsafe', 'tabunsafe'));
  });

  it.each([
    ['short body', createRepeatedSource(1), 2, undefined, 'length-mismatch'],
    ['incomplete body', createRepeatedSource(1, { complete: false }), 1, undefined, 'length-mismatch'],
    ['declared overrun', createRepeatedSource(2), 1, undefined, 'length-mismatch'],
    ['policy overflow', createRepeatedSource(2), 1, { maxBytes: 1 }, 'payload-too-large'],
  ] as const)('rejects %s without leaving a staged or final artifact', async (_, source, declared, policyPatch, reason) => {
    const store = await loadStore();
    const policy = policyPatch ? { ...FILE_UPLOAD_POLICY, ...policyPatch } : FILE_UPLOAD_POLICY;

    const result = await store.streamUploadArtifact(streamInput(source, policy, declared));

    expect(result).toMatchObject({ committed: false, reason, cleanup: 'complete' });
    expect(await listArtifactFiles(store.UPLOADS_DIR)).toEqual([]);
  });

  it('rejects a zero declared length before creating a staged file', async () => {
    const store = await loadStore();

    const result = await store.streamUploadArtifact(streamInput(
      createRepeatedSource(0),
      FILE_UPLOAD_POLICY,
      0,
    ));

    expect(result).toMatchObject({
      committed: false,
      statusCode: 400,
      reason: 'length-mismatch',
      cleanup: 'not-required',
    });
    expect(await listArtifactFiles(store.UPLOADS_DIR)).toEqual([]);
  });

  it.each([
    ['policy overflow', { ...FILE_UPLOAD_POLICY, maxBytes: 1 }, 413, 'payload-too-large'],
    ['declared overrun', { ...FILE_UPLOAD_POLICY, maxBytes: 2 }, 400, 'length-mismatch'],
  ] as const)('keeps counter-first %s ahead of a same-tick timeout', async (_, policy, statusCode, reason) => {
    const store = await loadStore();
    const controller = new AbortController();
    let pushed = false;
    const source = new Readable({
      read() {
        if (pushed) return;
        pushed = true;
        this.push(Buffer.from('ab'));
        process.nextTick(() => controller.abort('upload-timeout'));
        source.complete = true;
        this.push(null);
      },
    }) as TUploadBodySource;
    source.complete = false;

    const result = await store.streamUploadArtifact(streamInput(
      source,
      policy,
      1,
      { signal: controller.signal },
    ));

    expect(result).toMatchObject({ committed: false, statusCode, reason, cleanup: 'complete' });
    expect(await listArtifactFiles(store.UPLOADS_DIR)).toEqual([]);
  });

  it('maps a source error to upload-aborted and removes the staged file', async () => {
    const store = await loadStore();
    const source = new Readable({
      read() {
        this.destroy(new Error('socket failed'));
      },
    }) as TUploadBodySource;
    source.complete = false;

    const result = await store.streamUploadArtifact(streamInput(source, FILE_UPLOAD_POLICY, 1));

    expect(result).toMatchObject({ committed: false, reason: 'upload-aborted', cleanup: 'complete' });
    expect(await listArtifactFiles(store.UPLOADS_DIR)).toEqual([]);
  });

  it('keeps a source aborted event ahead of incomplete-body validation', async () => {
    const store = await loadStore();
    const source = new PassThrough() as PassThrough & { complete: boolean };
    source.complete = false;
    const transaction = store.streamUploadArtifact(streamInput(
      source as TUploadBodySource,
      FILE_UPLOAD_POLICY,
      1,
    ));
    source.write(Buffer.from('a'));
    await waitFor(async () => (await listArtifactFiles(store.UPLOADS_DIR)).length === 1);

    source.emit('aborted');
    source.end();
    const result = await transaction;

    expect(result).toMatchObject({
      committed: false,
      statusCode: 400,
      reason: 'upload-aborted',
      cleanup: 'complete',
    });
    expect(await listArtifactFiles(store.UPLOADS_DIR)).toEqual([]);
  });

  it('maps an aborted signal before commit and removes the staged file', async () => {
    const store = await loadStore();
    const controller = new AbortController();
    const source = new PassThrough() as PassThrough & { complete: boolean };
    source.complete = false;
    const transaction = store.streamUploadArtifact(streamInput(
      source as TUploadBodySource,
      FILE_UPLOAD_POLICY,
      2,
      { signal: controller.signal },
    ));
    source.write(Buffer.from('a'));
    await waitFor(async () => (await listArtifactFiles(store.UPLOADS_DIR)).length === 1);

    controller.abort('upload-aborted');
    const result = await transaction;

    expect(result).toMatchObject({ committed: false, reason: 'upload-aborted', cleanup: 'complete' });
    expect(await listArtifactFiles(store.UPLOADS_DIR)).toEqual([]);
  });

  it('maps writer failure to storage-failure rather than a propagated source error', async () => {
    const store = await loadStore();
    const realOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      handle.write = vi.fn(async () => {
        throw new Error('disk write failed');
      }) as typeof handle.write;
      return handle;
    });

    const result = await store.streamUploadArtifact(streamInput(
      createRepeatedSource(1),
      FILE_UPLOAD_POLICY,
      1,
    ));

    expect(result).toMatchObject({ committed: false, reason: 'storage-failure', cleanup: 'complete' });
    expect(await listArtifactFiles(store.UPLOADS_DIR)).toEqual([]);
  });

  it('keeps a writer failure as the terminal cause when timeout arrives during cleanup', async () => {
    const store = await loadStore();
    const controller = new AbortController();
    const realOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      const close = handle.close.bind(handle);
      handle.write = vi.fn(async () => {
        throw new Error('disk write failed');
      }) as unknown as typeof handle.write;
      handle.close = async () => {
        controller.abort('upload-timeout');
        await close();
      };
      return handle;
    });

    const result = await store.streamUploadArtifact(streamInput(
      createRepeatedSource(1),
      FILE_UPLOAD_POLICY,
      1,
      { signal: controller.signal },
    ));

    expect(result).toMatchObject({ committed: false, statusCode: 500, reason: 'storage-failure' });
  });

  it('keeps a pre-commit directory validation failure ahead of a queued timeout', async () => {
    const store = await loadStore();
    const controller = new AbortController();
    const baseDirectory = path.dirname(store.UPLOADS_DIR);
    const realLstat = fs.lstat.bind(fs);
    let baseChecks = 0;
    let rejectFailure = (_error: Error): void => undefined;
    let reportPrecommitCheck = (): void => undefined;
    const failurePromise = new Promise<never>((_resolve, reject) => {
      rejectFailure = reject;
    });
    const precommitCheck = new Promise<void>((resolve) => {
      reportPrecommitCheck = resolve;
    });
    vi.spyOn(fs, 'lstat').mockImplementation((filePath) => {
      if (String(filePath) === baseDirectory) {
        baseChecks += 1;
        if (baseChecks === 4) {
          reportPrecommitCheck();
          void failurePromise.catch(() => {
            queueMicrotask(() => queueMicrotask(() => queueMicrotask(
              () => controller.abort('upload-timeout'),
            )));
          });
          return failurePromise;
        }
      }
      return realLstat(filePath);
    });
    const transaction = store.streamUploadArtifact(streamInput(
      createRepeatedSource(1),
      FILE_UPLOAD_POLICY,
      1,
      { signal: controller.signal },
    ));
    await precommitCheck;

    rejectFailure(errno('EIO'));
    const result = await transaction;

    expect(result).toMatchObject({
      committed: false,
      statusCode: 500,
      reason: 'storage-failure',
      cleanup: 'complete',
    });
  });

  it('keeps an exhausted close failure ahead of a queued timeout', async () => {
    const store = await loadStore();
    const controller = new AbortController();
    const realOpen = fs.open.bind(fs);
    let rejectClose = (_error: Error): void => undefined;
    let reportCloseStarted = (): void => undefined;
    let releaseHandle = async (): Promise<void> => undefined;
    const closeFailure = new Promise<never>((_resolve, reject) => {
      rejectClose = reject;
    });
    const closeStarted = new Promise<void>((resolve) => {
      reportCloseStarted = resolve;
    });
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      const close = handle.close.bind(handle);
      let releasePromise: Promise<void> | null = null;
      releaseHandle = () => {
        releasePromise ??= close();
        return releasePromise;
      };
      handle.close = vi.fn(() => {
        const terminalFailure = releaseHandle().then(() => {
          reportCloseStarted();
          return closeFailure;
        });
        void terminalFailure.catch(() => {
          queueMicrotask(() => queueMicrotask(() => queueMicrotask(
            () => controller.abort('upload-timeout'),
          )));
        });
        return terminalFailure;
      });
      return handle;
    });
    try {
      const transaction = store.streamUploadArtifact(streamInput(
        createRepeatedSource(1),
        FILE_UPLOAD_POLICY,
        1,
        { signal: controller.signal },
      ));
      await closeStarted;

      rejectClose(errno('EIO'));
      const result = await transaction;

      expect(result).toMatchObject({
        committed: false,
        statusCode: 500,
        reason: 'storage-failure',
        cleanup: 'complete',
      });
    } finally {
      await releaseHandle();
    }
  });

  it('waits for an active file write before abort cleanup closes or unlinks the stage', async () => {
    const store = await loadStore();
    const controller = new AbortController();
    const realOpen = fs.open.bind(fs);
    let releaseWrite = (): void => undefined;
    let reportWriteStarted = (): void => undefined;
    const writeStarted = new Promise<void>((resolve) => {
      reportWriteStarted = resolve;
    });
    const writeBarrier = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const events: string[] = [];
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      const close = handle.close.bind(handle);
      handle.write = vi.fn(async (_buffer, _offset, length) => {
        events.push('write-start');
        reportWriteStarted();
        await writeBarrier;
        events.push('write-end');
        return { bytesWritten: length, buffer: Buffer.alloc(0) };
      }) as unknown as typeof handle.write;
      handle.close = async () => {
        events.push('close');
        await close();
      };
      return handle;
    });
    const unlink = fs.unlink.bind(fs);
    vi.spyOn(fs, 'unlink').mockImplementation(async (filePath) => {
      events.push('unlink');
      await unlink(filePath);
    });

    let settled = false;
    const transaction = store.streamUploadArtifact(streamInput(
      createRepeatedSource(1),
      FILE_UPLOAD_POLICY,
      1,
      { signal: controller.signal },
    )).finally(() => {
      settled = true;
    });
    await writeStarted;
    controller.abort('upload-aborted');
    await new Promise((resolve) => setImmediate(resolve));

    expect(settled).toBe(false);
    expect(events).toEqual(['write-start']);
    releaseWrite();

    expect(await transaction).toMatchObject({ committed: false, reason: 'upload-aborted' });
    expect(events).toEqual(['write-start', 'write-end', 'close', 'unlink']);
  });

  it('regenerates a final name when a publication-time collision appears without overwriting it', async () => {
    const store = await loadStore();
    let randomValue = 0;
    const transactionStore = store.createUploadsStore({
      now: () => 123,
      randomBytes: () => Buffer.alloc(16, randomValue += 1),
    });
    const realLink = fs.link.bind(fs);
    let collisionPath = '';
    vi.spyOn(fs, 'link').mockImplementation(async (existingPath, newPath) => {
      if (!collisionPath) {
        collisionPath = String(newPath);
        await fs.writeFile(collisionPath, 'existing');
      }
      await realLink(existingPath, newPath);
    });

    const result = await transactionStore.streamUploadArtifact(streamInput(
      createRepeatedSource(1),
      FILE_UPLOAD_POLICY,
      1,
      { originalName: 'report.txt' },
    ));

    expect(result.committed).toBe(true);
    if (!result.committed) throw new Error('expected committed upload');
    expect(result.receipt.path).not.toBe(collisionPath);
    await expect(fs.readFile(collisionPath, 'utf8')).resolves.toBe('existing');
    await expect(fs.readFile(result.receipt.path)).resolves.toEqual(Buffer.from([0x5a]));
  });

  it('recognizes its hard link when a retry follows an ambiguous publication error', async () => {
    const store = await loadStore();
    const transactionStore = store.createUploadsStore({ sleep: async () => undefined });
    const realLink = fs.link.bind(fs);
    let attempts = 0;
    vi.spyOn(fs, 'link').mockImplementation(async (existingPath, newPath) => {
      attempts += 1;
      if (attempts === 1) {
        await realLink(existingPath, newPath);
        throw errno('EPERM');
      }
      await realLink(existingPath, newPath);
    });

    const result = await transactionStore.streamUploadArtifact(streamInput(
      createRepeatedSource(1),
      FILE_UPLOAD_POLICY,
      1,
    ));

    expect(result.committed).toBe(true);
    if (!result.committed) throw new Error('expected committed upload');
    expect(attempts).toBe(2);
    expect(await listArtifactFiles(store.UPLOADS_DIR)).toEqual([result.receipt.path]);
  });

  it('does not overwrite a final target created after the existence check', async () => {
    const store = await loadStore();
    let randomValue = 0;
    const transactionStore = store.createUploadsStore({
      now: () => 123,
      randomBytes: () => Buffer.alloc(16, randomValue += 1),
    });
    const realStat = fs.stat.bind(fs);
    let collisionPath = '';
    vi.spyOn(fs, 'stat').mockImplementation(async (filePath, options) => {
      try {
        return await realStat(filePath, options);
      } catch (error) {
        const candidate = String(filePath);
        if (!collisionPath && path.basename(candidate).endsWith('-report.txt')) {
          collisionPath = candidate;
          await fs.writeFile(candidate, 'existing');
        }
        throw error;
      }
    });

    const result = await transactionStore.streamUploadArtifact(streamInput(
      createRepeatedSource(1),
      FILE_UPLOAD_POLICY,
      1,
      { originalName: 'report.txt' },
    ));

    expect(result.committed).toBe(true);
    if (!result.committed) throw new Error('expected committed upload');
    expect(result.receipt.path).not.toBe(collisionPath);
    await expect(fs.readFile(collisionPath, 'utf8')).resolves.toBe('existing');
    await expect(fs.readFile(result.receipt.path)).resolves.toEqual(Buffer.from([0x5a]));
  });

  it('claims a generated final target before an asynchronous existence check', async () => {
    const store = await loadStore();
    let releaseTargetCheck = (): void => undefined;
    const targetCheckBarrier = new Promise<void>((resolve) => {
      releaseTargetCheck = resolve;
    });
    let reportFirstTargetCheck = (): void => undefined;
    const firstTargetCheck = new Promise<void>((resolve) => {
      reportFirstTargetCheck = resolve;
    });
    let randomCall = 0;
    const transactionStore = store.createUploadsStore({
      now: () => 123,
      randomBytes: () => {
        randomCall += 1;
        if (randomCall <= 2) return Buffer.alloc(16, randomCall);
        if (randomCall <= 4) return Buffer.alloc(16, 3);
        releaseTargetCheck();
        return Buffer.alloc(16, randomCall);
      },
    });
    const sharedRandom = '03'.repeat(16);
    const realStat = fs.stat.bind(fs);
    let sharedTargetChecks = 0;
    vi.spyOn(fs, 'stat').mockImplementation(async (filePath, options) => {
      if (path.basename(String(filePath)).includes(sharedRandom)) {
        sharedTargetChecks += 1;
        if (sharedTargetChecks === 1) reportFirstTargetCheck();
        if (sharedTargetChecks === 2) releaseTargetCheck();
        await targetCheckBarrier;
        throw errno('ENOENT');
      }
      return realStat(filePath, options as never);
    });
    const firstSource = new PassThrough() as PassThrough & { complete: boolean };
    const secondSource = new PassThrough() as PassThrough & { complete: boolean };
    firstSource.complete = false;
    secondSource.complete = false;
    const first = transactionStore.streamUploadArtifact(streamInput(
      firstSource as TUploadBodySource,
      FILE_UPLOAD_POLICY,
      1,
      { originalName: 'same.txt' },
    ));
    const second = transactionStore.streamUploadArtifact(streamInput(
      secondSource as TUploadBodySource,
      FILE_UPLOAD_POLICY,
      1,
      { originalName: 'same.txt' },
    ));
    await waitFor(async () => (await listArtifactFiles(store.UPLOADS_DIR)).length === 2);

    firstSource.complete = true;
    firstSource.end(Buffer.from('A'));
    await firstTargetCheck;
    secondSource.complete = true;
    secondSource.end(Buffer.from('B'));

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.committed).toBe(true);
    expect(secondResult.committed).toBe(true);
    if (!firstResult.committed || !secondResult.committed) {
      throw new Error('expected both uploads to commit');
    }
    expect(firstResult.receipt.path).not.toBe(secondResult.receipt.path);
    await expect(fs.readFile(firstResult.receipt.path, 'utf8')).resolves.toBe('A');
    await expect(fs.readFile(secondResult.receipt.path, 'utf8')).resolves.toBe('B');
  });

  it.each([
    ['close', 'EBUSY'],
    ['link', 'EPERM'],
    ['unlink', 'EBUSY'],
  ] as const)('retries %s after 25/50/100/200ms', async (operation, code) => {
    const store = await loadStore();
    const delays: number[] = [];
    const transactionStore = store.createUploadsStore({
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });
    const realOpen = fs.open.bind(fs);
    const realLink = fs.link.bind(fs);
    const realUnlink = fs.unlink.bind(fs);
    let attempts = 0;
    if (operation === 'close') {
      vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
        const handle = await realOpen(...args);
        const close = handle.close.bind(handle);
        handle.close = async () => {
          attempts += 1;
          if (attempts <= 4) throw errno(code);
          await close();
        };
        return handle;
      });
    } else if (operation === 'link') {
      vi.spyOn(fs, 'link').mockImplementation(async (existingPath, newPath) => {
        attempts += 1;
        if (attempts <= 4) throw errno(code);
        await realLink(existingPath, newPath);
      });
    } else {
      vi.spyOn(fs, 'unlink').mockImplementation(async (filePath) => {
        attempts += 1;
        if (attempts <= 4) throw errno(code);
        await realUnlink(filePath);
      });
    }

    const result = await transactionStore.streamUploadArtifact(streamInput(
      createRepeatedSource(operation === 'unlink' ? 1 : 2),
      FILE_UPLOAD_POLICY,
      2,
    ));

    if (operation === 'unlink') {
      expect(result).toMatchObject({ committed: false, reason: 'length-mismatch', cleanup: 'complete' });
    } else {
      expect(result.committed).toBe(true);
    }
    expect(attempts).toBe(5);
    expect(delays).toEqual([25, 50, 100, 200]);
  });

  it('promotes exhausted close cleanup to storage-failure even when unlink succeeds', async () => {
    const store = await loadStore();
    const transactionStore = store.createUploadsStore({ sleep: async () => undefined });
    const realOpen = fs.open.bind(fs);
    let releaseHandle = async (): Promise<void> => undefined;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      const close = handle.close.bind(handle);
      let releasePromise: Promise<void> | null = null;
      releaseHandle = () => {
        releasePromise ??= close();
        return releasePromise;
      };
      handle.close = vi.fn(async () => {
        await releaseHandle();
        throw errno('EBUSY');
      });
      return handle;
    });

    try {
      const result = await transactionStore.streamUploadArtifact(streamInput(
        createRepeatedSource(1),
        FILE_UPLOAD_POLICY,
        2,
      ));

      expect(result).toMatchObject({ committed: false, statusCode: 500, reason: 'storage-failure', cleanup: 'complete' });
      expect(await listArtifactFiles(store.UPLOADS_DIR)).toEqual([]);
    } finally {
      await releaseHandle();
    }
  });

  it('returns storage-failure when close retries exhaust after an exact body', async () => {
    const store = await loadStore();
    const transactionStore = store.createUploadsStore({ sleep: async () => undefined });
    const realOpen = fs.open.bind(fs);
    let releaseHandle = async (): Promise<void> => undefined;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      const close = handle.close.bind(handle);
      let releasePromise: Promise<void> | null = null;
      releaseHandle = () => {
        releasePromise ??= close();
        return releasePromise;
      };
      handle.close = vi.fn(async () => {
        await releaseHandle();
        throw errno('EBUSY');
      });
      return handle;
    });

    try {
      const result = await transactionStore.streamUploadArtifact(streamInput(
        createRepeatedSource(1),
        FILE_UPLOAD_POLICY,
        1,
      ));

      expect(result).toMatchObject({ committed: false, statusCode: 500, reason: 'storage-failure', cleanup: 'complete' });
      expect(await listArtifactFiles(store.UPLOADS_DIR)).toEqual([]);
    } finally {
      await releaseHandle();
    }
  });

  it('retries close again during cleanup after the initial close cycle exhausts', async () => {
    const store = await loadStore();
    const transactionStore = store.createUploadsStore({ sleep: async () => undefined });
    const realOpen = fs.open.bind(fs);
    let closeAttempts = 0;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      const close = handle.close.bind(handle);
      handle.close = vi.fn(async () => {
        closeAttempts += 1;
        if (closeAttempts <= 5) throw errno('EBUSY');
        await close();
      });
      return handle;
    });

    const result = await transactionStore.streamUploadArtifact(streamInput(
      createRepeatedSource(1),
      FILE_UPLOAD_POLICY,
      1,
    ));

    expect(result).toMatchObject({
      committed: false,
      statusCode: 500,
      reason: 'storage-failure',
      cleanup: 'complete',
    });
    expect(closeAttempts).toBe(6);
    expect(await listArtifactFiles(store.UPLOADS_DIR)).toEqual([]);
  });

  it('returns storage-failure and removes the stage when publication retries exhaust', async () => {
    const store = await loadStore();
    const delays: number[] = [];
    const transactionStore = store.createUploadsStore({
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });
    const link = vi.spyOn(fs, 'link').mockRejectedValue(errno('EPERM'));

    const result = await transactionStore.streamUploadArtifact(streamInput(
      createRepeatedSource(1),
      FILE_UPLOAD_POLICY,
      1,
    ));

    expect(result).toMatchObject({ committed: false, statusCode: 500, reason: 'storage-failure', cleanup: 'complete' });
    expect(link).toHaveBeenCalledTimes(5);
    expect(delays).toEqual([25, 50, 100, 200]);
    expect(await listArtifactFiles(store.UPLOADS_DIR)).toEqual([]);
  });

  it('keeps the committed final when staged-link unlink retries exhaust', async () => {
    const store = await loadStore();
    const delays: number[] = [];
    const transactionStore = store.createUploadsStore({
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });
    vi.spyOn(fs, 'unlink').mockRejectedValue(errno('EPERM'));

    const result = await transactionStore.streamUploadArtifact(streamInput(
      createRepeatedSource(1),
      FILE_UPLOAD_POLICY,
      1,
    ));

    expect(result.committed).toBe(true);
    if (!result.committed) throw new Error('expected committed upload');
    const files = await listArtifactFiles(store.UPLOADS_DIR);
    expect(files).toHaveLength(2);
    expect(files.some((file) => path.basename(file).match(STAGED_FILE_PATTERN))).toBe(true);
    await expect(fs.readFile(result.receipt.path)).resolves.toEqual(Buffer.from([0x5a]));
    expect(delays).toEqual([25, 50, 100, 200]);
  });

  it('reports failed pre-commit cleanup after unlink retry exhaustion and leaves only the stage', async () => {
    const store = await loadStore();
    const delays: number[] = [];
    const transactionStore = store.createUploadsStore({
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });
    vi.spyOn(fs, 'unlink').mockRejectedValue(errno('EPERM'));

    const result = await transactionStore.streamUploadArtifact(streamInput(
      createRepeatedSource(1),
      FILE_UPLOAD_POLICY,
      2,
    ));

    expect(result).toMatchObject({ committed: false, statusCode: 500, reason: 'storage-failure', cleanup: 'failed' });
    const files = await listArtifactFiles(store.UPLOADS_DIR);
    expect(files).toHaveLength(1);
    expect(path.basename(files[0])).toMatch(STAGED_FILE_PATTERN);
    expect(delays).toEqual([25, 50, 100, 200]);
  });

  it('closes and removes a stage when chmod fails after exclusive open', async () => {
    const store = await loadStore();
    const realOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      handle.chmod = vi.fn(async () => {
        throw errno('EIO');
      });
      return handle;
    });

    const result = await store.streamUploadArtifact(streamInput(
      createRepeatedSource(1),
      FILE_UPLOAD_POLICY,
      1,
    ));

    expect(result).toMatchObject({ committed: false, reason: 'storage-failure', cleanup: 'complete' });
    expect(await listArtifactFiles(store.UPLOADS_DIR)).toEqual([]);
  });

  it('does not retry publication after the transaction is aborted during retry sleep', async () => {
    const store = await loadStore();
    const controller = new AbortController();
    const delays: number[] = [];
    const transactionStore = store.createUploadsStore({
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
        controller.abort('upload-server-shutting-down');
      },
    });
    const realLink = fs.link.bind(fs);
    let linkAttempts = 0;
    vi.spyOn(fs, 'link').mockImplementation(async (existingPath, newPath) => {
      linkAttempts += 1;
      if (linkAttempts === 1) throw errno('EBUSY');
      await realLink(existingPath, newPath);
    });

    const result = await transactionStore.streamUploadArtifact(streamInput(
      createRepeatedSource(1),
      FILE_UPLOAD_POLICY,
      1,
      { signal: controller.signal },
    ));

    expect(result).toMatchObject({
      committed: false,
      statusCode: 503,
      reason: 'upload-server-shutting-down',
      cleanup: 'complete',
    });
    expect(linkAttempts).toBe(1);
    expect(delays).toEqual([25]);
    expect(await listArtifactFiles(store.UPLOADS_DIR)).toEqual([]);
  });

  it('keeps the committed artifact when abort races with an in-flight successful publication', async () => {
    const store = await loadStore();
    const controller = new AbortController();
    const realLink = fs.link.bind(fs);
    vi.spyOn(fs, 'link').mockImplementation(async (existingPath, newPath) => {
      controller.abort('upload-timeout');
      await realLink(existingPath, newPath);
    });

    const result = await store.streamUploadArtifact(streamInput(
      createRepeatedSource(1),
      FILE_UPLOAD_POLICY,
      1,
      { signal: controller.signal },
    ));

    expect(result.committed).toBe(true);
    if (!result.committed) throw new Error('expected publication to win the commit race');
    await expect(fs.stat(result.receipt.path)).resolves.toMatchObject({ size: 1 });
  });

  it('keeps an active staged file out of committed cleanup', async () => {
    const store = await loadStore();
    const source = new PassThrough() as PassThrough & { complete: boolean };
    source.complete = false;
    const transaction = store.streamUploadArtifact(streamInput(
      source as TUploadBodySource,
      FILE_UPLOAD_POLICY,
      2,
    ));
    source.write(Buffer.from('a'));
    await waitFor(async () => (await listArtifactFiles(store.UPLOADS_DIR)).length === 1);

    const cleanup = await store.cleanupAllUploads();

    expect(cleanup).toEqual({ deleted: 0, freedBytes: 0 });
    const [stage] = await listArtifactFiles(store.UPLOADS_DIR);
    expect(path.basename(stage)).toMatch(STAGED_FILE_PATTERN);
    source.complete = true;
    source.end(Buffer.from('b'));
    expect((await transaction).committed).toBe(true);
  });

  it.each(['root', 'workspace', 'tab'] as const)(
    'rejects an upload when the owned %s directory is a symlink or junction',
    async (level) => {
      const store = await loadStore();
      const outside = path.join(homeDir, `outside-upload-${level}`);
      await fs.mkdir(outside, { recursive: true });

      let linkPath: string;
      if (level === 'root') {
        await fs.mkdir(path.dirname(store.UPLOADS_DIR), { recursive: true });
        linkPath = store.UPLOADS_DIR;
      } else if (level === 'workspace') {
        await fs.mkdir(store.UPLOADS_DIR, { recursive: true });
        linkPath = path.join(store.UPLOADS_DIR, 'wsunsafe');
      } else {
        await fs.mkdir(path.join(store.UPLOADS_DIR, 'wsunsafe'), { recursive: true });
        linkPath = path.join(store.UPLOADS_DIR, 'wsunsafe', 'tabunsafe');
      }
      await fs.symlink(outside, linkPath, DIRECTORY_LINK_TYPE);

      const result = await store.streamUploadArtifact(streamInput(
        createRepeatedSource(1),
        FILE_UPLOAD_POLICY,
        1,
      ));

      expect(result).toMatchObject({
        committed: false,
        statusCode: 500,
        reason: 'storage-failure',
        cleanup: 'not-required',
      });
      expect(await fs.readdir(outside)).toEqual([]);
      expect((await fs.lstat(linkPath)).isSymbolicLink()).toBe(true);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'rejects a tab directory swapped to an outside link during an active upload',
    async () => {
      const store = await loadStore();
      const source = new PassThrough() as PassThrough & { complete: boolean };
      source.complete = false;
      const transaction = store.streamUploadArtifact(streamInput(
        source as TUploadBodySource,
        FILE_UPLOAD_POLICY,
        2,
      ));
      source.write(Buffer.from('a'));
      await waitFor(async () => (await listArtifactFiles(store.UPLOADS_DIR)).length === 1);
      const [stagedPath] = await listArtifactFiles(store.UPLOADS_DIR);
      const originalTabDirectory = path.dirname(stagedPath);
      const movedTabDirectory = path.join(homeDir, 'outside-active-tab');
      await fs.rename(originalTabDirectory, movedTabDirectory);
      await fs.symlink(movedTabDirectory, originalTabDirectory, DIRECTORY_LINK_TYPE);

      source.complete = true;
      source.end(Buffer.from('b'));
      const result = await transaction;

      expect(result).toMatchObject({
        committed: false,
        statusCode: 500,
        reason: 'storage-failure',
        cleanup: 'complete',
      });
      expect(await fs.readdir(movedTabDirectory)).toEqual([]);
      expect((await fs.lstat(originalTabDirectory)).isSymbolicLink()).toBe(true);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'reports failed cleanup when a directory swap makes the staged path unreachable',
    async () => {
      const store = await loadStore();
      const source = new PassThrough() as PassThrough & { complete: boolean };
      source.complete = false;
      const transaction = store.streamUploadArtifact(streamInput(
        source as TUploadBodySource,
        FILE_UPLOAD_POLICY,
        2,
      ));
      source.write(Buffer.from('a'));
      await waitFor(async () => (await listArtifactFiles(store.UPLOADS_DIR)).length === 1);
      const [stagedPath] = await listArtifactFiles(store.UPLOADS_DIR);
      const originalTabDirectory = path.dirname(stagedPath);
      const movedTabDirectory = path.join(homeDir, 'outside-unreachable-stage');
      const alternateTarget = path.join(homeDir, 'outside-alternate-tab');
      await fs.rename(originalTabDirectory, movedTabDirectory);
      await fs.mkdir(alternateTarget, { recursive: true });
      await fs.symlink(alternateTarget, originalTabDirectory, DIRECTORY_LINK_TYPE);

      source.complete = true;
      source.end(Buffer.from('b'));
      const result = await transaction;

      expect(result).toMatchObject({
        committed: false,
        statusCode: 500,
        reason: 'storage-failure',
        cleanup: 'failed',
      });
      const movedFiles = await fs.readdir(movedTabDirectory);
      expect(movedFiles).toHaveLength(1);
      expect(movedFiles[0]).toMatch(STAGED_FILE_PATTERN);
      expect(await fs.readdir(alternateTarget)).toEqual([]);
    },
  );

  it('does not traverse a symlinked or junction upload root during cleanup', async () => {
    const store = await loadStore();
    const outside = path.join(homeDir, 'outside-cleanup-root');
    const victim = path.join(outside, 'ws', 'tab', 'victim.txt');
    await fs.mkdir(path.dirname(victim), { recursive: true });
    await fs.writeFile(victim, 'outside');
    await fs.mkdir(path.dirname(store.UPLOADS_DIR), { recursive: true });
    await fs.symlink(outside, store.UPLOADS_DIR, DIRECTORY_LINK_TYPE);

    expect(await store.cleanupAllUploads()).toEqual({ deleted: 0, freedBytes: 0 });
    await expect(fs.readFile(victim, 'utf8')).resolves.toBe('outside');
    expect((await fs.lstat(store.UPLOADS_DIR)).isSymbolicLink()).toBe(true);
  });

  it('does not traverse a symlinked or junction data directory during cleanup', async () => {
    const store = await loadStore();
    const baseDirectory = path.dirname(store.UPLOADS_DIR);
    const outside = path.join(homeDir, 'outside-cleanup-base');
    const victim = path.join(outside, 'uploads', 'ws', 'tab', 'victim.txt');
    await fs.mkdir(path.dirname(victim), { recursive: true });
    await fs.writeFile(victim, 'outside');
    await fs.symlink(outside, baseDirectory, DIRECTORY_LINK_TYPE);

    expect(await store.cleanupAllUploads()).toEqual({ deleted: 0, freedBytes: 0 });
    await expect(fs.readFile(victim, 'utf8')).resolves.toBe('outside');
    expect((await fs.lstat(baseDirectory)).isSymbolicLink()).toBe(true);
  });

  it('does not traverse a symlinked or junction workspace during cleanup', async () => {
    const store = await loadStore();
    const normal = path.join(store.UPLOADS_DIR, 'normal-ws', 'tab', 'normal.txt');
    const outside = path.join(homeDir, 'outside-cleanup-workspace');
    const victim = path.join(outside, 'tab', 'victim.txt');
    const link = path.join(store.UPLOADS_DIR, 'linked-ws');
    await fs.mkdir(path.dirname(normal), { recursive: true });
    await fs.mkdir(path.dirname(victim), { recursive: true });
    await fs.writeFile(normal, 'normal');
    await fs.writeFile(victim, 'outside');
    await fs.symlink(outside, link, DIRECTORY_LINK_TYPE);

    expect(await store.cleanupAllUploads()).toEqual({ deleted: 1, freedBytes: 6 });
    await expect(fs.stat(normal)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(victim, 'utf8')).resolves.toBe('outside');
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
  });

  it('does not traverse a symlinked or junction tab during cleanup', async () => {
    const store = await loadStore();
    const normal = path.join(store.UPLOADS_DIR, 'ws', 'normal-tab', 'normal.txt');
    const outside = path.join(homeDir, 'outside-cleanup-tab');
    const victim = path.join(outside, 'victim.txt');
    const link = path.join(store.UPLOADS_DIR, 'ws', 'linked-tab');
    await fs.mkdir(path.dirname(normal), { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(normal, 'normal');
    await fs.writeFile(victim, 'outside');
    await fs.symlink(outside, link, DIRECTORY_LINK_TYPE);

    expect(await store.cleanupAllUploads()).toEqual({ deleted: 1, freedBytes: 6 });
    await expect(fs.stat(normal)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(victim, 'utf8')).resolves.toBe('outside');
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
  });

  it.skipIf(process.platform === 'win32')(
    'does not unlink an artifact symlink during cleanup',
    async () => {
      const store = await loadStore();
      const directory = path.join(store.UPLOADS_DIR, 'ws', 'tab');
      const outside = path.join(homeDir, 'outside-cleanup-file.txt');
      const link = path.join(directory, 'linked.txt');
      const normal = path.join(directory, 'normal.txt');
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(outside, 'outside');
      await fs.writeFile(normal, 'normal');
      await fs.symlink(outside, link, 'file');

      expect(await store.cleanupAllUploads()).toEqual({ deleted: 1, freedBytes: 6 });
      await expect(fs.stat(normal)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.readFile(outside, 'utf8')).resolves.toBe('outside');
      expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    },
  );

  it('cleans only the strict staged namespace and clamps age to 30 minutes', async () => {
    const store = await loadStore();
    const directory = path.join(store.UPLOADS_DIR, 'ws', 'tab');
    await fs.mkdir(directory, { recursive: true });
    const oldStage = path.join(directory, `.${'a'.repeat(32)}.upload.part`);
    const recentStage = path.join(directory, `.${'b'.repeat(32)}.upload.part`);
    const finalPart = path.join(directory, 'artifact.part');
    const lookalike = path.join(directory, `.${'c'.repeat(31)}.upload.part`);
    await Promise.all([
      fs.writeFile(oldStage, ''),
      fs.writeFile(recentStage, 'recent'),
      fs.writeFile(finalPart, 'final'),
      fs.writeFile(lookalike, 'lookalike'),
    ]);
    const now = Date.now();
    await fs.utimes(oldStage, new Date(now - 31 * 60_000), new Date(now - 31 * 60_000));
    await fs.utimes(recentStage, new Date(now - 10 * 60_000), new Date(now - 10 * 60_000));
    await fs.utimes(finalPart, new Date(now - 31 * 60_000), new Date(now - 31 * 60_000));
    await fs.utimes(lookalike, new Date(now - 31 * 60_000), new Date(now - 31 * 60_000));

    const result = await store.cleanupStaleUploadParts(0);

    expect(result).toEqual({ deleted: 1, freedBytes: 0 });
    await expect(fs.stat(oldStage)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(recentStage)).resolves.toBeDefined();
    await expect(fs.stat(finalPart)).resolves.toBeDefined();
    await expect(fs.stat(lookalike)).resolves.toBeDefined();
  });

  it('cleans legitimate .part finals while preserving reserved stages in all mode', async () => {
    const store = await loadStore();
    const directory = path.join(store.UPLOADS_DIR, 'ws', 'tab');
    await fs.mkdir(directory, { recursive: true });
    const finalPart = path.join(directory, 'committed.part');
    const stage = path.join(directory, `.${'d'.repeat(32)}.upload.part`);
    await fs.writeFile(finalPart, 'final');
    await fs.writeFile(stage, 'stage');

    const result = await store.cleanupAllUploads();

    expect(result).toEqual({ deleted: 1, freedBytes: 5 });
    await expect(fs.stat(finalPart)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(stage)).resolves.toBeDefined();
  });

  it('preserves reserved stages while expired cleanup removes eligible finals', async () => {
    const store = await loadStore();
    const directory = path.join(store.UPLOADS_DIR, 'ws', 'tab');
    const final = path.join(directory, 'expired.txt');
    const stage = path.join(directory, `.${'f'.repeat(32)}.upload.part`);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(final, 'final');
    await fs.writeFile(stage, 'stage');
    const old = new Date(Date.now() - 2 * 60_000);
    await fs.utimes(final, old, old);
    await fs.utimes(stage, old, old);

    expect(await store.cleanupExpiredUploads(60_000)).toEqual({ deleted: 1, freedBytes: 5 });
    await expect(fs.stat(final)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(stage)).resolves.toBeDefined();
  });

  it('counts a removed zero-byte committed file and repeated cleanup removes empty directories', async () => {
    const store = await loadStore();
    const directory = path.join(store.UPLOADS_DIR, 'ws', 'tab');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'empty.txt'), '');

    expect(await store.cleanupAllUploads()).toEqual({ deleted: 1, freedBytes: 0 });
    expect(await store.cleanupAllUploads()).toEqual({ deleted: 0, freedBytes: 0 });
    await expect(fs.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('throws when committed cleanup encounters a non-retryable unlink failure', async () => {
    const store = await loadStore();
    const directory = path.join(store.UPLOADS_DIR, 'ws', 'tab');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'artifact.txt'), 'data');
    vi.spyOn(fs, 'unlink').mockRejectedValue(errno('EIO'));

    await expect(store.cleanupAllUploads()).rejects.toMatchObject({ code: 'EIO' });
  });

  it('throws after committed cleanup exhausts EPERM retries', async () => {
    const store = await loadStore();
    const directory = path.join(store.UPLOADS_DIR, 'ws', 'tab');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'artifact.txt'), 'data');
    const unlink = vi.spyOn(fs, 'unlink').mockRejectedValue(errno('EPERM'));

    await expect(store.cleanupAllUploads()).rejects.toMatchObject({ code: 'EPERM' });
    expect(unlink).toHaveBeenCalledTimes(5);
  }, 2_000);

  it('throws on root readdir failure instead of reporting an empty cleanup', async () => {
    const store = await loadStore();
    await fs.mkdir(store.UPLOADS_DIR, { recursive: true });
    vi.spyOn(fs, 'readdir').mockRejectedValue(errno('EACCES'));

    await expect(store.cleanupAllUploads()).rejects.toMatchObject({ code: 'EACCES' });
  });

  it('throws on artifact stat failure instead of returning partial success', async () => {
    const store = await loadStore();
    const directory = path.join(store.UPLOADS_DIR, 'ws', 'tab');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'artifact.txt'), 'data');
    vi.spyOn(fs, 'lstat').mockRejectedValue(errno('EIO'));

    await expect(store.cleanupAllUploads()).rejects.toMatchObject({ code: 'EIO' });
  });

  it('throws when stale staged cleanup cannot unlink an eligible stage', async () => {
    const store = await loadStore();
    const directory = path.join(store.UPLOADS_DIR, 'ws', 'tab');
    const stage = path.join(directory, `.${'e'.repeat(32)}.upload.part`);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(stage, 'data');
    const old = new Date(Date.now() - 31 * 60_000);
    await fs.utimes(stage, old, old);
    vi.spyOn(fs, 'unlink').mockRejectedValue(errno('EIO'));

    await expect(store.cleanupStaleUploadParts()).rejects.toMatchObject({ code: 'EIO' });
  });

  it('throws on empty-directory removal I/O failure after deleting artifacts', async () => {
    const store = await loadStore();
    const directory = path.join(store.UPLOADS_DIR, 'ws', 'tab');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'artifact.txt'), 'data');
    vi.spyOn(fs, 'rmdir').mockRejectedValue(errno('EIO'));

    await expect(store.cleanupAllUploads()).rejects.toMatchObject({ code: 'EIO' });
  });

  it('does not expose the removed full-buffer save wrappers', async () => {
    const store = await loadStore();
    expect(store).not.toHaveProperty('saveImage');
    expect(store).not.toHaveProperty('saveFile');
    expect(store).not.toHaveProperty('MAX_BYTES');
    expect(store).not.toHaveProperty('GENERIC_MAX_BYTES');
  });

  it('contains no full-body concatenation or chunk accumulator in the storage path', async () => {
    const source = await fs.readFile(path.join(process.cwd(), 'src/lib/uploads-store.ts'), 'utf8');

    expect(source).not.toContain('Buffer.concat');
    expect(source).not.toMatch(/chunks\s*=\s*\[/);
  });

  it('commits upload artifacts under the real .codexmux/uploads directory on a legacy-only HOME', async () => {
    const legacyDataDir = path.join(homeDir, '.codexmux');
    await fs.mkdir(legacyDataDir, { recursive: true });
    const store = await loadStore();
    const bytes = 1024;
    const result = await store.streamUploadArtifact(
      streamInput(createRepeatedSource(bytes), FILE_UPLOAD_POLICY, bytes),
    );

    expect(result.committed).toBe(true);
    if (!result.committed) throw new Error('expected committed upload');
    expect(result.receipt.path.startsWith(path.join(legacyDataDir, 'uploads') + path.sep)).toBe(true);
    await expect(fs.stat(result.receipt.path)).resolves.toMatchObject({ size: bytes });
  });
});

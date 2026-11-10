import { Buffer } from 'node:buffer';
import type { TAgentPanelType } from '@/types/terminal';
import type { TSessionCatalogRepository } from '@/lib/session-catalog/index-repository';
import { projectClaudeJsonl } from '@/lib/session-catalog/claude-jsonl-projector';
import { projectCodexJsonl } from '@/lib/session-catalog/jsonl-projector';

export interface ISessionCatalogIndexFileInput {
  fileKey: string;
  canonicalPath: string;
  fileIdentity: string;
  mtimeMs: number;
  sizeBytes: number;
  provider?: TAgentPanelType;
}

export type TSessionCatalogIndexMode = 'full' | 'append' | 'skipped';

export interface ISessionCatalogIndexResult {
  mode: TSessionCatalogIndexMode;
  indexed: boolean;
  processedBytes: number;
  safeByte: number;
}

export interface ICreateSessionCatalogIndexerOptions {
  repository: TSessionCatalogRepository;
  readChunk: (filePath: string, startByte: number) => Promise<Buffer>;
  now?: () => string;
  yieldControl?: () => Promise<void>;
}

const readCompleteLines = (chunk: Buffer): { content: string; byteLength: number } => {
  const lastNewline = chunk.lastIndexOf(0x0a);
  if (lastNewline < 0) return { content: '', byteLength: 0 };
  const complete = chunk.subarray(0, lastNewline + 1);
  return { content: complete.toString('utf8'), byteLength: complete.byteLength };
};

export const createSessionCatalogIndexer = ({
  repository,
  readChunk,
  now = () => new Date().toISOString(),
  yieldControl = () => new Promise((resolve) => setImmediate(resolve)),
}: ICreateSessionCatalogIndexerOptions) => {
  const indexFile = async (input: ISessionCatalogIndexFileInput): Promise<ISessionCatalogIndexResult> => {
    const cursor = repository.getFileCursor(input.fileKey);
    const sameFile = cursor?.fileIdentity === input.fileIdentity
      && cursor.canonicalPath === input.canonicalPath;
    if (
      sameFile
      && cursor.mtimeMs === input.mtimeMs
      && cursor.sizeBytes === input.sizeBytes
      && cursor.safeByte >= input.sizeBytes
    ) {
      return { mode: 'skipped', indexed: false, processedBytes: 0, safeByte: cursor.safeByte };
    }

    const append = Boolean(
      cursor
      && sameFile
      && cursor.safeByte <= input.sizeBytes
      && (input.sizeBytes > cursor.sizeBytes || cursor.safeByte < input.sizeBytes),
    );
    const mode: Exclude<TSessionCatalogIndexMode, 'skipped'> = append ? 'append' : 'full';
    const startByte = append && cursor ? cursor.safeByte : 0;
    const chunk = await readChunk(input.canonicalPath, startByte);
    const complete = readCompleteLines(chunk);
    const safeByte = startByte + complete.byteLength;
    const fallbackEntry = append && cursor?.sessionId
      ? repository.getSessionEntry(cursor.sessionId) ?? undefined
      : undefined;
    const project = input.provider === 'claude' ? projectClaudeJsonl : projectCodexJsonl;
    const projection = project(complete.content, {
      indexedAt: now(),
      ...(fallbackEntry ? { fallbackEntry } : {}),
      sequenceOffset: startByte,
    });

    if (!projection.entry) {
      return { mode, indexed: false, processedBytes: complete.byteLength, safeByte: startByte };
    }
    if (append) repository.appendProjection(projection);
    else repository.replaceProjection(projection);
    repository.upsertFileCursor({
      fileKey: input.fileKey,
      canonicalPath: input.canonicalPath,
      fileIdentity: input.fileIdentity,
      mtimeMs: input.mtimeMs,
      sizeBytes: input.sizeBytes,
      safeByte,
      sessionId: projection.entry.sessionId,
      updatedAt: now(),
    });

    return { mode, indexed: true, processedBytes: complete.byteLength, safeByte };
  };

  const rebuild = async (
    files: readonly ISessionCatalogIndexFileInput[],
    options: {
      signal?: AbortSignal;
      batchSize?: number;
      onCheckpoint?: (completed: number) => void;
    } = {},
  ): Promise<{ completed: number; cancelled: boolean }> => {
    const batchSize = Math.max(1, Math.min(options.batchSize ?? 25, 100));
    let completed = 0;
    for (const file of files) {
      if (options.signal?.aborted) return { completed, cancelled: true };
      await indexFile(file);
      completed++;
      if (completed % batchSize === 0) {
        options.onCheckpoint?.(completed);
        await yieldControl();
      }
    }
    options.onCheckpoint?.(completed);
    return { completed, cancelled: false };
  };

  return { indexFile, rebuild };
};

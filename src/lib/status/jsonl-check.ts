import fs from 'fs/promises';
import {
  extractStatusAssistantInfo,
  scanStatusJsonlLines,
} from '@/lib/status/jsonl-idle-scan';
import type { ICurrentAction, IRateLimitsData } from '@/types/status';

const JSONL_TAIL_SIZE = 8192;
const JSONL_EXTENDED_TAIL_SIZE = 131_072;

interface IJsonlIdleCache {
  mtimeMs: number;
  idle: boolean;
  stale: boolean;
  needsStaleRecheck: boolean;
  staleMs: number;
  lastAssistantSnippet: string | null;
  currentAction: ICurrentAction | null;
  reset: boolean;
  lastEntryTs: number | null;
  interrupted: boolean;
  completionTurnId: string | null;
}

const MAX_JSONL_CACHE = 256;
const jsonlIdleCache = new Map<string, IJsonlIdleCache>();

export interface IJsonlCheckResult {
  idle: boolean;
  stale: boolean;
  lastAssistantSnippet: string | null;
  currentAction: ICurrentAction | null;
  reset: boolean;
  lastEntryTs: number | null;
  staleMs: number;
  interrupted: boolean;
  completionTurnId: string | null;
}

export interface IAgentJsonlStatus extends IJsonlCheckResult {
  rateLimits?: IRateLimitsData | null;
}

export const emptyJsonlCheckResult = (): IJsonlCheckResult => ({
  idle: false,
  stale: false,
  lastAssistantSnippet: null,
  currentAction: null,
  reset: false,
  lastEntryTs: null,
  staleMs: 0,
  interrupted: false,
  completionTurnId: null,
});

export const clearJsonlCheckCache = (jsonlPath: string): void => {
  jsonlIdleCache.delete(jsonlPath);
};

export const checkJsonlIdle = async (jsonlPath: string): Promise<IJsonlCheckResult> => {
  try {
    const stat = await fs.stat(jsonlPath);
    if (stat.size === 0) return { idle: true, stale: false, lastAssistantSnippet: null, currentAction: null, reset: false, lastEntryTs: null, staleMs: 0, interrupted: false, completionTurnId: null };

    const cached = jsonlIdleCache.get(jsonlPath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      jsonlIdleCache.delete(jsonlPath);
      jsonlIdleCache.set(jsonlPath, cached);
      if (cached.idle) return { idle: true, stale: cached.stale, lastAssistantSnippet: cached.lastAssistantSnippet, currentAction: cached.currentAction, reset: cached.reset, lastEntryTs: cached.lastEntryTs, staleMs: cached.staleMs, interrupted: cached.interrupted, completionTurnId: cached.completionTurnId };
      if (cached.needsStaleRecheck) {
        const idle = Date.now() - stat.mtimeMs > cached.staleMs;
        return { idle, stale: true, lastAssistantSnippet: cached.lastAssistantSnippet, currentAction: cached.currentAction, reset: cached.reset, lastEntryTs: cached.lastEntryTs, staleMs: cached.staleMs, interrupted: cached.interrupted, completionTurnId: cached.completionTurnId };
      }
      return { idle: false, stale: false, lastAssistantSnippet: cached.lastAssistantSnippet, currentAction: cached.currentAction, reset: cached.reset, lastEntryTs: cached.lastEntryTs, staleMs: cached.staleMs, interrupted: cached.interrupted, completionTurnId: cached.completionTurnId };
    }

    const handle = await fs.open(jsonlPath, 'r');
    try {
      const elapsed = Date.now() - stat.mtimeMs;

      const readSize = Math.min(stat.size, JSONL_TAIL_SIZE);
      const buffer = Buffer.alloc(readSize);
      await handle.read(buffer, 0, readSize, stat.size - readSize);
      const lines = buffer.toString('utf-8').split('\n').filter((l) => l.trim());

      let scan = scanStatusJsonlLines(lines, elapsed);
      let extracted = extractStatusAssistantInfo(lines);

      if (!scan.matched && stat.size > JSONL_TAIL_SIZE) {
        const extSize = Math.min(stat.size, JSONL_EXTENDED_TAIL_SIZE);
        const extBuffer = Buffer.alloc(extSize);
        await handle.read(extBuffer, 0, extSize, stat.size - extSize);
        const extLines = extBuffer.toString('utf-8').split('\n').filter((l) => l.trim());
        scan = scanStatusJsonlLines(extLines, elapsed);
        if (!extracted.lastAssistantSnippet && !extracted.currentAction) extracted = extractStatusAssistantInfo(extLines);
      }

      if (jsonlIdleCache.size >= MAX_JSONL_CACHE) {
        jsonlIdleCache.delete(jsonlIdleCache.keys().next().value!);
      }
      jsonlIdleCache.set(jsonlPath, { mtimeMs: stat.mtimeMs, idle: scan.idle, stale: scan.stale, needsStaleRecheck: scan.needsStaleRecheck, staleMs: scan.staleMs, lastAssistantSnippet: extracted.lastAssistantSnippet, currentAction: extracted.currentAction, reset: extracted.reset, lastEntryTs: scan.lastEntryTs, interrupted: scan.interrupted, completionTurnId: null });
      return { idle: scan.idle, stale: scan.stale, lastAssistantSnippet: extracted.lastAssistantSnippet, currentAction: extracted.currentAction, reset: extracted.reset, lastEntryTs: scan.lastEntryTs, staleMs: scan.staleMs, interrupted: scan.interrupted, completionTurnId: null };
    } finally {
      await handle.close();
    }
  } catch {
    return { idle: false, stale: false, lastAssistantSnippet: null, currentAction: null, reset: false, lastEntryTs: null, staleMs: 0, interrupted: false, completionTurnId: null };
  }
};

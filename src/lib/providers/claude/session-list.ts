import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { getClaudeProjectsDir } from '@/lib/path-validation';
import { isValidClaudeSessionId } from '@/lib/claude-command';
import { toClaudeProjectName } from '@/lib/providers/claude/session-detection';
import { extractClaudeUserPromptText, isClaudeUserPrompt } from '@/lib/providers/claude/user-prompt';
import type { ISessionMeta } from '@/types/timeline';

const EDGE_BYTES = 64 * 1024;
const FIRST_MESSAGE_LIMIT = 200;
const CACHE_LIMIT = 1000;

interface ICacheEntry {
  mtimeMs: number;
  size: number;
  meta: ISessionMeta;
}

const g = globalThis as unknown as { __ptClaudeSessionListCache?: Map<string, ICacheEntry> };
if (!g.__ptClaudeSessionListCache) g.__ptClaudeSessionListCache = new Map();
const cache = g.__ptClaudeSessionListCache;

const readEdges = async (filePath: string, size: number): Promise<{ head: string; tail: string | null }> => {
  const handle = await fs.open(filePath, 'r');
  try {
    if (size <= EDGE_BYTES * 2) {
      const buffer = Buffer.alloc(size);
      await handle.read(buffer, 0, size, 0);
      return { head: buffer.toString('utf-8'), tail: null };
    }
    const headBuffer = Buffer.alloc(EDGE_BYTES);
    const tailBuffer = Buffer.alloc(EDGE_BYTES);
    await handle.read(headBuffer, 0, EDGE_BYTES, 0);
    await handle.read(tailBuffer, 0, EDGE_BYTES, size - EDGE_BYTES);
    const head = headBuffer.toString('utf-8');
    const tail = tailBuffer.toString('utf-8');
    return {
      head: head.slice(0, Math.max(0, head.lastIndexOf('\n'))),
      tail: tail.slice(tail.indexOf('\n') + 1),
    };
  } finally {
    await handle.close();
  }
};

const parseLines = (content: string): unknown[] => {
  const records: unknown[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      continue;
    }
  }
  return records;
};

const recordTimestamp = (record: unknown): string | null => {
  const value = (record as { timestamp?: unknown } | null)?.timestamp;
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
};

const buildMeta = async (
  filePath: string,
  sessionId: string,
  cwd: string,
  mtimeMs: number,
  size: number,
): Promise<ISessionMeta> => {
  const { head, tail } = await readEdges(filePath, size);
  const headRecords = parseLines(head);
  const tailRecords = tail === null ? headRecords : parseLines(tail);

  const startedAt = headRecords.map(recordTimestamp).find((value) => value !== null) ?? new Date(mtimeMs).toISOString();
  const lastTimestamp = [...tailRecords].reverse().map(recordTimestamp).find((value) => value !== null) ?? null;
  const lastActivityMs = Math.max(mtimeMs, lastTimestamp ? Date.parse(lastTimestamp) : 0);

  const firstMessage = headRecords
    .map(extractClaudeUserPromptText)
    .find((text) => !!text?.trim());
  const turnCount = headRecords.filter(isClaudeUserPrompt).length
    + (tail === null ? 0 : tailRecords.filter(isClaudeUserPrompt).length);

  return {
    sessionId,
    startedAt,
    lastActivityAt: new Date(lastActivityMs).toISOString(),
    firstMessage: (firstMessage ?? '').trim().slice(0, FIRST_MESSAGE_LIMIT),
    turnCount,
    cwd,
    jsonlPath: filePath,
    providerId: 'claude',
  };
};

export const listClaudeSessionsForCwd = async (cwd: string, homeDir?: string): Promise<ISessionMeta[]> => {
  const dir = path.join(getClaudeProjectsDir(homeDir ?? os.homedir()), toClaudeProjectName(cwd));
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }

  const results = await Promise.all(names.map(async (name): Promise<ISessionMeta | null> => {
    if (!name.endsWith('.jsonl')) return null;
    const sessionId = name.slice(0, -'.jsonl'.length);
    if (!isValidClaudeSessionId(sessionId)) return null;
    const filePath = path.join(dir, name);
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) return null;
      const cached = cache.get(filePath);
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size && cached.meta.cwd === cwd) {
        return cached.meta;
      }
      const meta = await buildMeta(filePath, sessionId, cwd, stat.mtimeMs, stat.size);
      cache.delete(filePath);
      cache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, meta });
      while (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return meta;
    } catch {
      return null;
    }
  }));

  return results
    .filter((meta): meta is ISessionMeta => meta !== null)
    .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
};

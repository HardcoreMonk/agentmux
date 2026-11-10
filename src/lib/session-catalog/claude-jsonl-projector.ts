import { posix } from 'node:path';
import { extractClaudeUserPromptText } from '@/lib/providers/claude/user-prompt';
import { sessionIdSchema, type ISessionCatalogEntry } from '@/lib/session-catalog/contracts';
import type { ISessionCatalogProjection } from '@/lib/session-catalog/jsonl-projector';
import { buildSearchSnippet, sanitizeSearchText } from '@/lib/session-catalog/search-policy';

export interface IProjectClaudeJsonlOptions {
  indexedAt: string;
  fallbackEntry?: ISessionCatalogEntry;
  sequenceOffset?: number;
}

type TJsonObject = Record<string, unknown>;

const readObject = (value: unknown): TJsonObject | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as TJsonObject : null;

const readString = (object: TJsonObject, key: string, maxLength = 4096): string | null => {
  const value = object[key];
  if (typeof value !== 'string' || value.length > maxLength) return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const readTimestamp = (record: TJsonObject): string | null => {
  const value = readString(record, 'timestamp', 80);
  if (!value) return null;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
};

// Assistant text only: tool_use and thinking blocks never reach the search index.
const readAssistantText = (message: TJsonObject): string => {
  const content = message.content;
  if (typeof content === 'string') return sanitizeSearchText(content);
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const item of content) {
    const object = readObject(item);
    if (!object || object.type !== 'text') continue;
    const text = readString(object, 'text', 1024 * 1024);
    if (text) parts.push(text);
  }
  return sanitizeSearchText(parts.join(' '));
};

export const projectClaudeJsonl = (
  content: string,
  options: IProjectClaudeJsonlOptions,
): ISessionCatalogProjection => {
  const ignored: Record<string, number> = {};
  const messages: { role: 'user' | 'assistant'; text: string; timestamp: string; sequence: number }[] = [];
  let sessionId: string | null = options.fallbackEntry?.sessionId ?? null;
  let projectLabel = options.fallbackEntry?.projectLabel ?? 'unknown';
  let model: string | undefined = options.fallbackEntry?.model;
  let startedAt: string | null = options.fallbackEntry?.startedAt ?? null;
  let lastActivityAt: string | null = options.fallbackEntry?.lastActivityAt ?? null;
  let sawCwd = false;

  const ignore = (reason: string) => {
    ignored[reason] = (ignored[reason] ?? 0) + 1;
  };

  for (const [index, line] of content.split('\n').entries()) {
    if (!line.trim()) continue;
    let record: TJsonObject;
    try {
      const parsed = readObject(JSON.parse(line) as unknown);
      if (!parsed) {
        ignore('malformed');
        continue;
      }
      record = parsed;
    } catch {
      ignore('malformed');
      continue;
    }

    const timestamp = readTimestamp(record);
    if (timestamp) {
      if (!startedAt || timestamp < startedAt) startedAt = timestamp;
      if (!lastActivityAt || timestamp > lastActivityAt) lastActivityAt = timestamp;
    }
    const candidateId = readString(record, 'sessionId', 160);
    if (candidateId && sessionIdSchema.safeParse(candidateId).success) sessionId = candidateId;
    const cwd = readString(record, 'cwd', 4096);
    if (cwd && !sawCwd) {
      sawCwd = true;
      projectLabel = posix.basename(cwd.replace(/\/+$/, '')) || 'unknown';
    }

    const type = readString(record, 'type', 80);
    if (type !== 'user' && type !== 'assistant') {
      ignore('unknown');
      continue;
    }
    if (record.isMeta === true || record.isSidechain === true) {
      ignore('synthetic');
      continue;
    }
    const message = readObject(record.message);
    if (!message) {
      ignore('unknown');
      continue;
    }

    let text: string;
    if (type === 'user') {
      const prompt = extractClaudeUserPromptText(record);
      if (prompt === null) {
        ignore('tool');
        continue;
      }
      text = sanitizeSearchText(prompt);
    } else {
      if (!model) model = readString(message, 'model', 120) ?? undefined;
      text = readAssistantText(message);
    }
    if (!text) {
      ignore('empty');
      continue;
    }
    messages.push({
      role: type,
      text,
      timestamp: timestamp ?? options.indexedAt,
      sequence: (options.sequenceOffset ?? 0) + index,
    });
  }

  if (!sessionId || !startedAt || !lastActivityAt) {
    return { entry: null, records: [], ignored };
  }

  const resolvedSessionId = sessionId;
  const records = messages.map((message) => ({
    id: `${resolvedSessionId}:${message.sequence}`,
    sessionId: resolvedSessionId,
    role: message.role,
    text: message.text,
    snippet: buildSearchSnippet(message.text),
    timestamp: message.timestamp,
    sequence: message.sequence,
  }));
  const entry: ISessionCatalogEntry = {
    sessionId: resolvedSessionId,
    provider: 'claude',
    projectLabel,
    ...(model ? { model } : {}),
    startedAt,
    lastActivityAt,
    turnCount: records.filter((record) => record.role === 'user').length,
    indexedAt: options.indexedAt,
  };
  return { entry, records, ignored };
};

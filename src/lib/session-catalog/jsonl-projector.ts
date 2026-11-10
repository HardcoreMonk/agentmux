import { posix } from 'node:path';
import type { ISessionCatalogEntry } from '@/lib/session-catalog/contracts';
import { sessionIdSchema } from '@/lib/session-catalog/contracts';
import { buildSearchSnippet, sanitizeSearchText } from '@/lib/session-catalog/search-policy';

export interface ISessionCatalogSearchRecord {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  text: string;
  snippet: string;
  timestamp: string;
  sequence: number;
}

export interface ISessionCatalogProjection {
  entry: ISessionCatalogEntry | null;
  records: ISessionCatalogSearchRecord[];
  ignored: Record<string, number>;
}

export interface IProjectCodexJsonlOptions {
  indexedAt: string;
  fallbackEntry?: ISessionCatalogEntry;
  sequenceOffset?: number;
}

type TJsonObject = Record<string, unknown>;
type TIgnoredReason = 'attachment' | 'duplicate' | 'empty' | 'malformed' | 'reasoning' | 'synthetic' | 'tool' | 'unknown';

interface IProjectedMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  sequence: number;
}

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

const isSyntheticUserText = (text: string): boolean => {
  const trimmed = text.trimStart();
  return trimmed.startsWith('<environment_context>')
    || trimmed.startsWith('# AGENTS.md instructions')
    || trimmed.startsWith('<INSTRUCTIONS>');
};

const readMessageText = (
  payload: TJsonObject,
): { text: string | null; reason: TIgnoredReason | null } => {
  const content = payload.content;
  if (!Array.isArray(content)) return { text: null, reason: 'empty' };

  const parts: string[] = [];
  for (const item of content) {
    const object = readObject(item);
    if (!object) continue;
    const type = readString(object, 'type', 80);
    if (type === 'input_image' || type === 'image' || type === 'attachment' || 'image_url' in object) {
      return { text: null, reason: 'attachment' };
    }
    if (type !== 'input_text' && type !== 'output_text' && type !== 'text') continue;
    const text = readString(object, 'text', 1024 * 1024);
    if (text) parts.push(text);
  }

  const text = sanitizeSearchText(parts.join(' '));
  if (!text) return { text: null, reason: 'empty' };
  if (isSyntheticUserText(text)) return { text: null, reason: 'synthetic' };
  return { text, reason: null };
};

export const projectCodexJsonl = (
  content: string,
  options: IProjectCodexJsonlOptions,
): ISessionCatalogProjection => {
  const ignored: Partial<Record<TIgnoredReason, number>> = {};
  const messages: IProjectedMessage[] = [];
  let sessionId: string | null = options.fallbackEntry?.sessionId ?? null;
  let projectLabel = options.fallbackEntry?.projectLabel ?? 'unknown';
  let model: string | undefined = options.fallbackEntry?.model;
  let parentSessionId: string | undefined = options.fallbackEntry?.parentSessionId;
  let rootSessionId: string | undefined = options.fallbackEntry?.rootSessionId;
  let startedAt: string | null = options.fallbackEntry?.startedAt ?? null;
  let lastActivityAt: string | null = options.fallbackEntry?.lastActivityAt ?? null;

  const ignore = (reason: TIgnoredReason) => {
    ignored[reason] = (ignored[reason] ?? 0) + 1;
  };

  const observeTimestamp = (timestamp: string | null) => {
    if (!timestamp) return;
    if (!startedAt || timestamp < startedAt) startedAt = timestamp;
    if (!lastActivityAt || timestamp > lastActivityAt) lastActivityAt = timestamp;
  };

  const pushMessage = (message: IProjectedMessage) => {
    const previous = messages.at(-1);
    const delta = previous
      ? Math.abs(new Date(message.timestamp).getTime() - new Date(previous.timestamp).getTime())
      : Number.POSITIVE_INFINITY;
    if (previous?.role === message.role && previous.text === message.text && delta <= 1_000) {
      ignore('duplicate');
      return;
    }
    messages.push(message);
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
    observeTimestamp(timestamp);
    const type = readString(record, 'type', 80);
    const payload = readObject(record.payload);
    if (!type || !payload) {
      ignore('unknown');
      continue;
    }

    if (type === 'session_meta') {
      const candidateId = readString(payload, 'id', 160);
      if (candidateId && sessionIdSchema.safeParse(candidateId).success) sessionId = candidateId;
      const cwd = readString(payload, 'cwd', 4096);
      if (cwd) projectLabel = posix.basename(cwd.replace(/\/+$/, '')) || 'unknown';
      model = readString(payload, 'model', 120) ?? undefined;
      const parent = readString(payload, 'parent_session_id', 160);
      if (parent && sessionIdSchema.safeParse(parent).success) parentSessionId = parent;
      const root = readString(payload, 'root_session_id', 160);
      if (root && sessionIdSchema.safeParse(root).success) rootSessionId = root;
      continue;
    }

    if (type === 'response_item') {
      const payloadType = readString(payload, 'type', 80);
      if (payloadType === 'reasoning') {
        ignore('reasoning');
        continue;
      }
      if (payloadType === 'function_call' || payloadType === 'function_call_output' || payloadType === 'custom_tool_call') {
        ignore('tool');
        continue;
      }
      if (payloadType !== 'message') {
        ignore('unknown');
        continue;
      }

      const role = readString(payload, 'role', 40);
      if (role !== 'user' && role !== 'assistant') {
        ignore('unknown');
        continue;
      }
      const result = readMessageText(payload);
      if (!result.text || result.reason) {
        ignore(result.reason ?? 'empty');
        continue;
      }
      pushMessage({
        role,
        text: result.text,
        timestamp: timestamp ?? options.indexedAt,
        sequence: (options.sequenceOffset ?? 0) + index,
      });
      continue;
    }

    if (type === 'event_msg') {
      const eventType = readString(payload, 'type', 80);
      const role = eventType === 'user_message' ? 'user' : eventType === 'agent_message' ? 'assistant' : null;
      if (!role) {
        ignore('unknown');
        continue;
      }
      const rawText = readString(payload, 'message', 1024 * 1024);
      const text = rawText ? sanitizeSearchText(rawText) : '';
      if (!text) {
        ignore('empty');
        continue;
      }
      if (role === 'user' && isSyntheticUserText(text)) {
        ignore('synthetic');
        continue;
      }
      pushMessage({
        role,
        text,
        timestamp: timestamp ?? options.indexedAt,
        sequence: (options.sequenceOffset ?? 0) + index,
      });
      continue;
    }

    ignore('unknown');
  }

  if (!sessionId || !startedAt || !lastActivityAt) {
    return { entry: null, records: [], ignored: ignored as Record<string, number> };
  }

  const records = messages.map((message) => ({
    id: `${sessionId}:${message.sequence}`,
    sessionId,
    role: message.role,
    text: message.text,
    snippet: buildSearchSnippet(message.text),
    timestamp: message.timestamp,
    sequence: message.sequence,
  }));
  const entry: ISessionCatalogEntry = {
    sessionId,
    provider: 'codex',
    projectLabel,
    ...(model ? { model } : {}),
    startedAt,
    lastActivityAt,
    turnCount: records.filter((record) => record.role === 'user').length,
    indexedAt: options.indexedAt,
    ...(parentSessionId
      ? { parentSessionId, relationship: options.fallbackEntry?.relationship ?? 'child' as const }
      : {}),
    ...(rootSessionId ? { rootSessionId } : {}),
  };

  return { entry, records, ignored: ignored as Record<string, number> };
};

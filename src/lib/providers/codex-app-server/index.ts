import { buildAgentSessionRelationship, type IAgentSessionRelationship } from '@/lib/agent-session-relationship';
import type { ITimelineAssistantMessage, ITimelineEntry, ITimelineUserMessage, TCliState } from '@/types/timeline';

export const APP_SERVER_PROVIDER_ID = 'codex-app-server';
export const APP_SERVER_ENV_NAME = 'AGENTMUX_CODEX_APP_SERVER';

export type TCodexAppServerMode = 'disabled' | 'experimental';
export type TCodexAppServerCapabilityStatus = 'disabled' | 'fixture-only';

export interface ICodexAppServerCapabilities {
  healthProbe: boolean;
  readOnlySessions: boolean;
  timelineEvents: boolean;
  statusHints: boolean;
  launch: boolean;
  resume: boolean;
  approvalActions: boolean;
}

export interface ICodexAppServerCapability {
  providerId: typeof APP_SERVER_PROVIDER_ID;
  mode: TCodexAppServerMode;
  enabled: boolean;
  status: TCodexAppServerCapabilityStatus;
  capabilities: ICodexAppServerCapabilities;
}

export interface ICodexAppServerSessionProjection {
  providerId: typeof APP_SERVER_PROVIDER_ID;
  sessionId: string;
  sourceSessionId: string;
  summary?: string;
  updatedAt?: string;
  relationship: IAgentSessionRelationship;
}

export interface ICodexAppServerStatusHint {
  providerId: typeof APP_SERVER_PROVIDER_ID;
  sessionId: string;
  cliState: TCliState;
  currentAction?: string;
  requiresApproval: boolean;
  updatedAt?: string;
}

export interface ICodexAppServerFixtureParseResult {
  sessions: ICodexAppServerSessionProjection[];
  timelineEntries: ITimelineEntry[];
  statusHints: ICodexAppServerStatusHint[];
  ignoredEvents: number;
}

type TCodexAppServerEnv = Record<string, string | undefined>;
type TCodexAppServerRecord = Record<string, unknown>;

const disabledCapabilities: ICodexAppServerCapabilities = {
  healthProbe: false,
  readOnlySessions: false,
  timelineEvents: false,
  statusHints: false,
  launch: false,
  resume: false,
  approvalActions: false,
};

const readOnlyCapabilities: ICodexAppServerCapabilities = {
  healthProbe: true,
  readOnlySessions: true,
  timelineEvents: true,
  statusHints: true,
  launch: false,
  resume: false,
  approvalActions: false,
};

const cliStates = new Set<TCliState>([
  'idle',
  'busy',
  'inactive',
  'ready-for-review',
  'needs-input',
  'cancelled',
  'unknown',
]);

const safeIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;

export const resolveCodexAppServerMode = (env: TCodexAppServerEnv = process.env): TCodexAppServerMode =>
  env[APP_SERVER_ENV_NAME] === 'experimental' ? 'experimental' : 'disabled';

export const buildCodexAppServerCapability = (
  env: TCodexAppServerEnv = process.env,
): ICodexAppServerCapability => {
  const mode = resolveCodexAppServerMode(env);
  if (mode !== 'experimental') {
    return {
      providerId: APP_SERVER_PROVIDER_ID,
      mode,
      enabled: false,
      status: 'disabled',
      capabilities: disabledCapabilities,
    };
  }

  return {
    providerId: APP_SERVER_PROVIDER_ID,
    mode,
    enabled: true,
    status: 'fixture-only',
    capabilities: readOnlyCapabilities,
  };
};

const readObject = (value: unknown): TCodexAppServerRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as TCodexAppServerRecord : null;

const readEvents = (content: string): TCodexAppServerRecord[] => {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map(readObject).filter((event): event is TCodexAppServerRecord => !!event);
    }
    const root = readObject(parsed);
    const events = root?.events;
    if (!Array.isArray(events)) return [];
    return events.map(readObject).filter((event): event is TCodexAppServerRecord => !!event);
  } catch {
    return [];
  }
};

const readString = (event: TCodexAppServerRecord, key: string, maxLength = 200): string | null => {
  const value = event[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
};

const readSafeId = (event: TCodexAppServerRecord, key: string): string | null => {
  const value = readString(event, key, 160);
  return value && safeIdPattern.test(value) ? value : null;
};

const readIsoTimestamp = (event: TCodexAppServerRecord): string | undefined => {
  const value = readString(event, 'timestamp', 80);
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
};

const readTimestamp = (event: TCodexAppServerRecord): number => {
  const iso = readIsoTimestamp(event);
  return iso ? new Date(iso).getTime() : 0;
};

const readCliState = (event: TCodexAppServerRecord): TCliState => {
  const value = readString(event, 'cliState', 40);
  return value && cliStates.has(value as TCliState) ? value as TCliState : 'unknown';
};

const readBoolean = (event: TCodexAppServerRecord, key: string): boolean =>
  event[key] === true;

const parseSessionEvent = (event: TCodexAppServerRecord): ICodexAppServerSessionProjection | null => {
  const sessionId = readSafeId(event, 'sessionId');
  if (!sessionId) return null;
  const sourceSessionId = readSafeId(event, 'sourceSessionId') ?? sessionId;
  const relationship = buildAgentSessionRelationship({
    providerId: APP_SERVER_PROVIDER_ID,
    sessionId,
    sourceSessionId,
    parentSessionId: readSafeId(event, 'parentSessionId'),
    rootSessionId: readSafeId(event, 'rootSessionId'),
    relationshipType: readString(event, 'relationshipType', 40),
  });
  const summary = readString(event, 'summary', 200) ?? undefined;
  const updatedAt = readIsoTimestamp(event);

  return {
    providerId: APP_SERVER_PROVIDER_ID,
    sessionId,
    sourceSessionId,
    ...(summary ? { summary } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    relationship,
  };
};

const parseMessageEvent = (event: TCodexAppServerRecord): ITimelineUserMessage | ITimelineAssistantMessage | null => {
  const sessionId = readSafeId(event, 'sessionId');
  const eventId = readSafeId(event, 'eventId');
  const role = readString(event, 'role', 20);
  const text = readString(event, 'text', 8_000);
  if (!sessionId || !eventId || !text || (role !== 'user' && role !== 'assistant')) return null;
  const timestamp = readTimestamp(event);
  const id = `${APP_SERVER_PROVIDER_ID}:${sessionId}:${eventId}`;

  if (role === 'user') {
    return {
      id,
      type: 'user-message',
      timestamp,
      text,
    };
  }

  return {
    id,
    type: 'assistant-message',
    timestamp,
    markdown: text,
  };
};

const parseStatusEvent = (event: TCodexAppServerRecord): ICodexAppServerStatusHint | null => {
  const sessionId = readSafeId(event, 'sessionId');
  if (!sessionId) return null;
  const currentAction = readString(event, 'currentAction', 160) ?? undefined;
  const updatedAt = readIsoTimestamp(event);

  return {
    providerId: APP_SERVER_PROVIDER_ID,
    sessionId,
    cliState: readCliState(event),
    ...(currentAction ? { currentAction } : {}),
    requiresApproval: readBoolean(event, 'requiresApproval'),
    ...(updatedAt ? { updatedAt } : {}),
  };
};

export const parseCodexAppServerFixture = (content: string): ICodexAppServerFixtureParseResult => {
  const sessions: ICodexAppServerSessionProjection[] = [];
  const timelineEntries: ITimelineEntry[] = [];
  const statusHints: ICodexAppServerStatusHint[] = [];
  let ignoredEvents = 0;

  for (const event of readEvents(content)) {
    const type = readString(event, 'type', 40);
    if (type === 'session') {
      const session = parseSessionEvent(event);
      if (session) {
        sessions.push(session);
      } else {
        ignoredEvents++;
      }
      continue;
    }

    if (type === 'message') {
      const entry = parseMessageEvent(event);
      if (entry) {
        timelineEntries.push(entry);
      } else {
        ignoredEvents++;
      }
      continue;
    }

    if (type === 'status') {
      const statusHint = parseStatusEvent(event);
      if (statusHint) {
        statusHints.push(statusHint);
      } else {
        ignoredEvents++;
      }
      continue;
    }

    ignoredEvents++;
  }

  return {
    sessions,
    timelineEntries,
    statusHints,
    ignoredEvents,
  };
};

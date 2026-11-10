import { createReadStream } from 'fs';
import readline from 'readline';
import type { IProjectStats, ISessionStats, TPeriod } from '@/types/stats';
import { getPerfNow, recordPerfCounter, recordPerfDuration } from '@/lib/perf-metrics';
import { isWithinPeriod } from './period-filter';
import { shortenCwd } from './daily-report-builder';
import {
  collectAgentJsonlFiles,
  extractSessionIdFromAgentJsonlPath,
  filterAgentJsonlFilesByDates,
  type IAgentJsonlFile,
  type TAgentJsonlSource,
} from './agent-jsonl-files';
import {
  createClaudeSeen,
  isCountableClaudeModel,
  takeClaudeAssistantUsage,
  takeClaudeUserPrompt,
  type IClaudeSeen,
} from './claude-usage';
import { dateStringsForPeriod } from './period-filter';

const CONCURRENCY_LIMIT = 10;
const SESSION_STATS_TTL_MS = 60_000;

const sessionStatsCache = new Map<TPeriod, { expiresAt: number; data: ISessionStats[] }>();
const sessionStatsInflight = new Map<TPeriod, Promise<ISessionStats[]>>();

interface IRawSessionAgg {
  sessionId: string;
  provider: TAgentJsonlSource;
  project: string;
  startedAt: string;
  lastActivityAt: string;
  messageCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  model: string;
}

interface ICodexTokenUsage {
  input_tokens: number;
  output_tokens: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const parseCodexUsage = (raw: unknown): ICodexTokenUsage | null => {
  if (!isRecord(raw)) return null;
  return {
    input_tokens: Number(raw.input_tokens ?? 0),
    output_tokens: Number(raw.output_tokens ?? 0),
  };
};

const parseJsonlStream = async (
  file: IAgentJsonlFile,
  period: TPeriod,
  claudeSeen: IClaudeSeen,
): Promise<IRawSessionAgg[]> => {
  const sessions = new Map<string, IRawSessionAgg>();
  const filePath = file.filePath;
  let project = file.project || (file.source === 'codex' ? 'Codex' : '');
  let cwd = '';
  let codexSessionId = file.source === 'codex'
    ? extractSessionIdFromAgentJsonlPath(filePath) ?? ''
    : '';
  const claudeSessionId = file.source === 'claude'
    ? extractSessionIdFromAgentJsonlPath(filePath) ?? ''
    : '';
  let codexModel = 'codex';
  const previousCodexTotals = new Map<string, ICodexTokenUsage>();

  const ensureSession = (sessionId: string, timestamp: string): IRawSessionAgg | null => {
    if (!sessionId) return null;
    let agg = sessions.get(sessionId);
    if (!agg) {
      agg = {
        sessionId,
        provider: file.source,
        project,
        startedAt: timestamp,
        lastActivityAt: timestamp,
        messageCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        model: '',
      };
      sessions.set(sessionId, agg);
    }

    if (timestamp < agg.startedAt) agg.startedAt = timestamp;
    if (timestamp > agg.lastActivityAt) agg.lastActivityAt = timestamp;
    if (project && !agg.project) agg.project = project;
    return agg;
  };

  try {
    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const timestamp = String(entry.timestamp ?? '');

        const type = String(entry.type ?? '');
        if (file.source === 'codex' && (type === 'session_meta' || type === 'turn_context')) {
          const payload = isRecord(entry.payload) ? entry.payload : null;
          if (payload) {
            if (type === 'session_meta') {
              codexSessionId = String(payload.id ?? codexSessionId);
            }
            const model = String(payload.model ?? '');
            if (model) codexModel = model;
            if (!cwd && typeof payload.cwd === 'string') {
              cwd = payload.cwd;
              project = shortenCwd(cwd);
            }
          }
          continue;
        }

        if (file.source === 'claude' && !cwd && typeof entry.cwd === 'string') {
          cwd = entry.cwd;
        }

        if (!timestamp || !isWithinPeriod(timestamp, period)) continue;

        if (file.source === 'codex') {
          const payload = isRecord(entry.payload) ? entry.payload : null;
          if (!payload) continue;

          if (type === 'event_msg') {
            const eventType = String(payload.type ?? '');
            if (eventType === 'user_message') {
              const agg = ensureSession(codexSessionId, timestamp);
              if (agg) {
                agg.messageCount++;
                if (!agg.model) agg.model = codexModel;
              }
              continue;
            }

            if (eventType === 'agent_message') {
              const agg = ensureSession(codexSessionId, timestamp);
              if (agg && !agg.model) agg.model = codexModel;
              continue;
            }

            if (eventType === 'token_count') {
              const info = isRecord(payload.info) ? payload.info : null;
              if (!info) continue;

              const model = codexModel || 'codex';
              const lastUsage = parseCodexUsage(info.last_token_usage);
              const totalUsage = parseCodexUsage(info.total_token_usage);
              let usage = lastUsage;

              if (totalUsage) {
                const previous = previousCodexTotals.get(model);
                previousCodexTotals.set(model, totalUsage);
                if (!usage && previous) {
                  usage = {
                    input_tokens: Math.max(0, totalUsage.input_tokens - previous.input_tokens),
                    output_tokens: Math.max(0, totalUsage.output_tokens - previous.output_tokens),
                  };
                } else if (!usage) {
                  usage = totalUsage;
                }
              }

              if (!usage) continue;

              const agg = ensureSession(codexSessionId, timestamp);
              if (agg) {
                agg.totalInputTokens += usage.input_tokens;
                agg.totalOutputTokens += usage.output_tokens;
                agg.model = model;
              }
              continue;
            }
          }

          if (type === 'response_item' && payload.type === 'message') {
            const role = String(payload.role ?? '');
            if (role === 'assistant') {
              const agg = ensureSession(codexSessionId, timestamp);
              if (agg && !agg.model) agg.model = codexModel;
            }
          }

          continue;
        }

        if (type !== 'user' && type !== 'assistant') continue;

        const agg = ensureSession(claudeSessionId, timestamp);
        if (!agg) continue;

        if (takeClaudeUserPrompt(entry, claudeSeen)) {
          agg.messageCount++;
        }

        if (type === 'assistant') {
          const message = isRecord(entry.message) ? entry.message : null;
          const model = String(message?.model ?? '');
          if (isCountableClaudeModel(model)) agg.model = model;

          const usage = takeClaudeAssistantUsage(entry, claudeSeen);
          if (usage) {
            agg.totalInputTokens += usage.input + usage.cacheRead + usage.cacheCreation;
            agg.totalOutputTokens += usage.output;
          }
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // file read error
  }

  if (cwd) {
    const resolvedProject = shortenCwd(cwd);
    for (const agg of sessions.values()) {
      agg.project = resolvedProject;
    }
  }

  return Array.from(sessions.values());
};

const runWithConcurrency = async <T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> => {
  const results: T[] = [];
  let index = 0;

  const runNext = async (): Promise<void> => {
    while (index < tasks.length) {
      const current = index++;
      results[current] = await tasks[current]();
    }
  };

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => runNext());
  await Promise.all(workers);
  return results;
};

const parseJsonlTimestampsByDay = async (
  file: IAgentJsonlFile,
  targetDates: Set<string>,
): Promise<Map<string, Map<string, number[]>>> => {
  const days = new Map<string, Map<string, number[]>>();
  const filePath = file.filePath;
  let codexSessionId = file.source === 'codex'
    ? extractSessionIdFromAgentJsonlPath(filePath) ?? ''
    : '';
  const claudeSessionId = file.source === 'claude'
    ? extractSessionIdFromAgentJsonlPath(filePath) ?? ''
    : '';

  try {
    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const timestamp = String(entry.timestamp ?? '');
        if (!timestamp) continue;

        const type = String(entry.type ?? '');
        if (file.source === 'codex' && (type === 'session_meta' || type === 'turn_context')) {
          const payload = isRecord(entry.payload) ? entry.payload : null;
          if (payload && type === 'session_meta') {
            codexSessionId = String(payload.id ?? codexSessionId);
          }
          continue;
        }

        const date = timestamp.slice(0, 10);
        if (!targetDates.has(date)) continue;

        let sessionId = '';
        if (file.source === 'claude') {
          if (type !== 'user' && type !== 'assistant') continue;
          sessionId = claudeSessionId;
        } else {
          const payload = isRecord(entry.payload) ? entry.payload : null;
          if (!payload) continue;

          const eventType = type === 'event_msg' ? String(payload.type ?? '') : '';
          const responseItemType = type === 'response_item' ? String(payload.type ?? '') : '';
          const responseRole = type === 'response_item' ? String(payload.role ?? '') : '';

          if (
            eventType !== 'user_message'
            && eventType !== 'agent_message'
            && !(responseItemType === 'message' && responseRole === 'assistant')
          ) {
            continue;
          }

          sessionId = codexSessionId;
        }

        if (!sessionId) continue;

        const ts = new Date(timestamp).getTime();
        if (isNaN(ts)) continue;

        let daySessions = days.get(date);
        if (!daySessions) {
          daySessions = new Map();
          days.set(date, daySessions);
        }

        const existing = daySessions.get(sessionId);
        if (existing) {
          existing.push(ts);
        } else {
          daySessions.set(sessionId, [ts]);
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // file read error
  }

  return days;
};

export const parseTimestampsByDay = async (
  targetDates: Set<string>,
): Promise<Map<string, Map<string, number[]>>> => {
  const files = await filterAgentJsonlFilesByDates(await collectAgentJsonlFiles(), targetDates);
  if (files.length === 0) return new Map();

  const tasks = files.map((f) => () => parseJsonlTimestampsByDay(f, targetDates));
  const allResults = await runWithConcurrency(tasks, CONCURRENCY_LIMIT);

  const merged = new Map<string, Map<string, number[]>>();
  for (const result of allResults) {
    for (const [date, daySessions] of result) {
      let existing = merged.get(date);
      if (!existing) {
        existing = new Map();
        merged.set(date, existing);
      }
      for (const [sessionId, timestamps] of daySessions) {
        const existingTs = existing.get(sessionId);
        if (existingTs) {
          existingTs.push(...timestamps);
        } else {
          existing.set(sessionId, [...timestamps]);
        }
      }
    }
  }

  return merged;
};

const parseSessionStatsForPeriod = async (period: TPeriod): Promise<ISessionStats[]> => {
  const targetDates = dateStringsForPeriod(period);
  const collectedFiles = await collectAgentJsonlFiles();
  const files = targetDates ? await filterAgentJsonlFilesByDates(collectedFiles, targetDates) : collectedFiles;
  if (files.length === 0) return [];

  const claudeSeen = createClaudeSeen();
  const tasks = files.map((f) => () => parseJsonlStream(f, period, claudeSeen));
  const allResults = await runWithConcurrency(tasks, CONCURRENCY_LIMIT);
  const sessions: ISessionStats[] = [];

  for (const fileResults of allResults) {
    for (const s of fileResults) {
      sessions.push({
        sessionId: s.sessionId,
        provider: s.provider,
        project: s.project,
        startedAt: s.startedAt,
        lastActivityAt: s.lastActivityAt,
        messageCount: s.messageCount,
        totalTokens: s.totalInputTokens + s.totalOutputTokens,
        model: s.model,
      });
    }
  }

  return sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
};

export const parseAllSessions = async (period: TPeriod): Promise<ISessionStats[]> => {
  const cached = sessionStatsCache.get(period);
  if (cached && Date.now() < cached.expiresAt) {
    recordPerfCounter('stats.session_parse.memory_hit');
    return cached.data;
  }

  const inflight = sessionStatsInflight.get(period);
  if (inflight) {
    recordPerfCounter('stats.session_parse.inflight_join');
    return inflight;
  }

  recordPerfCounter('stats.session_parse.miss');
  const startedAt = getPerfNow();
  const task = parseSessionStatsForPeriod(period)
    .then((data) => {
      sessionStatsCache.set(period, { data, expiresAt: Date.now() + SESSION_STATS_TTL_MS });
      return data;
    })
    .finally(() => {
      recordPerfDuration(`stats.session_parse.${period}`, getPerfNow() - startedAt);
      sessionStatsInflight.delete(period);
    });

  sessionStatsInflight.set(period, task);
  return task;
};

export const parseAllProjects = async (period: TPeriod): Promise<IProjectStats[]> => {
  const sessions = await parseAllSessions(period);
  if (sessions.length === 0) return [];

  const projectMap = new Map<string, IProjectStats>();

  for (const s of sessions) {
    const existing = projectMap.get(s.project);
    if (existing) {
      existing.sessionCount++;
      existing.messageCount += s.messageCount;
      existing.totalTokens += s.totalTokens;
    } else {
      projectMap.set(s.project, {
        project: s.project,
        sessionCount: 1,
        messageCount: s.messageCount,
        totalTokens: s.totalTokens,
      });
    }
  }

  return Array.from(projectMap.values()).sort((a, b) => b.totalTokens - a.totalTokens);
};

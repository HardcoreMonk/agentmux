import { createReadStream } from 'fs';
import readline from 'readline';
import dayjs from 'dayjs';
import type { IHistoryResponse, TPeriod } from '@/types/stats';
import { extractClaudeUserPromptText } from '@/lib/providers/claude/user-prompt';
import { dateStringsForPeriod, isWithinPeriod } from './period-filter';
import {
  collectAgentJsonlFiles,
  filterAgentJsonlFilesByDates,
  type IAgentJsonlFile,
} from './agent-jsonl-files';

interface IRawHistoryEntry {
  display: string;
  timestamp: string;
}

const LENGTH_BUCKETS = [
  { label: '≤50', max: 50 },
  { label: '51–200', max: 200 },
  { label: '201–500', max: 500 },
  { label: '501–1000', max: 1000 },
  { label: '1000+', max: Infinity },
];

const extractCommand = (display: string): string | null => {
  const trimmed = display.trim();
  if (trimmed.startsWith('/')) {
    const cmd = trimmed.split(/\s/)[0];
    return cmd;
  }
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const extractCodexUserText = (entry: Record<string, unknown>): string => {
  if (entry.type !== 'event_msg') return '';
  const payload = isRecord(entry.payload) ? entry.payload : null;
  if (payload?.type !== 'user_message') return '';
  return String(payload.message ?? '');
};

const parseHistoryFile = async (
  file: IAgentJsonlFile,
  period: TPeriod,
): Promise<IRawHistoryEntry[]> => {
  const result: IRawHistoryEntry[] = [];

  try {
    const stream = createReadStream(file.filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const timestamp = String(entry.timestamp ?? '');
        if (!timestamp || !isWithinPeriod(timestamp, period)) continue;

        const display = file.source === 'claude'
          ? extractClaudeUserPromptText(entry) ?? ''
          : extractCodexUserText(entry);

        if (
          !display.trim()
          || display.includes('<local-command-caveat>')
          || display.includes('<task-notification>')
          || display.includes('<environment_context>')
        ) {
          continue;
        }

        result.push({ display, timestamp });
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // file doesn't exist or is unreadable
  }

  return result;
};

const runWithConcurrency = async <T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> => {
  const results: T[] = [];
  let index = 0;

  const run = async () => {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => run()));
  return results;
};

export const parseHistory = async (period: TPeriod, limit: number = 10): Promise<IHistoryResponse> => {
  const commandCounts = new Map<string, number>();
  const lengthCounts = new Map<string, number>();
  const hourCounts: Record<string, number> = {};
  let totalEntries = 0;

  for (const bucket of LENGTH_BUCKETS) {
    lengthCounts.set(bucket.label, 0);
  }

  const targetDates = dateStringsForPeriod(period);
  const collectedFiles = await collectAgentJsonlFiles();
  const files = targetDates ? await filterAgentJsonlFilesByDates(collectedFiles, targetDates) : collectedFiles;
  const entriesByFile = await runWithConcurrency(
    files.map((file) => () => parseHistoryFile(file, period)),
    10,
  );

  for (const entry of entriesByFile.flat()) {
    totalEntries++;
    const display = entry.display;

    const command = extractCommand(display);
    if (command) {
      commandCounts.set(command, (commandCounts.get(command) ?? 0) + 1);
    }

    const len = display.length;
    for (const bucket of LENGTH_BUCKETS) {
      if (len <= bucket.max) {
        lengthCounts.set(bucket.label, (lengthCounts.get(bucket.label) ?? 0) + 1);
        break;
      }
    }

    const hour = String(dayjs(entry.timestamp).hour());
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
  }

  const topCommands = Array.from(commandCounts.entries())
    .map(([command, count]) => ({ command, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  const inputLengthDistribution = LENGTH_BUCKETS.map((bucket) => ({
    bucket: bucket.label,
    count: lengthCounts.get(bucket.label) ?? 0,
  }));

  return {
    topCommands,
    inputLengthDistribution,
    hourlyPattern: hourCounts,
    totalEntries,
  };
};

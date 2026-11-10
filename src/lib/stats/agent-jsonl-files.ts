import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import dayjs from 'dayjs';
import { getClaudeProjectsDir } from '@/lib/path-validation';
import { isClaudeTranscriptPath } from '@/lib/providers/claude/transcript-path';

export type TAgentJsonlSource = 'codex' | 'claude';

export interface IAgentJsonlFile {
  filePath: string;
  source: TAgentJsonlSource;
  project: string;
}

const CODEX_SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');
const SESSION_ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const isAgentFile = (filename: string): boolean => /^agent-/.test(filename);

export const extractSessionIdFromAgentJsonlPath = (jsonlPath: string): string | null => {
  const base = path.basename(jsonlPath, '.jsonl');
  const match = base.match(SESSION_ID_RE);
  return match?.[0] ?? null;
};

export const extractDateFromAgentJsonlPath = (jsonlPath: string): string | null => {
  const parts = path.normalize(jsonlPath).split(path.sep);
  const sessionsIndex = parts.lastIndexOf('sessions');
  if (sessionsIndex === -1 || parts.length <= sessionsIndex + 3) return null;

  const [year, month, day] = parts.slice(sessionsIndex + 1, sessionsIndex + 4);
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) return null;

  return `${year}-${month}-${day}`;
};

export const readFirstTimestampDate = async (filePath: string): Promise<string | null> => {
  try {
    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const ts = String(entry.timestamp ?? '');
        if (ts) return ts.slice(0, 10);
      } catch {
        // skip
      }
    }
  } catch {
    // skip
  }
  return null;
};

const shiftDate = (date: string, days: number): string =>
  dayjs(date).add(days, 'day').format('YYYY-MM-DD');

// Claude paths carry no date, so a transcript is selected when a target date falls between its first
// timestamp and its last write. Both ends are widened by a day because targets can be local dates while
// transcript timestamps are UTC.
const isClaudeFileInDates = async (filePath: string, sortedDates: string[]): Promise<boolean> => {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) return true;

  const lastDate = stat.mtime.toISOString().slice(0, 10);
  const upper = shiftDate(lastDate, 1);
  const candidates = sortedDates.filter((date) => date <= upper);
  if (candidates.length === 0) return false;

  const latestCandidate = candidates[candidates.length - 1];
  if (latestCandidate >= shiftDate(lastDate, -1)) return true;

  const firstDate = await readFirstTimestampDate(filePath);
  return !firstDate || latestCandidate >= shiftDate(firstDate, -1);
};

const FILTER_CONCURRENCY = 16;

export const filterAgentJsonlFilesByDates = async (
  files: IAgentJsonlFile[],
  targetDates: Set<string>,
): Promise<IAgentJsonlFile[]> => {
  if (targetDates.size === 0) return [];

  const sortedDates = Array.from(targetDates).sort();
  const keep = new Array<boolean>(files.length).fill(false);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < files.length) {
      const index = next++;
      const file = files[index];
      if (file.source === 'claude') {
        keep[index] = await isClaudeFileInDates(file.filePath, sortedDates);
      } else {
        const date = extractDateFromAgentJsonlPath(file.filePath);
        keep[index] = !date || targetDates.has(date);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(FILTER_CONCURRENCY, files.length) }, () => worker()));
  return files.filter((_, index) => keep[index]);
};

const collectJsonlPaths = async (
  dir: string,
  maxDepth: number,
  depth = 0,
): Promise<string[]> => {
  const result: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isFile()) {
      if (entry.name.endsWith('.jsonl') && !isAgentFile(entry.name)) {
        result.push(fullPath);
      }
      continue;
    }

    if (entry.isDirectory() && depth < maxDepth) {
      result.push(...await collectJsonlPaths(fullPath, maxDepth, depth + 1));
    }
  }

  return result;
};

const collectCodexJsonlFiles = async (): Promise<IAgentJsonlFile[]> => {
  const files = await collectJsonlPaths(CODEX_SESSIONS_DIR, 5);
  return files.map((filePath) => ({
    filePath,
    source: 'codex' as const,
    project: '',
  }));
};

export const collectClaudeJsonlFiles = async (): Promise<IAgentJsonlFile[]> => {
  const root = getClaudeProjectsDir();
  const files = await collectJsonlPaths(root, 1);
  return files
    .filter((filePath) => isClaudeTranscriptPath(root, filePath))
    .map((filePath) => ({
      filePath,
      source: 'claude' as const,
      project: path.basename(path.dirname(filePath)),
    }));
};

export const collectAgentJsonlFiles = async (): Promise<IAgentJsonlFile[]> => {
  const [codexFiles, claudeFiles] = await Promise.all([collectCodexJsonlFiles(), collectClaudeJsonlFiles()]);
  return [...codexFiles, ...claudeFiles];
};

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createReadStream } from 'fs';
import readline from 'readline';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { getDataDir } from '@/lib/app-identity';
import { getCachedRuntimePreflight, getShellPath } from '@/lib/preflight';
import { normalizeLocale } from '@/lib/locales';
import { extractClaudeUserPromptText } from '@/lib/providers/claude/user-prompt';
import { collectAgentJsonlFiles, filterAgentJsonlFilesByDates } from './agent-jsonl-files';
import type { IDailyReportDay } from '@/types/stats';
import type { IToolStatus } from '@/types/preflight';

const CACHE_DIR = path.join(getDataDir(), 'stats', 'daily-reports');

// --- Cache read/write ---

export const readAllCachedReports = async (): Promise<Record<string, IDailyReportDay>> => {
  const result: Record<string, IDailyReportDay> = {};
  try {
    const files = await fs.readdir(CACHE_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = await fs.readFile(path.join(CACHE_DIR, file), 'utf-8');
        const data = JSON.parse(content) as IDailyReportDay;
        if (data.date && data.brief) {
          result[data.date] = data;
        }
      } catch {
        // skip malformed files
      }
    }
  } catch {
    // directory doesn't exist yet
  }
  return result;
};

const writeCachedReport = async (report: IDailyReportDay): Promise<void> => {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(
    path.join(CACHE_DIR, `${report.date}.json`),
    JSON.stringify(report, null, 2),
    'utf-8',
  );
};

// --- Session data extraction ---

interface ISessionData {
  project: string;
  start: string;
  msgCount: number;
  toolCount: number;
  firstMessage: string;
}

export const shortenCwd = (cwd: string): string => {
  const home = os.homedir();
  const rel = cwd.startsWith(home) ? cwd.slice(home.length + 1) : cwd;
  return rel
    .replace(/^Workspace\/github\.com\//g, '')
    .replace(/^Workspace\/gitlab\.kolonfnc\.com\//g, 'gitlab/')
    .replace(/^Documents\//g, 'docs/')
    .replace(/^Downloads/g, 'Downloads');
};

// Codex files are read as before. Claude paths carry no date, so those are narrowed to the target date first.
const collectReportFilePaths = async (targetDate: string): Promise<string[]> => {
  const files = await collectAgentJsonlFiles();
  const claudeFiles = await filterAgentJsonlFilesByDates(
    files.filter((file) => file.source === 'claude'),
    new Set([targetDate]),
  );
  return [...files.filter((file) => file.source === 'codex'), ...claudeFiles].map((file) => file.filePath);
};

const extractSessionsForDate = async (targetDate: string): Promise<ISessionData[]> => {
  const files = await collectReportFilePaths(targetDate);
  const sessions: ISessionData[] = [];

  for (const filePath of files) {
    const userMessages: { time: string; text: string }[] = [];
    const timestamps: string[] = [];
    let toolCount = 0;
    let cwd = '';

    try {
      const stream = createReadStream(filePath, { encoding: 'utf-8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;
          const ts = String(entry.timestamp ?? '');
          if (!ts.startsWith(targetDate)) continue;

          timestamps.push(ts);
          const type = String(entry.type ?? '');

          if (!cwd && typeof entry.cwd === 'string') {
            cwd = entry.cwd;
          }
          const payload = typeof entry.payload === 'object' && entry.payload !== null
            ? entry.payload as Record<string, unknown>
            : null;

          if (
            (type === 'session_meta' || type === 'turn_context')
            && payload
            && !cwd
            && typeof payload.cwd === 'string'
          ) {
            cwd = payload.cwd;
          }

          if (type === 'event_msg' && payload && payload.type === 'user_message') {
            const text = String(payload.message ?? '').slice(0, 300);
            if (
              text.trim()
              && !text.includes('<environment_context>')
              && !text.includes('<task-notification>')
            ) {
              userMessages.push({ time: ts.slice(11, 16), text: text.slice(0, 200) });
            }
          }

          if (type === 'response_item' && payload && payload.type === 'function_call') {
            toolCount++;
          }

          if (type === 'user') {
            const text = extractClaudeUserPromptText(entry)?.slice(0, 300) ?? '';
            if (text.includes('<local-command-caveat>') || text.includes('<task-notification>')) {
              continue;
            }
            if (text.trim()) {
              userMessages.push({ time: ts.slice(11, 16), text: text.slice(0, 200) });
            }
          }

          if (type === 'assistant') {
            const message = entry.message as Record<string, unknown> | undefined;
            if (!message) continue;
            const content = message.content as unknown[];
            if (Array.isArray(content)) {
              toolCount += content.filter(
                (c) => typeof c === 'object' && c !== null && (c as Record<string, unknown>).type === 'tool_use',
              ).length;
            }
          }
        } catch {
          // skip malformed lines
        }
      }
    } catch {
      // file read error
    }

    if (timestamps.length > 0 && userMessages.length > 0) {
      const project = cwd ? shortenCwd(cwd) : path.basename(path.dirname(filePath));
      sessions.push({
        project,
        start: Math.min(...timestamps.map((t) => new Date(t).getTime())).toString(),
        msgCount: userMessages.length,
        toolCount,
        firstMessage: userMessages[0].text,
      });
    }
  }

  sessions.sort((a, b) => Number(a.start) - Number(b.start));
  return sessions;
};

// --- Agent CLI summary generation ---

const buildPromptData = (sessions: ISessionData[]): string => {
  return sessions
    .map((s) => {
      const time = new Date(Number(s.start)).toTimeString().slice(0, 5);
      return `[${time}] [${s.project}] msgs=${s.msgCount}, tools=${s.toolCount} | ${s.firstMessage}`;
    })
    .join('\n');
};

export const buildDailyReportCodexExecArgs = (outputPath: string): string[] => [
  'exec',
  '--skip-git-repo-check',
  '--ephemeral',
  '--sandbox',
  'read-only',
  '--color',
  'never',
  '--output-last-message',
  outputPath,
  '-',
];

export const resolveDailyReportCodexCwd = (): string =>
  process.env.__CMUX_APP_DIR || process.cwd();

const callCodexCli = async (input: string, systemPrompt: string): Promise<string> => {
  const resolvedPath = await getShellPath();
  const outputPath = path.join(os.tmpdir(), `agentmux-daily-report-${process.pid}-${randomUUID()}.txt`);

  return new Promise((resolve, reject) => {
    const child = execFile(
      'codex',
      buildDailyReportCodexExecArgs(outputPath),
      {
        cwd: resolveDailyReportCodexCwd(),
        timeout: 180_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, PATH: resolvedPath },
      },
      (error, stdout, stderr) => {
        if (error) {
          void fs.unlink(outputPath).catch(() => {});
          reject(new Error(`codex exec failed: ${error.message}${stderr ? `\n${stderr}` : ''}`));
          return;
        }

        void fs.readFile(outputPath, 'utf-8')
          .then((content) => resolve(content.trim() || stdout.trim()))
          .catch(() => resolve(stdout.trim()))
          .finally(() => {
            void fs.unlink(outputPath).catch(() => {});
          });
      },
    );
    child.stdin?.write(`${systemPrompt}\n\n${input}`);
    child.stdin?.end();
  });
};

export const DAILY_REPORT_CLAUDE_ARGS: readonly string[] = [
  '-p',
  '--output-format',
  'text',
  '--no-session-persistence',
  '--restricted',
  '--tools',
  '',
  '--strict-mcp-config',
  '--disable-slash-commands',
];

// The Claude counterpart of `codex exec --ephemeral --sandbox read-only`: no transcript, no tools, no
// user/project/local settings or MCP servers, and an empty working directory that is removed afterwards.
const callClaudeCli = async (input: string, systemPrompt: string): Promise<string> => {
  const resolvedPath = await getShellPath();
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmux-report-'));

  try {
    return await new Promise<string>((resolve, reject) => {
      const child = execFile(
        'claude',
        [...DAILY_REPORT_CLAUDE_ARGS],
        {
          cwd,
          timeout: 180_000,
          maxBuffer: 1024 * 1024,
          env: { ...process.env, PATH: resolvedPath },
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`claude -p failed: ${error.message}${stderr ? `\n${stderr}` : ''}`));
            return;
          }
          resolve(stdout.trim());
        },
      );
      child.stdin?.write(`${systemPrompt}\n\n${input}`);
      child.stdin?.end();
    });
  } finally {
    await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
};

type TDailyReportGenerator = 'codex' | 'claude';

const isAgentUsable = (status: IToolStatus | undefined): boolean =>
  !!status?.installed && status.compatible !== false;

// Codex stays the default; Claude is used only when Codex is unavailable. With neither, the Codex path
// runs and fails the way it always has.
const resolveDailyReportGenerator = async (): Promise<TDailyReportGenerator> => {
  try {
    const { agents } = await getCachedRuntimePreflight();
    if (isAgentUsable(agents.codex)) return 'codex';
    if (isAgentUsable(agents.claude)) return 'claude';
  } catch {
    // fall through to the Codex path
  }
  return 'codex';
};

const LOCALE_LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  ko: 'Korean (한국어)',
};

const resolveLanguageName = (locale: string): string =>
  LOCALE_LANGUAGE_NAMES[locale] ?? LOCALE_LANGUAGE_NAMES.en;

const SUMMARY_PROMPT = (date: string, locale: string) => {
  const languageName = resolveLanguageName(locale);
  return `Summarize the coding agent session history for ${date}.

Output format (use exactly this structure):

[BRIEF]
A 2-3 line summary of the entire day. Use terse noun-form phrases. Plain text only. No markdown headings (#) or separators (---).

[DETAIL]
## Project Name
### Major Feature / Area
- One-line task summary
- One-line task summary
### Another Feature / Area
- One-line task summary

Rules:
- The [BRIEF] and [DETAIL] tags must each appear exactly once, at the start of a line.
- Do not insert meta text outside the tags (separators, numbering, explanations).
- Always include the "## Project Name" heading, even when there is only one project.
- Each item is a single line — no filenames, no code snippets.
- Use terse noun-form phrases (e.g. "Fix login logic", "Improve mobile layout"). Avoid finished-sentence / past-tense forms.
- Focus on WHAT, not HOW.
- Skip trivial chatter (greetings, one-off questions, commit commands).
- Do not run tools or inspect files. Use only the data below.
- IMPORTANT: Write ALL brief and detail content in ${languageName}. Keep the [BRIEF] / [DETAIL] tags and markdown syntax (##, ###, -) as-is in English.

Data:`;
};

const stripTrailingMarkdownNoise = (text: string): string =>
  text.replace(/[\s#\-]*$/, '').trim();

const parseSummaryResponse = (response: string): { brief: string; detail: string } => {
  const briefMatch = response.match(/\[BRIEF\]\s*\n([\s\S]*?)(?=\[DETAIL\])/);
  const detailMatch = response.match(/\[DETAIL\]\s*\n([\s\S]*?)$/);

  return {
    brief: briefMatch ? stripTrailingMarkdownNoise(briefMatch[1]) : response.slice(0, 500),
    detail: detailMatch ? detailMatch[1].trim() : '',
  };
};

// --- Public API ---

export const generateDailyReport = async (
  date: string,
  force = false,
  locale = 'en',
): Promise<IDailyReportDay> => {
  const resolvedLocale = normalizeLocale(locale);
  if (!force) {
    const existing = await readCachedReport(date);
    if (existing && existing.locale === resolvedLocale) return existing;
  }

  const sessions = await extractSessionsForDate(date);
  if (sessions.length === 0) {
    const empty: IDailyReportDay = {
      date,
      brief: 'No activity recorded.',
      detail: '',
      generatedAt: new Date().toISOString(),
      locale: resolvedLocale,
    };
    await writeCachedReport(empty);
    return empty;
  }

  const promptData = buildPromptData(sessions);
  const summaryPrompt = SUMMARY_PROMPT(date, resolvedLocale);
  const response = await resolveDailyReportGenerator() === 'claude'
    ? await callClaudeCli(promptData, summaryPrompt)
    : await callCodexCli(promptData, summaryPrompt);
  const { brief, detail } = parseSummaryResponse(response);

  const report: IDailyReportDay = {
    date,
    brief,
    detail,
    generatedAt: new Date().toISOString(),
    locale: resolvedLocale,
  };

  await writeCachedReport(report);
  return report;
};

export const readCachedReport = async (date: string): Promise<IDailyReportDay | null> => {
  try {
    const content = await fs.readFile(path.join(CACHE_DIR, `${date}.json`), 'utf-8');
    const data = JSON.parse(content) as IDailyReportDay;
    return data.date && data.brief ? data : null;
  } catch {
    return null;
  }
};

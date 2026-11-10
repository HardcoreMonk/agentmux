import { existsSync } from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildDailyReportCodexExecArgs,
  resolveDailyReportCodexCwd,
} from '@/lib/stats/daily-report-builder';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  getCachedRuntimePreflight: vi.fn(),
  getShellPath: vi.fn(async () => '/usr/local/bin:/usr/bin:/bin'),
}));

vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  execFile: mocks.execFile,
}));

vi.mock('@/lib/preflight', () => ({
  getCachedRuntimePreflight: mocks.getCachedRuntimePreflight,
  getShellPath: mocks.getShellPath,
}));

describe('daily report builder', () => {
  it('builds codex exec args supported by current non-interactive CLI', () => {
    expect(buildDailyReportCodexExecArgs('/tmp/report.txt')).toEqual([
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--color',
      'never',
      '--output-last-message',
      '/tmp/report.txt',
      '-',
    ]);
  });

  it('uses the app root for codex exec when the server cwd can be replaced by builds', () => {
    const previous = process.env.__CMUX_APP_DIR;
    process.env.__CMUX_APP_DIR = '/tmp/codexmux-app';

    try {
      expect(resolveDailyReportCodexCwd()).toBe('/tmp/codexmux-app');
    } finally {
      if (previous === undefined) {
        delete process.env.__CMUX_APP_DIR;
      } else {
        process.env.__CMUX_APP_DIR = previous;
      }
    }
  });
});

describe('daily report generator choice', () => {
  const REPORT_DATE = '2026-04-27';
  const CLAUDE_SESSION = '4f2c9a10-1b2c-4d3e-8f90-0a1b2c3d4e5f';
  const SUMMARY = '[BRIEF]\nBuild fixes\n[DETAIL]\n## app\n### Build\n- Fix the build';

  interface IExecCall {
    command: string;
    args: string[];
    options: { cwd: string; timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv };
    cwdExisted: boolean;
    stdin: string;
  }

  let tempHome: string;
  let calls: IExecCall[];

  const status = (installed: boolean, compatible = installed) => ({ installed, version: installed ? '1.0.0' : null, compatible });

  const setAgents = (codex: boolean, claude: boolean) => {
    mocks.getCachedRuntimePreflight.mockResolvedValue({
      tmux: status(true),
      git: status(true),
      agent: status(codex),
      agents: { codex: status(codex), claude: status(claude) },
    });
  };

  const respondWith = (error: Error | null, stdout: string) => {
    mocks.execFile.mockImplementation((
      command: string,
      args: string[],
      options: IExecCall['options'],
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const call: IExecCall = { command, args, options, cwdExisted: existsSync(options.cwd), stdin: '' };
      calls.push(call);
      setImmediate(() => callback(error, stdout, ''));
      return {
        stdin: {
          write: (chunk: string) => { call.stdin += chunk; },
          end: () => {},
        },
      };
    });
  };

  const writeClaudeTranscript = async () => {
    const dir = path.join(tempHome, '.claude', 'projects', '-work-app');
    await fs.mkdir(dir, { recursive: true });
    const lines = [
      { type: 'user', sessionId: CLAUDE_SESSION, cwd: '/work/app', timestamp: `${REPORT_DATE}T02:00:00.000Z`, message: { role: 'user', content: 'Fix the build' } },
      { type: 'assistant', sessionId: CLAUDE_SESSION, cwd: '/work/app', timestamp: `${REPORT_DATE}T02:00:05.000Z`, message: { id: 'msg_A', model: 'claude-opus-4-5', role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
    ];
    await fs.writeFile(
      path.join(dir, `${CLAUDE_SESSION}.jsonl`),
      lines.map((line) => JSON.stringify(line)).join('\n'),
      'utf-8',
    );
  };

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmux-daily-report-'));
    vi.resetModules();
    vi.stubEnv('HOME', tempHome);
    vi.stubEnv('USERPROFILE', tempHome);
    vi.stubEnv('AGENTMUX_DATA_DIR', '');
    vi.stubEnv('CODEXMUX_DATA_DIR', '');
    calls = [];
    mocks.execFile.mockReset();
    mocks.getCachedRuntimePreflight.mockReset();
    await writeClaudeTranscript();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  it('falls back to claude -p in a throwaway directory when Codex is unavailable', async () => {
    setAgents(false, true);
    respondWith(null, SUMMARY);

    const { generateDailyReport } = await import('@/lib/stats/daily-report-builder');
    const report = await generateDailyReport(REPORT_DATE, true, 'en');

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.command).toBe('claude');
    expect(call.args).toEqual([
      '-p',
      '--output-format',
      'text',
      '--no-session-persistence',
      '--restricted',
      '--tools',
      '',
      '--strict-mcp-config',
      '--disable-slash-commands',
    ]);
    expect(path.dirname(call.options.cwd)).toBe(os.tmpdir());
    expect(path.basename(call.options.cwd)).toMatch(/^agentmux-report-/);
    expect(call.cwdExisted).toBe(true);
    expect(existsSync(call.options.cwd)).toBe(false);
    expect(call.options.timeout).toBe(180_000);
    expect(call.options.maxBuffer).toBe(1024 * 1024);
    expect(call.options.env.PATH).toBe('/usr/local/bin:/usr/bin:/bin');
    expect(call.stdin).toContain('coding agent session history');
    expect(call.stdin).toContain('Fix the build');
    expect(report.brief).toBe('Build fixes');
  });

  it('removes the throwaway directory when claude -p fails', async () => {
    setAgents(false, true);
    respondWith(new Error('exit 1'), '');

    const { generateDailyReport } = await import('@/lib/stats/daily-report-builder');
    await expect(generateDailyReport(REPORT_DATE, true, 'en')).rejects.toThrow(/exit 1/);

    expect(calls).toHaveLength(1);
    expect(existsSync(calls[0].options.cwd)).toBe(false);
  });

  it('keeps the codex exec path when Codex is available', async () => {
    setAgents(true, true);
    respondWith(null, SUMMARY);

    const { generateDailyReport, resolveDailyReportCodexCwd: resolveCwd } = await import('@/lib/stats/daily-report-builder');
    await generateDailyReport(REPORT_DATE, true, 'en');

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.command).toBe('codex');
    expect(call.args).toEqual([
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--color',
      'never',
      '--output-last-message',
      expect.stringMatching(/agentmux-daily-report-.*\.txt$/),
      '-',
    ]);
    expect(call.options.cwd).toBe(resolveCwd());
  });

  it('fails the same way as before when neither agent is available', async () => {
    setAgents(false, false);
    respondWith(new Error('spawn codex ENOENT'), '');

    const { generateDailyReport } = await import('@/lib/stats/daily-report-builder');
    await expect(generateDailyReport(REPORT_DATE, true, 'en')).rejects.toThrow(/^codex exec failed: spawn codex ENOENT/);
    expect(calls.map((call) => call.command)).toEqual(['codex']);
  });
});

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('stats agent JSONL file date helpers', () => {
  it('extracts Codex session date from the standard sessions path', async () => {
    const { extractDateFromAgentJsonlPath } = await import('@/lib/stats/agent-jsonl-files');

    expect(extractDateFromAgentJsonlPath('/home/me/.codex/sessions/2026/05/06/rollout.jsonl'))
      .toBe('2026-05-06');
  });

  it('keeps target-date files and unknown-date files while excluding known non-target dates', async () => {
    const { filterAgentJsonlFilesByDates } = await import('@/lib/stats/agent-jsonl-files');
    const files = [
      { filePath: '/home/me/.codex/sessions/2026/05/06/today.jsonl', source: 'codex' as const, project: '' },
      { filePath: '/home/me/.codex/sessions/2026/05/05/yesterday.jsonl', source: 'codex' as const, project: '' },
      { filePath: '/home/me/custom/session.jsonl', source: 'codex' as const, project: '' },
    ];

    expect((await filterAgentJsonlFilesByDates(files, new Set(['2026-05-06']))).map((file) => file.filePath))
      .toEqual([
        '/home/me/.codex/sessions/2026/05/06/today.jsonl',
        '/home/me/custom/session.jsonl',
      ]);
  });
});

describe('stats agent JSONL Claude transcripts', () => {
  let tempHome: string;

  const SESSION_OLD = '11111111-1111-4111-8111-111111111111';
  const SESSION_SPAN = '22222222-2222-4222-8222-222222222222';
  const SESSION_NEW = '33333333-3333-4333-8333-333333333333';

  const projectsDir = () => path.join(tempHome, '.claude', 'projects');

  const writeClaude = async (
    relativePath: string,
    lines: unknown[],
    mtime?: string,
  ): Promise<string> => {
    const filePath = path.join(projectsDir(), relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, lines.map((line) => JSON.stringify(line)).join('\n'), 'utf-8');
    if (mtime) {
      const date = new Date(mtime);
      await fs.utimes(filePath, date, date);
    }
    return filePath;
  };

  const prompt = (timestamp: string) => ({
    type: 'user',
    timestamp,
    cwd: '/work/app',
    message: { role: 'user', content: 'hello' },
  });

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmux-stats-files-'));
    vi.resetModules();
    vi.stubEnv('HOME', tempHome);
    vi.stubEnv('USERPROFILE', tempHome);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  it('collects Claude session transcripts and skips agent, subagent and non-session files', async () => {
    const transcript = await writeClaude(`-work-app/${SESSION_OLD}.jsonl`, [prompt('2026-03-01T10:00:00.000Z')]);
    await writeClaude('-work-app/agent-1a2b3c4d.jsonl', [prompt('2026-03-01T10:00:00.000Z')]);
    await writeClaude(`-work-app/${SESSION_OLD}/subagents/agent-5e6f7a8b.jsonl`, [prompt('2026-03-01T10:00:00.000Z')]);
    await writeClaude('-work-app/notes.jsonl', [prompt('2026-03-01T10:00:00.000Z')]);
    const codexDir = path.join(tempHome, '.codex', 'sessions', '2026', '03', '01');
    await fs.mkdir(codexDir, { recursive: true });
    const codexFile = path.join(codexDir, `rollout-2026-03-01T10-00-00-${SESSION_NEW}.jsonl`);
    await fs.writeFile(codexFile, '', 'utf-8');

    const { collectAgentJsonlFiles } = await import('@/lib/stats/agent-jsonl-files');
    const files = await collectAgentJsonlFiles();

    expect(files).toHaveLength(2);
    expect(files).toContainEqual({ filePath: codexFile, source: 'codex', project: '' });
    expect(files).toContainEqual({ filePath: transcript, source: 'claude', project: '-work-app' });
  });

  it('filters Claude transcripts by their first timestamp and last write time', async () => {
    const oldFile = await writeClaude(
      `-work-app/${SESSION_OLD}.jsonl`,
      [{ type: 'summary', summary: 'no timestamp here' }, prompt('2026-03-01T10:00:00.000Z')],
      '2026-03-02T10:00:00.000Z',
    );
    const spanFile = await writeClaude(
      `-work-app/${SESSION_SPAN}.jsonl`,
      [prompt('2026-03-10T10:00:00.000Z'), prompt('2026-03-20T09:00:00.000Z')],
      '2026-03-20T10:00:00.000Z',
    );
    const newFile = await writeClaude(
      `-work-app/${SESSION_NEW}.jsonl`,
      [prompt('2026-03-25T10:00:00.000Z')],
      '2026-03-26T10:00:00.000Z',
    );

    const { collectAgentJsonlFiles, filterAgentJsonlFilesByDates } = await import('@/lib/stats/agent-jsonl-files');
    const files = await collectAgentJsonlFiles();
    const select = async (dates: string[]) =>
      (await filterAgentJsonlFilesByDates(files, new Set(dates))).map((file) => file.filePath).sort();

    expect(await select(['2026-03-15'])).toEqual([spanFile]);
    expect(await select(['2026-03-01'])).toEqual([oldFile]);
    expect(await select(['2026-03-26'])).toEqual([newFile]);
    expect(await select(['2026-03-05'])).toEqual([]);
    expect(await select(['2026-03-01', '2026-03-26'])).toEqual([oldFile, newFile].sort());
  });
});

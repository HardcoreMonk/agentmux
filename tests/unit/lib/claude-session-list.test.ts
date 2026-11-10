import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listClaudeSessionsForCwd } from '@/lib/providers/claude/session-list';
import { toClaudeProjectName } from '@/lib/providers/claude/session-detection';

const idA = '11111111-2222-4333-8444-aaaaaaaaaaaa';
const idB = '11111111-2222-4333-8444-bbbbbbbbbbbb';

let home: string;

const line = (value: unknown): string => JSON.stringify(value);

const writeTranscript = async (cwd: string, name: string, lines: unknown[], mtime?: Date): Promise<string> => {
  const dir = path.join(home, '.claude', 'projects', toClaudeProjectName(cwd));
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await fs.writeFile(file, lines.map(line).join('\n'));
  if (mtime) await fs.utimes(file, mtime, mtime);
  return file;
};

const prompt = (text: string, timestamp: string) => ({
  type: 'user',
  timestamp,
  message: { role: 'user', content: text },
});

describe('claude session list', () => {
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmux-claude-list-'));
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it('lists transcripts newest first with prompt metadata', async () => {
    const older = await writeTranscript('/tmp/p', `${idA}.jsonl`, [
      prompt('first question', '2026-01-01T00:00:00.000Z'),
      { type: 'assistant', timestamp: '2026-01-01T00:00:05.000Z', message: { content: [] } },
      { type: 'user', timestamp: '2026-01-01T00:00:06.000Z', message: { content: [{ type: 'tool_result', content: 'x' }] } },
      prompt('<command-name>/clear</command-name>', '2026-01-01T00:00:07.000Z'),
      prompt('second question', '2026-01-01T00:00:08.000Z'),
    ], new Date('2026-01-01T00:00:08.000Z'));
    await writeTranscript('/tmp/p', `${idB}.jsonl`, [
      prompt('newer work', '2026-02-01T00:00:00.000Z'),
    ], new Date('2026-02-01T00:00:01.000Z'));

    const sessions = await listClaudeSessionsForCwd('/tmp/p', home);

    expect(sessions.map((session) => session.sessionId)).toEqual([idB, idA]);
    expect(sessions[1]).toMatchObject({
      firstMessage: 'first question',
      turnCount: 2,
      startedAt: '2026-01-01T00:00:00.000Z',
      cwd: '/tmp/p',
      jsonlPath: older,
      providerId: 'claude',
    });
    expect(sessions[0].lastActivityAt).toBe('2026-02-01T00:00:01.000Z');
  });

  it('skips agent transcripts and non-UUID names', async () => {
    await writeTranscript('/tmp/p', 'agent-x.jsonl', [prompt('a', '2026-01-01T00:00:00.000Z')]);
    await writeTranscript('/tmp/p', 'notes.jsonl', [prompt('a', '2026-01-01T00:00:00.000Z')]);
    await writeTranscript('/tmp/p', `${idA}.jsonl`, [prompt('a', '2026-01-01T00:00:00.000Z')]);

    const sessions = await listClaudeSessionsForCwd('/tmp/p', home);

    expect(sessions.map((session) => session.sessionId)).toEqual([idA]);
  });

  it('ignores transcripts from other cwd values', async () => {
    await writeTranscript('/tmp/other', `${idA}.jsonl`, [prompt('a', '2026-01-01T00:00:00.000Z')]);

    expect(await listClaudeSessionsForCwd('/tmp/p', home)).toEqual([]);
  });

  it('reads only the edges of large transcripts', async () => {
    const filler = { type: 'assistant', timestamp: '2026-03-01T00:00:01.000Z', message: { content: 'x'.repeat(2000) } };
    const lines = [
      prompt('opening', '2026-03-01T00:00:00.000Z'),
      ...Array.from({ length: 200 }, () => filler),
      prompt('closing', '2026-03-02T00:00:00.000Z'),
    ];
    await writeTranscript('/tmp/p', `${idA}.jsonl`, lines, new Date('2026-03-01T00:00:00.000Z'));

    const [session] = await listClaudeSessionsForCwd('/tmp/p', home);

    expect(session.firstMessage).toBe('opening');
    expect(session.lastActivityAt).toBe('2026-03-02T00:00:00.000Z');
  });
});

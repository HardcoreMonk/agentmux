import { describe, expect, it } from 'vitest';
import { projectClaudeJsonl } from '@/lib/session-catalog/claude-jsonl-projector';

const SESSION_ID = '11111111-2222-4333-8444-555555555555';

const line = (record: Record<string, unknown>) => JSON.stringify({
  sessionId: SESSION_ID,
  cwd: '<fixture-root>/projects/demo-app',
  ...record,
});

const transcript = [
  line({ type: 'user', timestamp: '2026-11-01T08:00:00.000Z', message: { role: 'user', content: 'find the flaky worker test' } }),
  line({
    type: 'assistant',
    timestamp: '2026-11-01T08:00:02.000Z',
    message: {
      role: 'assistant',
      model: 'claude-synthetic-1',
      content: [
        { type: 'text', text: 'Looking at the worker suite now.' },
        { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'secret-tool-input' } },
      ],
    },
  }),
  line({
    type: 'user',
    timestamp: '2026-11-01T08:00:03.000Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'secret-tool-output' }] },
  }),
  line({ type: 'user', isMeta: true, timestamp: '2026-11-01T08:00:04.000Z', message: { role: 'user', content: 'meta caveat text' } }),
  line({ type: 'user', isSidechain: true, timestamp: '2026-11-01T08:00:05.000Z', message: { role: 'user', content: 'sidechain text' } }),
  line({ type: 'summary', timestamp: '2026-11-01T08:00:06.000Z', summary: 'unknown line kind' }),
  line({ type: 'user', timestamp: '2026-11-01T08:01:00.000Z', message: { role: 'user', content: 'second question' } }),
  '',
].join('\n');

describe('projectClaudeJsonl', () => {
  it('projects entry fields and user/assistant text records', () => {
    const projection = projectClaudeJsonl(transcript, { indexedAt: '2026-11-01T09:00:00.000Z' });

    expect(projection.entry).toEqual({
      sessionId: SESSION_ID,
      provider: 'claude',
      projectLabel: 'demo-app',
      model: 'claude-synthetic-1',
      startedAt: '2026-11-01T08:00:00.000Z',
      lastActivityAt: '2026-11-01T08:01:00.000Z',
      turnCount: 2,
      indexedAt: '2026-11-01T09:00:00.000Z',
    });
    expect(projection.records.map((record) => [record.role, record.text])).toEqual([
      ['user', 'find the flaky worker test'],
      ['assistant', 'Looking at the worker suite now.'],
      ['user', 'second question'],
    ]);
  });

  it('keeps tool input, tool results, meta and sidechain text out of the records', () => {
    const projection = projectClaudeJsonl(transcript, { indexedAt: '2026-11-01T09:00:00.000Z' });
    const all = JSON.stringify(projection.records);

    for (const leaked of ['secret-tool-input', 'secret-tool-output', 'meta caveat', 'sidechain text']) {
      expect(all).not.toContain(leaked);
    }
  });

  it('returns no entry when there is no session id or timestamp', () => {
    expect(projectClaudeJsonl('not json\n', { indexedAt: '2026-11-01T09:00:00.000Z' }).entry).toBeNull();
  });

  it('uses the fallback entry for appended chunks with a sequence offset', () => {
    const first = projectClaudeJsonl(transcript, { indexedAt: '2026-11-01T09:00:00.000Z' });
    const appended = projectClaudeJsonl(
      line({ type: 'user', timestamp: '2026-11-01T08:02:00.000Z', message: { role: 'user', content: 'third question' } }) + '\n',
      { indexedAt: '2026-11-01T09:01:00.000Z', fallbackEntry: first.entry ?? undefined, sequenceOffset: 1000 },
    );

    expect(appended.entry).toMatchObject({ sessionId: SESSION_ID, provider: 'claude', projectLabel: 'demo-app', model: 'claude-synthetic-1' });
    expect(appended.records[0]).toMatchObject({ sequence: 1000, text: 'third question' });
  });
});

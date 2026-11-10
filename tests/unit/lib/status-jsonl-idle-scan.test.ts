import { describe, expect, it } from 'vitest';

import {
  extractStatusAssistantInfo,
  scanStatusJsonlLines,
} from '@/lib/status/jsonl-idle-scan';

const line = (value: unknown): string => JSON.stringify(value);

describe('status JSONL idle scan helpers', () => {
  it('marks stop hook summaries as idle', () => {
    expect(scanStatusJsonlLines([
      line({ type: 'system', subtype: 'stop_hook_summary', timestamp: '2026-05-06T00:00:00.000Z' }),
    ], 0)).toMatchObject({
      matched: true,
      idle: true,
      stale: false,
      interrupted: false,
    });
  });

  it('keeps recent user messages as stale but not idle before awaiting-api threshold', () => {
    expect(scanStatusJsonlLines([
      line({ type: 'user', timestamp: '2026-05-06T00:00:00.000Z', message: { content: [{ type: 'text', text: 'run' }] } }),
    ], 10_000)).toMatchObject({
      matched: true,
      idle: false,
      stale: true,
      needsStaleRecheck: true,
      staleMs: 90_000,
    });
  });

  it('skips meta user lines so they do not move the last entry time', () => {
    expect(scanStatusJsonlLines([
      line({
        type: 'assistant',
        timestamp: '2026-05-06T00:00:00.000Z',
        message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
      }),
      line({
        type: 'user',
        isMeta: true,
        timestamp: '2026-05-06T00:00:05.000Z',
        message: { content: [{ type: 'text', text: 'Caveat: synthetic meta line.' }] },
      }),
    ], 10_000)).toMatchObject({
      matched: true,
      idle: true,
      stale: false,
      lastEntryTs: Date.parse('2026-05-06T00:00:00.000Z'),
    });
  });

  it('marks interrupted user marker as idle', () => {
    expect(scanStatusJsonlLines([
      line({ type: 'user', timestamp: '2026-05-06T00:00:00.000Z', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } }),
    ], 0)).toMatchObject({
      matched: true,
      idle: true,
      interrupted: true,
    });
  });

  it('extracts current tool action from assistant content', () => {
    expect(extractStatusAssistantInfo([
      line({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'checking' },
            { type: 'tool_use', name: 'Read', input: { file_path: 'server.ts' } },
          ],
        },
      }),
    ])).toMatchObject({
      currentAction: {
        toolName: 'Read',
      },
      reset: false,
    });
  });

  it('resets assistant state when a newer non-tool user message appears', () => {
    expect(extractStatusAssistantInfo([
      line({ type: 'assistant', message: { content: [{ type: 'text', text: 'old answer' }] } }),
      line({ type: 'user', message: { content: [{ type: 'text', text: 'new prompt' }] } }),
    ])).toEqual({
      lastAssistantSnippet: null,
      currentAction: null,
      reset: true,
    });
  });
});

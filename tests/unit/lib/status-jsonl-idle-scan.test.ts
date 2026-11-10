import { describe, expect, it } from 'vitest';

import { claudeProvider } from '@/lib/providers/claude';
import { decideNeedsInputJsonlExit } from '@/lib/status/hook-session-binding';
import {
  extractStatusAssistantInfo,
  scanStatusJsonlLines,
} from '@/lib/status/jsonl-idle-scan';
import { shouldEmitSyntheticJsonlInterrupt } from '@/lib/status/jsonl-reconciliation-service';

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

  it('marks a turn that ended after an interrupt marker as interrupted', () => {
    const turnEndTs = '2026-11-10T14:42:21.444Z';
    expect(scanStatusJsonlLines([
      line({
        type: 'assistant',
        timestamp: '2026-11-10T14:41:12.000Z',
        message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'a.txt' } }] },
      }),
      line({
        type: 'user',
        timestamp: '2026-11-10T14:42:21.400Z',
        message: { content: [{ type: 'tool_result', is_error: true, content: 'The user doesn\'t want to proceed with this tool use.' }] },
      }),
      line({
        type: 'user',
        timestamp: '2026-11-10T14:42:21.410Z',
        message: { content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] },
      }),
      line({ type: 'system', subtype: 'turn_duration', timestamp: turnEndTs, durationMs: 70_000 }),
      line({ type: 'cost-state' }),
    ], 0)).toEqual({
      matched: true,
      idle: true,
      stale: false,
      needsStaleRecheck: false,
      staleMs: 0,
      lastEntryTs: Date.parse(turnEndTs),
      interrupted: true,
    });
  });

  it('keeps a normal turn end uninterrupted', () => {
    expect(scanStatusJsonlLines([
      line({
        type: 'assistant',
        timestamp: '2026-11-10T14:40:36.000Z',
        message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'OK' }] },
      }),
      line({ type: 'system', subtype: 'stop_hook_summary', timestamp: '2026-11-10T14:40:36.500Z' }),
      line({ type: 'system', subtype: 'turn_duration', timestamp: '2026-11-10T14:40:36.600Z', durationMs: 1_500 }),
    ], 0)).toMatchObject({
      matched: true,
      idle: true,
      interrupted: false,
      lastEntryTs: Date.parse('2026-11-10T14:40:36.600Z'),
    });
  });

  it('only counts the last turn when an earlier turn was interrupted', () => {
    expect(scanStatusJsonlLines([
      line({
        type: 'user',
        timestamp: '2026-11-10T14:42:21.410Z',
        message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] },
      }),
      line({ type: 'system', subtype: 'turn_duration', timestamp: '2026-11-10T14:42:21.444Z' }),
      line({
        type: 'user',
        timestamp: '2026-11-10T14:43:00.000Z',
        message: { content: [{ type: 'text', text: 'Reply with OK' }] },
      }),
      line({
        type: 'assistant',
        timestamp: '2026-11-10T14:43:01.000Z',
        message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'OK' }] },
      }),
      line({ type: 'system', subtype: 'turn_duration', timestamp: '2026-11-10T14:43:01.100Z' }),
    ], 0)).toMatchObject({
      matched: true,
      idle: true,
      interrupted: false,
      lastEntryTs: Date.parse('2026-11-10T14:43:01.100Z'),
    });
  });

  it('skips meta and sidechain lines when looking for the interrupt marker', () => {
    expect(scanStatusJsonlLines([
      line({
        type: 'user',
        timestamp: '2026-11-10T14:42:21.410Z',
        message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] },
      }),
      line({
        type: 'user',
        isMeta: true,
        timestamp: '2026-11-10T14:42:21.420Z',
        message: { content: [{ type: 'text', text: 'Caveat: synthetic meta line.' }] },
      }),
      line({
        type: 'assistant',
        isSidechain: true,
        timestamp: '2026-11-10T14:42:21.430Z',
        message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'subagent' }] },
      }),
      line({ type: 'system', subtype: 'turn_duration', timestamp: '2026-11-10T14:42:21.444Z' }),
    ], 0)).toMatchObject({ matched: true, idle: true, interrupted: true });
  });

  it('lets an interrupted turn end leave needs-input and busy for idle', () => {
    const needsInputSince = Date.parse('2026-11-10T14:41:12.846Z');
    const scan = scanStatusJsonlLines([
      line({
        type: 'user',
        timestamp: '2026-11-10T14:42:21.400Z',
        message: { content: [{ type: 'tool_result', is_error: true, content: 'rejected' }] },
      }),
      line({
        type: 'user',
        timestamp: '2026-11-10T14:42:21.410Z',
        message: { content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] },
      }),
      line({ type: 'system', subtype: 'turn_duration', timestamp: '2026-11-10T14:42:21.444Z' }),
    ], 0);

    expect(decideNeedsInputJsonlExit({
      behavior: claudeProvider.statusBehavior,
      cliState: 'needs-input',
      needsInputSince,
      lastEntryTs: scan.lastEntryTs,
      interrupted: scan.interrupted,
    })).toBe('idle');
    expect(shouldEmitSyntheticJsonlInterrupt({
      currentState: 'busy',
      interrupted: scan.interrupted,
      lastEntryTs: scan.lastEntryTs,
      lastInterruptTs: null,
      lastEventAt: needsInputSince,
    })).toBe(true);
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

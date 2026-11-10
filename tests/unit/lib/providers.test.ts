import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { normalizePanelType } from '@/lib/panel-type';
import { buildAgentSessionRelationship } from '@/lib/agent-session-relationship';
import { checkCodexJsonlState } from '@/lib/codex-jsonl-state';
import { getProviderByPanelType, getProviderByProcessName, listProviders } from '@/lib/providers';
import { codexProvider } from '@/lib/providers/codex';

const UUID = '12345678-1234-1234-1234-123456789abc';
const codexLine = (value: unknown): string => JSON.stringify(value);

const readProviderFixture = (name: string): Promise<string> =>
  fs.readFile(path.join(process.cwd(), 'tests/fixtures/providers/codex', name), 'utf-8');

const getCodexProvider = () => {
  const provider = getProviderByPanelType('codex');
  expect(provider).not.toBeNull();
  return provider!;
};

describe('agent providers', () => {
  it('registers only Codex as a runtime provider', () => {
    expect(listProviders().map((provider) => provider.id)).toEqual(['codex']);
  });

  it('maps only the Codex panel type to the Codex provider', () => {
    expect(getProviderByPanelType('codex')?.id).toBe('codex');
    expect(getProviderByPanelType('terminal')).toBeNull();
    expect(normalizePanelType('codex')).toBe('codex');
    expect(normalizePanelType('unknown-panel')).toBeUndefined();
  });

  it('resolves providers by process name', () => {
    expect(getProviderByProcessName('codex')?.id).toBe('codex');
    expect(getProviderByProcessName('bash')).toBeNull();
  });

  it('keeps provider contracts explicit for future providers', () => {
    for (const provider of listProviders()) {
      expect(provider.id).toMatch(/^[a-z0-9-]+$/);
      expect(provider.displayName.length).toBeGreaterThan(0);
      expect(provider.panelType).toBe(normalizePanelType(provider.panelType));
      expect(typeof provider.matchesProcess).toBe('function');
      expect(typeof provider.detectActiveSession).toBe('function');
      expect(typeof provider.isAgentRunning).toBe('function');
      expect(typeof provider.watchSessions).toBe('function');
      expect(typeof provider.buildResumeCommand).toBe('function');
      expect(typeof provider.buildLaunchCommand).toBe('function');
      expect(typeof provider.resolveJsonlPath).toBe('function');
      expect(typeof provider.parseJsonlContent).toBe('function');
      expect(typeof provider.readTailEntries).toBe('function');
      expect(typeof provider.readEntriesBefore).toBe('function');
      expect(typeof provider.parseIncremental).toBe('function');
      expect(typeof provider.readJsonlStatus).toBe('function');
      expect(typeof provider.readSessionId).toBe('function');
      expect(typeof provider.writeSessionId).toBe('function');
      expect(typeof provider.readJsonlPath).toBe('function');
      expect(typeof provider.writeJsonlPath).toBe('function');
      expect(typeof provider.readSummary).toBe('function');
      expect(typeof provider.writeSummary).toBe('function');
    }
  });

  it('keeps every Codex status behavior enabled', () => {
    expect(codexProvider.statusBehavior).toEqual({
      watchJsonlWhenBound: true,
      deferStopHookUntilJsonlIdle: true,
      reconcileStateFromJsonl: true,
      recoverPaneInput: true,
      bindSessionFromHook: false,
      leaveNeedsInputOnJsonlGrowth: false,
    });
  });

  it('reads Codex JSONL status with the same state and rate limits as checkCodexJsonlState', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmux-provider-status-'));
    const filePath = path.join(tempDir, 'session.jsonl');
    try {
      await fs.writeFile(filePath, [
        {
          type: 'event_msg',
          timestamp: '2026-04-28T00:59:00.000Z',
          payload: { type: 'task_started', turn_id: 'turn-1' },
        },
        {
          type: 'event_msg',
          timestamp: '2026-04-28T00:59:01.000Z',
          payload: { type: 'user_message', message: 'Finish' },
        },
        {
          type: 'event_msg',
          timestamp: '2026-04-28T00:59:30.000Z',
          payload: { type: 'agent_message', message: 'Intermediate note.' },
        },
        {
          type: 'event_msg',
          timestamp: '2026-04-28T00:59:40.000Z',
          payload: {
            type: 'token_count',
            rate_limits: {
              primary: { used_percent: 42, window_minutes: 300, resets_at: 1_800_000_000 },
              secondary: { used_percent: 9, window_minutes: 10_080, resets_at: 1_900_000_000 },
            },
          },
        },
        {
          type: 'event_msg',
          timestamp: '2026-04-28T00:59:45.000Z',
          payload: {
            type: 'task_complete',
            turn_id: 'turn-1',
            last_agent_message: 'Final answer.',
          },
        },
      ].map(codexLine).join('\n') + '\n');

      const expected = await checkCodexJsonlState(filePath);
      const status = await codexProvider.readJsonlStatus(filePath);

      expect(expected.idle).toBe(true);
      expect(expected.lastAssistantSnippet).toBe('Final answer.');
      expect(expected.rateLimits?.five_hour?.used_percentage).toBe(42);
      expect(status.idle).toBe(expected.idle);
      expect(status.lastAssistantSnippet).toBe(expected.lastAssistantSnippet);
      expect(status.rateLimits).toEqual(expected.rateLimits);
      expect(status).toEqual({
        idle: expected.idle,
        stale: expected.stale,
        lastAssistantSnippet: expected.lastAssistantSnippet,
        currentAction: expected.currentAction,
        reset: expected.reset,
        lastEntryTs: expected.lastEntryTs,
        staleMs: 0,
        interrupted: expected.interrupted,
        completionTurnId: expected.completionTurnId,
        rateLimits: expected.rateLimits,
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps provider-neutral relationship projection available for future providers', () => {
    const provider = getCodexProvider();

    expect(buildAgentSessionRelationship({
      providerId: provider.id,
      sessionId: UUID,
      parentSessionId: 'parent-session',
      rootSessionId: 'root-session',
      relationshipType: 'fork',
    })).toMatchObject({
      providerId: 'codex',
      sourceSessionId: UUID,
      parentSessionId: 'parent-session',
      rootSessionId: 'root-session',
      relationshipType: 'fork',
      relationshipConfidence: 'high',
    });
  });

  it('keeps Codex provider parsing and session id validation stable', () => {
    const provider = getCodexProvider();
    expect(provider?.isValidSessionId(UUID)).toBe(true);
    expect(provider?.isValidSessionId(`rollout-${UUID}`)).toBe(false);

    const content = [
      codexLine({
        type: 'event_msg',
        timestamp: '2026-04-29T10:00:00.000Z',
        payload: { type: 'user_message', message: '시작' },
      }),
      codexLine({
        type: 'event_msg',
        timestamp: '2026-04-29T10:00:01.000Z',
        payload: { type: 'agent_message', message: '완료' },
      }),
    ].join('\n');
    const first = provider!.parseJsonlContent(content);
    const second = provider!.parseJsonlContent(content);

    expect(first.map((entry) => entry.id)).toEqual(second.map((entry) => entry.id));
    expect(first).toHaveLength(2);
  });

  it('parses the Codex basic-turn fixture through the provider contract', async () => {
    const provider = getCodexProvider();
    const content = await readProviderFixture('basic-turn.jsonl');
    const entries = provider.parseJsonlContent(content);

    expect(entries.map((entry) => entry.type)).toEqual([
      'user-message',
      'thinking',
      'tool-call',
      'tool-result',
      'assistant-message',
    ]);
    expect(entries[0]).toMatchObject({
      type: 'user-message',
      text: 'Implement provider contract tests',
    });
    expect(entries[1]).toMatchObject({
      type: 'thinking',
      thinking: 'Need stable provider fixtures',
    });
    expect(entries[2]).toMatchObject({
      type: 'tool-call',
      toolUseId: 'call_provider_test',
      toolName: 'exec_command',
      status: 'success',
    });
    expect(entries[3]).toMatchObject({
      type: 'tool-result',
      toolUseId: 'call_provider_test',
      isError: false,
    });
    expect(entries[4]).toMatchObject({
      type: 'assistant-message',
      markdown: 'Provider contract tests are stable',
    });
    expect(provider.parseJsonlContent(content).map((entry) => entry.id)).toEqual(entries.map((entry) => entry.id));
  });

  it('dedupes paired assistant messages through the provider contract', async () => {
    const provider = getCodexProvider();
    const content = await readProviderFixture('paired-dedupe.jsonl');
    const entries = provider.parseJsonlContent(content);

    expect(entries.map((entry) => entry.type)).toEqual(['assistant-message', 'user-message']);
    expect(entries[0]).toMatchObject({
      type: 'assistant-message',
      markdown: 'Reading provider files',
    });
    expect(entries.filter((entry) => entry.type === 'assistant-message')).toHaveLength(1);
  });

  it('keeps session metadata from producing synthetic visible timeline entries', async () => {
    const provider = getCodexProvider();
    const content = await readProviderFixture('session-metadata.jsonl');
    const entries = provider.parseJsonlContent(content);

    expect(entries.map((entry) => entry.type)).toEqual(['user-message', 'assistant-message']);
    expect(entries[0]).toMatchObject({ type: 'user-message', text: 'Show status' });
    expect(entries[1]).toMatchObject({ type: 'assistant-message', markdown: 'Status is clean' });
    expect(JSON.stringify(entries)).not.toContain('AGENTS.md');
    expect(JSON.stringify(entries)).not.toContain('environment_context');
  });

  it('supports provider tail, read-before, and incremental fixture reads', async () => {
    const provider = getCodexProvider();
    const filePath = path.join(process.cwd(), 'tests/fixtures/providers/codex/basic-turn.jsonl');
    const fullContent = await fs.readFile(filePath, 'utf-8');
    const firstNewline = fullContent.indexOf('\n') + 1;

    const tail = await provider.readTailEntries(filePath, 2);
    expect(tail.entries.map((entry) => entry.type)).toEqual(['tool-result', 'assistant-message']);
    expect(tail.hasMore).toBe(true);
    expect(tail.fileSize).toBe(Buffer.byteLength(fullContent, 'utf-8'));

    const before = await provider.readEntriesBefore(filePath, tail.startByteOffset, 10);
    expect(before.entries.map((entry) => entry.type)).toEqual(['user-message', 'thinking', 'tool-call']);

    const incremental = await provider.parseIncremental(filePath, firstNewline);
    expect(incremental.newEntries.map((entry) => entry.type)).toEqual([
      'thinking',
      'tool-call',
      'tool-result',
      'assistant-message',
    ]);
    expect(incremental.newOffset).toBe(Buffer.byteLength(fullContent, 'utf-8'));
    expect(incremental.pendingBuffer).toBe('');
  });
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTimelineCatalogService } from '@/lib/runtime/timeline/catalog-service';
import type { IAgentProvider } from '@/lib/providers';
import { codexProvider } from '@/lib/providers/codex';

const content = [
  JSON.stringify({ type: 'session_meta', timestamp: '2026-08-21T08:00:00.000Z', payload: { id: 'session-runtime', cwd: '<fixture-root>/runtime' } }),
  JSON.stringify({ type: 'response_item', timestamp: '2026-08-21T08:00:01.000Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'runtime worker search' }] } }),
  '',
].join('\n');

describe('timeline catalog service', () => {
  let dir: string;
  let sessionsRoot: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-timeline-catalog-'));
    sessionsRoot = path.join(dir, 'sessions');
    await fs.mkdir(sessionsRoot, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('indexes observed Timeline files and replays by session id without returning its path', async () => {
    const jsonlPath = path.join(sessionsRoot, 'session.jsonl');
    await fs.writeFile(jsonlPath, content);
    const readEntriesBefore = vi.fn<IAgentProvider['readEntriesBefore']>(async () => ({
      entries: [],
      startByteOffset: 0,
      hasMore: false,
      fileSize: 0,
      errorCount: 0,
    }));
    const service = createTimelineCatalogService({
      mode: 'default',
      dbPath: path.join(dir, 'catalog', 'index.db'),
      roots: [{ root: sessionsRoot, provider: 'codex' }],
      getProvider: () => ({ ...codexProvider, readEntriesBefore }),
      now: () => '2026-08-21T09:00:00.000Z',
    });

    await service.observeFile(jsonlPath);
    expect(service.search({ query: 'runtime', limit: 50 })).toMatchObject({
      results: [{ entry: { sessionId: 'session-runtime' }, snippet: 'runtime worker search' }],
      health: 'ready',
    });
    const replay = await service.readEntries({
      sessionId: 'session-runtime',
      beforeByte: Buffer.byteLength(content),
      limit: 50,
      panelType: 'codex',
    });

    expect(replay).toEqual({ entries: [], startByteOffset: 0, hasMore: false });
    expect(JSON.stringify(replay)).not.toContain(jsonlPath);
    expect(readEntriesBefore).toHaveBeenCalledWith(jsonlPath, Buffer.byteLength(content), 50);
    expect(service.health()).toMatchObject({ state: 'ready', indexedSessions: 1 });
    service.close();
  });

  it('indexes a bounded rebuild without creating a second watcher', async () => {
    await fs.writeFile(path.join(sessionsRoot, 'first.jsonl'), content);
    await fs.mkdir(path.join(sessionsRoot, 'nested'));
    await fs.writeFile(path.join(sessionsRoot, 'nested', 'second.jsonl'), content.replaceAll('session-runtime', 'session-second'));
    const service = createTimelineCatalogService({
      mode: 'default',
      dbPath: path.join(dir, 'catalog', 'index.db'),
      roots: [{ root: sessionsRoot, provider: 'codex' }],
      getProvider: () => codexProvider,
      now: () => '2026-08-21T09:00:00.000Z',
    });

    await expect(service.rebuild()).resolves.toEqual({ started: true, state: 'building' });
    await service.waitForIdle();

    expect(service.health()).toMatchObject({ state: 'ready', indexedSessions: 2, rebuildState: 'idle' });
    service.close();
  });

  it('builds shadow projections but refuses API search ownership', async () => {
    const service = createTimelineCatalogService({
      mode: 'shadow',
      dbPath: path.join(dir, 'catalog', 'index.db'),
      roots: [{ root: sessionsRoot, provider: 'codex' }],
      getProvider: () => codexProvider,
    });

    expect(() => service.search({ query: 'runtime' })).toThrow(expect.objectContaining({
      code: 'catalog-shadow-only',
      retryable: false,
    }));
    service.close();
  });

  it('rejects observed paths outside every catalog root', async () => {
    const outside = path.join(dir, 'outside.jsonl');
    await fs.writeFile(outside, content);
    const service = createTimelineCatalogService({
      mode: 'default',
      dbPath: path.join(dir, 'catalog', 'index.db'),
      roots: [{ root: sessionsRoot, provider: 'codex' }],
      getProvider: () => codexProvider,
    });

    await expect(service.observeFile(outside)).rejects.toMatchObject({ code: 'catalog-path-forbidden' });
    service.close();
  });

  describe('with a Claude projects root', () => {
    const CLAUDE_ID = '11111111-2222-4333-8444-555555555555';
    const claudeLine = (record: Record<string, unknown>) => JSON.stringify({
      sessionId: CLAUDE_ID,
      cwd: '<fixture-root>/claude-demo',
      ...record,
    });
    const claudeContent = [
      claudeLine({ type: 'user', timestamp: '2026-08-21T08:00:00.000Z', message: { role: 'user', content: 'claude catalog needle' } }),
      claudeLine({ type: 'assistant', timestamp: '2026-08-21T08:00:01.000Z', message: { role: 'assistant', model: 'claude-synthetic-1', content: [{ type: 'text', text: 'ack' }] } }),
      '',
    ].join('\n');
    let claudeRoot: string;

    beforeEach(async () => {
      claudeRoot = path.join(dir, 'claude-projects');
      await fs.mkdir(path.join(claudeRoot, '-fixture-demo'), { recursive: true });
    });

    const createService = (getProvider: (panelType: string) => IAgentProvider = () => codexProvider) => createTimelineCatalogService({
      mode: 'default',
      dbPath: path.join(dir, 'catalog', 'index.db'),
      roots: [
        { root: sessionsRoot, provider: 'codex' },
        { root: claudeRoot, provider: 'claude' },
      ],
      getProvider,
      now: () => '2026-08-21T09:00:00.000Z',
    });

    it('indexes an observed Claude transcript with provider claude', async () => {
      const file = path.join(claudeRoot, '-fixture-demo', `${CLAUDE_ID}.jsonl`);
      await fs.writeFile(file, claudeContent);
      const service = createService();

      await service.observeFile(file);

      expect(service.search({ query: 'needle', providers: ['claude'] })).toMatchObject({
        results: [{ entry: { sessionId: CLAUDE_ID, provider: 'claude', projectLabel: 'claude-demo', model: 'claude-synthetic-1' } }],
      });
      expect(service.search({ query: 'needle', providers: ['codex'] }).results).toEqual([]);
      service.close();
    });

    it('rebuilds both roots and excludes Claude subagent transcripts', async () => {
      await fs.writeFile(path.join(sessionsRoot, 'codex.jsonl'), content);
      await fs.writeFile(path.join(claudeRoot, '-fixture-demo', `${CLAUDE_ID}.jsonl`), claudeContent);
      const subagentDir = path.join(claudeRoot, '-fixture-demo', CLAUDE_ID, 'subagents');
      await fs.mkdir(subagentDir, { recursive: true });
      await fs.writeFile(path.join(subagentDir, 'agent-abc.jsonl'), claudeContent.replaceAll(CLAUDE_ID, '99999999-2222-4333-8444-555555555555'));
      await fs.writeFile(path.join(claudeRoot, '-fixture-demo', 'agent-top.jsonl'), claudeContent);
      const service = createService();

      await service.rebuild();
      await service.waitForIdle();

      expect(service.health()).toMatchObject({ state: 'ready', indexedSessions: 2 });
      service.close();
    });

    it('rejects Claude subagent paths and paths outside every root', async () => {
      const subagent = path.join(claudeRoot, '-fixture-demo', CLAUDE_ID, 'subagents', 'agent-abc.jsonl');
      await fs.mkdir(path.dirname(subagent), { recursive: true });
      await fs.writeFile(subagent, claudeContent);
      const outside = path.join(dir, 'outside.jsonl');
      await fs.writeFile(outside, claudeContent);
      const service = createService();

      await expect(service.observeFile(subagent)).rejects.toMatchObject({ code: 'catalog-path-forbidden' });
      await expect(service.observeFile(outside)).rejects.toMatchObject({ code: 'catalog-path-forbidden' });
      expect(service.health().state).toBe('ready');
      service.close();
    });

    it('uses the stored provider for readEntries, ignoring the caller panelType', async () => {
      const file = path.join(claudeRoot, '-fixture-demo', `${CLAUDE_ID}.jsonl`);
      await fs.writeFile(file, claudeContent);
      const getProvider = vi.fn((panelType: string) => ({ ...codexProvider, id: panelType } as unknown as IAgentProvider));
      const service = createService(getProvider);
      await service.observeFile(file);

      await service.readEntries({ sessionId: CLAUDE_ID, beforeByte: 10, limit: 5, panelType: 'codex' }).catch(() => undefined);

      expect(getProvider).toHaveBeenCalledWith('claude');
      service.close();
    });

    it('treats a missing Claude root as empty and keeps the catalog ready', async () => {
      await fs.rm(claudeRoot, { recursive: true, force: true });
      const codexFile = path.join(sessionsRoot, 'codex.jsonl');
      await fs.writeFile(codexFile, content);
      const service = createService();

      await service.observeFile(codexFile);
      await service.rebuild();
      await service.waitForIdle();

      expect(service.health().state).toBe('ready');
      expect(service.search({ query: 'runtime' }).results).toHaveLength(1);
      service.close();
    });
  });
});

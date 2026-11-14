import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readAgentJsonlPath,
  readAgentSessionId,
  readAgentSummary,
  writeAgentJsonlPath,
  writeAgentSessionId,
  writeAgentSummary,
} from '@/lib/agent-tab-fields';
import type { IAgentProvider } from '@/lib/providers/types';

vi.mock('@/lib/tmux', () => ({
  createSession: vi.fn(),
  hasSession: vi.fn(async () => false),
  killSession: vi.fn(),
  resolveExistingDir: vi.fn(async (cwd?: string) => cwd ?? '/home/test'),
  sendKeys: vi.fn(),
  workspaceSessionName: (wsId: string, paneId: string, tabId: string) => `pt-${wsId}-${paneId}-${tabId}`,
}));
vi.mock('@/lib/runtime/supervisor', () => ({ getRuntimeSupervisor: vi.fn() }));
vi.mock('@/lib/sync-server', () => ({ broadcastSync: vi.fn() }));

const provider = {
  readSessionId: readAgentSessionId,
  writeSessionId: writeAgentSessionId,
  readJsonlPath: readAgentJsonlPath,
  writeJsonlPath: writeAgentJsonlPath,
  readSummary: readAgentSummary,
  writeSummary: writeAgentSummary,
} as unknown as IAgentProvider;

const wsId = 'ws-agent-session';
const paneId = 'pane-a';
const sessionName = `pt-${wsId}-${paneId}-tab-claude`;
let dataDir: string;

describe('updateTabAgentSession', () => {
  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmux-layout-agent-session-'));
    vi.stubEnv('AGENTMUX_DATA_DIR', dataDir);
    vi.resetModules();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    // layout-store can still be finishing a background write into dataDir; retry like layout-store-add-tab.test.ts.
    await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('writes the new session id and clears the previous JSONL path in one layout write', async () => {
    const store = await import('@/lib/layout-store');
    expect(store.resolveLayoutFile(wsId).startsWith(dataDir)).toBe(true);
    await fs.mkdir(store.resolveLayoutDir(wsId), { recursive: true });
    await store.writeLayoutFile({
      root: {
        type: 'pane',
        id: paneId,
        activeTabId: 'tab-claude',
        tabs: [{
          id: 'tab-claude',
          sessionName,
          name: '',
          order: 0,
          runtimeVersion: 1,
          panelType: 'claude',
          agentSessionId: 'session-a',
          agentJsonlPath: '/home/test/.claude/projects/x/session-a.jsonl',
        }],
      },
      activePaneId: paneId,
      updatedAt: new Date(0).toISOString(),
    }, store.resolveLayoutFile(wsId));

    await store.updateTabAgentSession(sessionName, provider, { sessionId: 'session-b', jsonlPath: null });

    const layout = await store.readLayoutFile(store.resolveLayoutFile(wsId));
    const tab = layout?.root.type === 'pane' ? layout.root.tabs[0] : null;
    expect(tab).toMatchObject({ agentSessionId: 'session-b', agentJsonlPath: null });
    expect(layout?.updatedAt).not.toBe(new Date(0).toISOString());
  });
});

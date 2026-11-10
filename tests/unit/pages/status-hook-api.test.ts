import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const PROVIDER_ROOTS: Record<string, string[]> = {
  codex: ['/home/test/.codex/sessions'],
  claude: ['/home/test/.claude/projects'],
};

const mocks = vi.hoisted(() => ({
  updateTabFromHook: vi.fn(),
  isValidSessionId: vi.fn((id: unknown) => typeof id === 'string' && id.startsWith('sid-')),
  tabPanelType: 'codex' as string,
}));

vi.mock('@/lib/cli-token', () => ({ verifyCliToken: () => true }));
vi.mock('@/lib/status-manager', () => ({
  getStatusManager: () => ({ updateTabFromHook: mocks.updateTabFromHook }),
}));
vi.mock('@/lib/runtime/status-mode', () => ({ getRuntimeStatusV2Mode: () => 'off' }));
vi.mock('@/lib/runtime/supervisor', () => ({ getRuntimeSupervisor: vi.fn() }));
vi.mock('@/lib/agent-hooks', () => ({
  verifyAgentHookCapability: () => ({ tabId: 'tab-a' }),
}));
vi.mock('@/lib/layout-store', () => ({
  parseSessionName: () => ({ wsId: 'ws-a', paneId: 'pane-a', tabId: 'tab-a' }),
  resolveLayoutFile: () => '/tmp/layout.json',
  readLayoutFile: async () => ({
    root: {
      type: 'pane',
      id: 'pane-a',
      tabs: [{ id: 'tab-a', sessionName: 'pt-ws-a-pane-a-tab-a', panelType: mocks.tabPanelType }],
    },
  }),
}));
vi.mock('@/lib/layout-tree', () => ({
  findPane: (root: unknown) => root,
}));
vi.mock('@/lib/providers', () => ({
  getProviderByPanelType: (panelType: string) => (PROVIDER_ROOTS[panelType]
    ? { isValidSessionId: mocks.isValidSessionId, jsonlRoots: () => PROVIDER_ROOTS[panelType] }
    : null),
}));
vi.mock('@/lib/perf-metrics', () => ({ recordPerfCounter: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import handler from '@/pages/api/status/hook';

const post = async (body: Record<string, unknown>) => {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
    end: vi.fn(() => res),
    setHeader: vi.fn(),
  } as unknown as NextApiResponse;
  await handler({ method: 'POST', body, headers: {} } as unknown as NextApiRequest, res);
  return res;
};

const base = { event: 'session-start', session: 'pt-ws-a-pane-a-tab-a', capability: 'cap' };

describe('status hook api', () => {
  beforeEach(() => {
    mocks.updateTabFromHook.mockReset();
    mocks.tabPanelType = 'claude';
  });

  it('forwards validated agent fields to the status manager', async () => {
    await post({
      ...base,
      notificationType: 'permission_prompt',
      agentSessionId: 'sid-1',
      transcriptPath: '/home/test/.claude/projects/x/sid-1.jsonl',
      source: 'clear',
    });

    expect(mocks.updateTabFromHook).toHaveBeenCalledWith('pt-ws-a-pane-a-tab-a', 'session-start', {
      notificationType: 'permission_prompt',
      agentSessionId: 'sid-1',
      transcriptPath: '/home/test/.claude/projects/x/sid-1.jsonl',
      source: 'clear',
    });
  });

  it('drops fields that fail validation and still processes the event', async () => {
    await post({
      ...base,
      agentSessionId: 'bad id',
      transcriptPath: '/etc/passwd.jsonl',
      source: 'bogus',
      notificationType: 'Not Valid',
    });

    expect(mocks.updateTabFromHook).toHaveBeenCalledWith('pt-ws-a-pane-a-tab-a', 'session-start', {});
  });

  it('drops a transcript path outside the tab provider roots and still processes the event', async () => {
    await post({
      ...base,
      agentSessionId: 'sid-1',
      transcriptPath: '/home/test/.codex/sessions/2026/11/10/rollout-x.jsonl',
    });

    expect(mocks.updateTabFromHook).toHaveBeenCalledWith('pt-ws-a-pane-a-tab-a', 'session-start', {
      agentSessionId: 'sid-1',
    });
  });

  it('drops the transcript path when the tab has no agent provider', async () => {
    mocks.tabPanelType = 'terminal';
    await post({
      ...base,
      transcriptPath: '/home/test/.claude/projects/x/sid-1.jsonl',
    });

    expect(mocks.updateTabFromHook).toHaveBeenCalledWith('pt-ws-a-pane-a-tab-a', 'session-start', {});
  });

  it('keeps a transcript path under the tab provider roots', async () => {
    mocks.tabPanelType = 'codex';
    await post({
      ...base,
      transcriptPath: '/home/test/.codex/sessions/2026/11/10/rollout-x.jsonl',
    });

    expect(mocks.updateTabFromHook).toHaveBeenCalledWith('pt-ws-a-pane-a-tab-a', 'session-start', {
      transcriptPath: '/home/test/.codex/sessions/2026/11/10/rollout-x.jsonl',
    });
  });
});

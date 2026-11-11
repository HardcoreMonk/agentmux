import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILayoutData, ITab } from '@/types/terminal';

const mocks = vi.hoisted(() => ({
  verifyCliToken: vi.fn(),
  getLayout: vi.fn(),
  getWorkspaces: vi.fn(),
  getWorkspaceById: vi.fn(),
  closeWorkspaceTab: vi.fn(),
}));

vi.mock('@/lib/cli-token', () => ({ verifyCliToken: mocks.verifyCliToken }));
vi.mock('@/lib/layout-store', () => ({ getLayout: mocks.getLayout }));
vi.mock('@/lib/workspace-store', () => ({
  getWorkspaces: mocks.getWorkspaces,
  getWorkspaceById: mocks.getWorkspaceById,
}));
vi.mock('@/lib/tmux', () => ({}));
vi.mock('@/lib/providers', () => ({ getProviderByPanelType: vi.fn() }));
vi.mock('@/lib/status-manager', () => ({ getStatusManager: vi.fn() }));
vi.mock('@/lib/runtime/supervisor', () => ({ getRuntimeSupervisor: vi.fn() }));
vi.mock('@/lib/agent-launch-service', () => ({ launchAgentInTab: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock('@/lib/workspace-tab-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/workspace-tab-service')>()),
  closeWorkspaceTab: mocks.closeWorkspaceTab,
}));

import handler from '@/pages/api/cli/tabs/[tabId]';

const WORKSPACES = [
  { id: 'ws-a', name: 'A', directories: ['/repo/a'] },
  { id: 'ws-b', name: 'B', directories: ['/repo/b'] },
];

const makeTab = (id: string, extra: Partial<ITab> = {}): ITab => ({
  id,
  sessionName: `pt-${id}`,
  name: id,
  order: 0,
  ...extra,
});

const LAYOUTS: Record<string, ILayoutData> = {
  'ws-a': {
    root: {
      type: 'pane',
      id: 'pane-a',
      tabs: [
        makeTab('tab-caller', { panelType: 'claude' }),
        makeTab('tab-user', { panelType: 'terminal' }),
        makeTab('tab-mine', { panelType: 'codex', createdByTabId: 'tab-caller' }),
        makeTab('tab-theirs', { panelType: 'codex', createdByTabId: 'tab-other' }),
        makeTab('tab-other', { panelType: 'claude' }),
      ],
      activeTabId: 'tab-caller',
    },
    activePaneId: 'pane-a',
    updatedAt: '2026-11-11T00:00:00.000Z',
  },
  'ws-b': {
    root: {
      type: 'pane',
      id: 'pane-b',
      tabs: [makeTab('tab-b-mine', { createdByTabId: 'tab-caller' })],
      activeTabId: 'tab-b-mine',
    },
    activePaneId: 'pane-b',
    updatedAt: '2026-11-11T00:00:00.000Z',
  },
};

const createResponse = () => {
  let statusCode = 0;
  let body: unknown;
  const res = {
    setHeader: vi.fn(() => res),
    status: vi.fn((code: number) => {
      statusCode = code;
      return res;
    }),
    json: vi.fn((value: unknown) => {
      body = value;
      return res;
    }),
  } as unknown as NextApiResponse;
  return {
    res,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body as Record<string, unknown>;
    },
  };
};

const callClose = async (workspaceId: string, tabId: string, callerTabId?: string) => {
  const response = createResponse();
  const req = {
    method: 'DELETE',
    query: { tabId, workspaceId },
    headers: callerTabId ? { 'x-agentmux-caller-tab': callerTabId } : {},
  } as unknown as NextApiRequest;
  await handler(req, response.res);
  return response;
};

beforeEach(() => {
  mocks.verifyCliToken.mockReturnValue(true);
  mocks.getLayout.mockImplementation(async (id: string) => LAYOUTS[id]);
  mocks.getWorkspaces.mockResolvedValue({ workspaces: WORKSPACES, activeWorkspaceId: 'ws-a' });
  mocks.getWorkspaceById.mockImplementation(async (id: string) => WORKSPACES.find((ws) => ws.id === id) ?? null);
  mocks.closeWorkspaceTab.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('DELETE /api/cli/tabs/<id> with a caller tab', () => {
  it('closes a tab the caller created', async () => {
    const response = await callClose('ws-a', 'tab-mine', 'tab-caller');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(mocks.closeWorkspaceTab).toHaveBeenCalledWith('ws-a', 'pane-a', 'tab-mine');
  });

  it('closes a tab the caller created in another workspace', async () => {
    const response = await callClose('ws-b', 'tab-b-mine', 'tab-caller');

    expect(response.statusCode).toBe(200);
    expect(mocks.closeWorkspaceTab).toHaveBeenCalledWith('ws-b', 'pane-b', 'tab-b-mine');
  });

  it.each([
    ['a user tab', 'tab-user'],
    ['a tab another agent created', 'tab-theirs'],
    ['the caller itself', 'tab-caller'],
  ])('refuses to close %s with delegation-close-forbidden', async (_label, tabId) => {
    const response = await callClose('ws-a', tabId, 'tab-caller');

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({ error: 'delegation-close-forbidden', message: expect.any(String) });
    expect(mocks.closeWorkspaceTab).not.toHaveBeenCalled();
  });

  it('returns caller-tab-not-found for an unknown caller tab', async () => {
    const response = await callClose('ws-a', 'tab-mine', 'tab-gone');

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ error: 'caller-tab-not-found', message: expect.any(String) });
    expect(mocks.closeWorkspaceTab).not.toHaveBeenCalled();
  });

  it('keeps Tab not found for an unknown target', async () => {
    const response = await callClose('ws-a', 'tab-missing', 'tab-caller');

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ error: 'Tab not found' });
  });
});

describe('DELETE /api/cli/tabs/<id> without a caller tab', () => {
  it.each(['tab-user', 'tab-theirs', 'tab-caller'])('closes %s', async (tabId) => {
    const response = await callClose('ws-a', tabId);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(mocks.closeWorkspaceTab).toHaveBeenCalledWith('ws-a', 'pane-a', tabId);
  });

  it('keeps the existing errors', async () => {
    const missingWorkspace = await callClose('', 'tab-user');
    expect(missingWorkspace.statusCode).toBe(400);
    expect(missingWorkspace.body).toEqual({ error: 'workspaceId is required' });

    const missingTab = await callClose('ws-a', 'tab-missing');
    expect(missingTab.statusCode).toBe(404);
    expect(missingTab.body).toEqual({ error: 'Tab not found' });
  });
});

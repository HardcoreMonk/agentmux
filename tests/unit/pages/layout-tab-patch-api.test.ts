import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  patchTab: vi.fn(),
  getLayout: vi.fn(),
}));

vi.mock('@/lib/layout-store', () => ({
  removeTabFromPane: vi.fn(),
  restartTabSession: vi.fn(),
  patchTab: mocks.patchTab,
  getLayout: mocks.getLayout,
}));
vi.mock('@/lib/workspace-store', () => ({ getActiveWorkspaceId: vi.fn() }));
vi.mock('@/lib/status-manager', () => ({ getStatusManager: vi.fn() }));
vi.mock('@/lib/runtime/supervisor', () => ({ getRuntimeSupervisor: vi.fn() }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ error: vi.fn(), warn: vi.fn() }) }));

import handler from '@/pages/api/layout/pane/[paneId]/tabs/[tabId]';

const createResponse = () => {
  let statusCode = 0;
  let body: unknown;
  const res = {
    setHeader: vi.fn(),
    status: vi.fn((code: number) => { statusCode = code; return res; }),
    json: vi.fn((value: unknown) => { body = value; return res; }),
  } as unknown as NextApiResponse;
  return { res, get statusCode() { return statusCode; }, get body() { return body; } };
};

const createRequest = (body: unknown): NextApiRequest => ({
  method: 'PATCH',
  query: { workspace: 'ws-a', paneId: 'pane-a', tabId: 'tab-a' },
  body,
  headers: {},
}) as unknown as NextApiRequest;

const layoutWith = (runtimeVersion: 1 | 2) => ({
  root: {
    type: 'pane',
    id: 'pane-a',
    activeTabId: 'tab-a',
    tabs: [{ id: 'tab-a', sessionName: 's', name: '', order: 0, panelType: 'terminal', runtimeVersion }],
  },
  activePaneId: 'pane-a',
  updatedAt: '',
});

describe('layout tab PATCH panelType', () => {
  beforeEach(() => {
    mocks.patchTab.mockReset();
    mocks.getLayout.mockReset();
    mocks.patchTab.mockResolvedValue({ ok: true });
  });

  it('returns 409 for an agent panel on a runtime v2 tab without writing', async () => {
    mocks.getLayout.mockResolvedValue(layoutWith(2));
    const response = createResponse();
    await handler(createRequest({ panelType: 'codex' }), response.res);
    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      error: 'Agent panels are not supported on runtime v2 terminal tabs',
      code: 'runtime-v2-agent-unsupported',
    });
    expect(mocks.patchTab).not.toHaveBeenCalled();
  });

  it('allows an agent panel on a runtime v1 tab', async () => {
    mocks.getLayout.mockResolvedValue(layoutWith(1));
    const response = createResponse();
    await handler(createRequest({ panelType: 'codex' }), response.res);
    expect(response.statusCode).toBe(200);
    expect(mocks.patchTab).toHaveBeenCalledWith('ws-a', 'pane-a', 'tab-a', { panelType: 'codex' });
  });

  it('allows non-agent panels on a runtime v2 tab', async () => {
    mocks.getLayout.mockResolvedValue(layoutWith(2));
    const response = createResponse();
    await handler(createRequest({ panelType: 'diff' }), response.res);
    expect(response.statusCode).toBe(200);
    expect(mocks.patchTab).toHaveBeenCalledWith('ws-a', 'pane-a', 'tab-a', { panelType: 'diff' });
  });

  it('rejects unknown panel types', async () => {
    const response = createResponse();
    await handler(createRequest({ panelType: 'foo' }), response.res);
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: 'Unknown panel type' });
    expect(mocks.patchTab).not.toHaveBeenCalled();
  });
});

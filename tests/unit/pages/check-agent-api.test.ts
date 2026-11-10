import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasSession: vi.fn(),
  getSessionPanePid: vi.fn(),
  getChildPids: vi.fn(),
  isAnyAgentRunning: vi.fn(),
  detectAnyActiveSession: vi.fn(),
}));

vi.mock('@/lib/tmux', () => ({
  hasSession: mocks.hasSession,
  getSessionPanePid: mocks.getSessionPanePid,
}));
vi.mock('@/lib/session-detection', () => ({ getChildPids: mocks.getChildPids }));
vi.mock('@/lib/providers', () => ({
  isAnyAgentRunning: mocks.isAnyAgentRunning,
  detectAnyActiveSession: mocks.detectAnyActiveSession,
}));

import handler from '@/pages/api/check-agent';

const call = async () => {
  let body: unknown;
  const res = {
    setHeader: vi.fn(),
    status: vi.fn(() => res),
    json: vi.fn((v: unknown) => { body = v; return res; }),
  } as unknown as NextApiResponse;
  await handler({ method: 'GET', query: { session: 's1' } } as unknown as NextApiRequest, res);
  return body as Record<string, unknown>;
};

describe('GET /api/check-agent providerPanelType', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasSession.mockResolvedValue(true);
    mocks.getSessionPanePid.mockResolvedValue(100);
    mocks.getChildPids.mockResolvedValue([101]);
  });

  it('reports the detected Claude provider', async () => {
    mocks.isAnyAgentRunning.mockResolvedValue(true);
    mocks.detectAnyActiveSession.mockResolvedValue({
      provider: { id: 'claude' },
      info: { sessionId: 'sid', jsonlPath: '/x.jsonl' },
    });
    expect(await call()).toMatchObject({ running: true, providerPanelType: 'claude', sessionId: 'sid' });
  });

  it('reports null when no agent is running', async () => {
    mocks.isAnyAgentRunning.mockResolvedValue(false);
    expect(await call()).toMatchObject({ running: false, providerPanelType: null });
  });

  it('reports null when the session is missing', async () => {
    mocks.hasSession.mockResolvedValue(false);
    expect(await call()).toMatchObject({ running: false, providerPanelType: null });
  });
});

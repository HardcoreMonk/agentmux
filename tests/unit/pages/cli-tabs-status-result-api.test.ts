import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILayoutData, ITab } from '@/types/terminal';

const mocks = vi.hoisted(() => {
  const supervisor = {
    hasTerminalSession: vi.fn(),
    captureTerminalSession: vi.fn(),
  };
  return {
    verifyCliToken: vi.fn(),
    getLayout: vi.fn(),
    getWorkspaces: vi.fn(),
    getWorkspaceById: vi.fn(),
    getPaneCurrentCommand: vi.fn(),
    capturePaneContent: vi.fn(),
    hasSession: vi.fn(),
    getProviderByPanelType: vi.fn(),
    isTabSessionAlive: vi.fn(),
    readTabCliState: vi.fn(),
    readTabScreen: vi.fn(),
    readLastAssistantMessage: vi.fn(),
    supervisor,
    getRuntimeSupervisor: vi.fn(() => supervisor),
  };
});

vi.mock('@/lib/cli-token', () => ({ verifyCliToken: mocks.verifyCliToken }));
vi.mock('@/lib/layout-store', () => ({ getLayout: mocks.getLayout }));
vi.mock('@/lib/workspace-store', () => ({
  getWorkspaces: mocks.getWorkspaces,
  getWorkspaceById: mocks.getWorkspaceById,
}));
vi.mock('@/lib/tmux', () => ({
  getPaneCurrentCommand: mocks.getPaneCurrentCommand,
  capturePaneContent: mocks.capturePaneContent,
  hasSession: mocks.hasSession,
}));
vi.mock('@/lib/providers', () => ({ getProviderByPanelType: mocks.getProviderByPanelType }));
vi.mock('@/lib/status-manager', () => ({ getStatusManager: vi.fn() }));
vi.mock('@/lib/runtime/supervisor', () => ({ getRuntimeSupervisor: mocks.getRuntimeSupervisor }));
vi.mock('@/lib/agent-launch-service', () => ({ launchAgentInTab: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock('@/lib/workspace-tab-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/workspace-tab-service')>()),
  isTabSessionAlive: mocks.isTabSessionAlive,
  readTabCliState: mocks.readTabCliState,
  readTabScreen: mocks.readTabScreen,
  readLastAssistantMessage: mocks.readLastAssistantMessage,
}));

import statusHandler from '@/pages/api/cli/tabs/[tabId]/status';
import resultHandler from '@/pages/api/cli/tabs/[tabId]/result';

const actualService = await vi.importActual<typeof import('@/lib/workspace-tab-service')>(
  '@/lib/workspace-tab-service',
);

const makeTab = (id: string, extra: Partial<ITab> = {}): ITab => ({
  id,
  sessionName: `pt-${id}`,
  name: id,
  order: 0,
  ...extra,
});

const TABS: ITab[] = [
  makeTab('tab-claude', {
    panelType: 'claude',
    runtimeVersion: 1,
    agentSessionId: '11111111-2222-4333-8444-555555555555',
    createdByTabId: 'tab-caller',
  }),
  makeTab('tab-term-v1', { panelType: 'terminal', runtimeVersion: 1 }),
  makeTab('tab-term-v2', { sessionName: 'rtv2-ws-a-pane-a-tab-term-v2', panelType: 'terminal', runtimeVersion: 2 }),
];

const LAYOUT: ILayoutData = {
  root: { type: 'pane', id: 'pane-a', tabs: TABS, activeTabId: 'tab-claude' },
  activePaneId: 'pane-a',
  updatedAt: '2026-11-11T00:00:00.000Z',
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

const call = async (handler: typeof statusHandler, tabId: string) => {
  const response = createResponse();
  const req = {
    method: 'GET',
    query: { tabId, workspaceId: 'ws-a' },
    headers: {},
  } as unknown as NextApiRequest;
  await handler(req, response.res);
  return response;
};

const useActualRuntimeReads = () => {
  mocks.isTabSessionAlive.mockImplementation(actualService.isTabSessionAlive);
  mocks.readTabScreen.mockImplementation(actualService.readTabScreen);
};

beforeEach(() => {
  vi.stubEnv('AGENTMUX_RUNTIME_V2', '1');
  mocks.verifyCliToken.mockReturnValue(true);
  mocks.getLayout.mockResolvedValue(LAYOUT);
  mocks.getWorkspaceById.mockImplementation(async (id: string) =>
    id === 'ws-a' ? { id: 'ws-a', name: 'A', directories: ['/repo'] } : null);
  mocks.getProviderByPanelType.mockImplementation((panelType: string) =>
    panelType === 'claude' || panelType === 'codex' ? { id: panelType } : null);
  mocks.isTabSessionAlive.mockResolvedValue(true);
  mocks.readTabCliState.mockResolvedValue('ready-for-review');
  mocks.getPaneCurrentCommand.mockResolvedValue('claude');
  mocks.readTabScreen.mockResolvedValue('screen text');
  mocks.readLastAssistantMessage.mockResolvedValue({ text: 'Done. Tests pass.', timestamp: 1_762_000_000_000 });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('GET /api/cli/tabs/<id>/status', () => {
  it('returns every field for an agent tab', async () => {
    const response = await call(statusHandler, 'tab-claude');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      tabId: 'tab-claude',
      workspaceId: 'ws-a',
      panelType: 'claude',
      providerId: 'claude',
      alive: true,
      command: 'claude',
      cliState: 'ready-for-review',
      agentSessionId: '11111111-2222-4333-8444-555555555555',
      createdByTabId: 'tab-caller',
    });
    expect(mocks.getPaneCurrentCommand).toHaveBeenCalledWith('pt-tab-claude');
  });

  it('returns a null provider and creator for a user terminal tab', async () => {
    mocks.readTabCliState.mockResolvedValue(null);
    mocks.getPaneCurrentCommand.mockResolvedValue('zsh');

    const response = await call(statusHandler, 'tab-term-v1');

    expect(response.body).toEqual({
      tabId: 'tab-term-v1',
      workspaceId: 'ws-a',
      panelType: 'terminal',
      providerId: null,
      alive: true,
      command: 'zsh',
      cliState: null,
      agentSessionId: null,
      createdByTabId: null,
    });
  });

  it('returns a null command for a Runtime v2 tab and asks the supervisor whether it is alive', async () => {
    useActualRuntimeReads();
    mocks.supervisor.hasTerminalSession.mockResolvedValue(true);
    mocks.readTabCliState.mockResolvedValue(null);

    const response = await call(statusHandler, 'tab-term-v2');

    expect(response.body).toMatchObject({ tabId: 'tab-term-v2', alive: true, command: null, providerId: null });
    expect(mocks.supervisor.hasTerminalSession).toHaveBeenCalledWith({ sessionName: 'rtv2-ws-a-pane-a-tab-term-v2' });
    expect(mocks.getPaneCurrentCommand).not.toHaveBeenCalled();
  });

  it('reports alive: false for a dead session', async () => {
    mocks.isTabSessionAlive.mockResolvedValue(false);

    const response = await call(statusHandler, 'tab-claude');

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ tabId: 'tab-claude', alive: false, command: null });
    expect(mocks.getPaneCurrentCommand).not.toHaveBeenCalled();
  });

  it('treats a Runtime v2 tab as dead without calling the supervisor when Runtime v2 is off', async () => {
    vi.stubEnv('AGENTMUX_RUNTIME_V2', undefined);
    useActualRuntimeReads();

    const response = await call(statusHandler, 'tab-term-v2');

    expect(response.body).toMatchObject({ alive: false, command: null });
    expect(mocks.getRuntimeSupervisor).not.toHaveBeenCalled();
  });

  it('keeps Tab not found', async () => {
    const response = await call(statusHandler, 'tab-missing');

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ error: 'Tab not found' });
  });
});

describe('GET /api/cli/tabs/<id>/result', () => {
  it('returns the state, last assistant reply, and screen for an agent tab', async () => {
    const response = await call(resultHandler, 'tab-claude');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      tabId: 'tab-claude',
      panelType: 'claude',
      cliState: 'ready-for-review',
      lastAssistantMessage: { text: 'Done. Tests pass.', timestamp: 1_762_000_000_000 },
      content: 'screen text',
    });
  });

  it('returns null reply and screen when neither is available', async () => {
    mocks.readLastAssistantMessage.mockResolvedValue(null);
    mocks.readTabScreen.mockResolvedValue(null);

    const response = await call(resultHandler, 'tab-claude');

    expect(response.body).toMatchObject({ lastAssistantMessage: null, content: null });
  });

  it('returns only the screen for a v1 terminal tab', async () => {
    useActualRuntimeReads();
    mocks.hasSession.mockResolvedValue(true);
    mocks.capturePaneContent.mockResolvedValue('$ ls\nREADME.md\n');

    const response = await call(resultHandler, 'tab-term-v1');

    expect(response.body).toEqual({ content: '$ ls\nREADME.md\n' });
    expect(mocks.capturePaneContent).toHaveBeenCalledWith('pt-tab-term-v1');
  });

  it('captures a Runtime v2 terminal tab through the supervisor', async () => {
    useActualRuntimeReads();
    mocks.supervisor.hasTerminalSession.mockResolvedValue(true);
    mocks.supervisor.captureTerminalSession.mockResolvedValue({ content: 'v2 screen\n' });

    const response = await call(resultHandler, 'tab-term-v2');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ content: 'v2 screen\n' });
    expect(mocks.supervisor.captureTerminalSession).toHaveBeenCalledWith({ sessionName: 'rtv2-ws-a-pane-a-tab-term-v2' });
    expect(mocks.capturePaneContent).not.toHaveBeenCalled();
    expect(mocks.readLastAssistantMessage).not.toHaveBeenCalled();
  });

  it('keeps 409 Tab session is not running for a dead session', async () => {
    mocks.isTabSessionAlive.mockResolvedValue(false);

    const response = await call(resultHandler, 'tab-claude');

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({ error: 'Tab session is not running' });
  });

  it('returns 409 for a Runtime v2 tab without calling the supervisor when Runtime v2 is off', async () => {
    vi.stubEnv('AGENTMUX_RUNTIME_V2', undefined);
    useActualRuntimeReads();

    const response = await call(resultHandler, 'tab-term-v2');

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({ error: 'Tab session is not running' });
    expect(mocks.getRuntimeSupervisor).not.toHaveBeenCalled();
  });
});

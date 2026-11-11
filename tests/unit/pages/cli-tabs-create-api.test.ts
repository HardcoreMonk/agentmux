import os from 'os';
import path from 'path';
import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findPane } from '@/lib/layout-tree';
import type { ICreateWorkspaceTabInput } from '@/lib/workspace-tab-service';
import type { ILayoutData, ITab } from '@/types/terminal';

const mocks = vi.hoisted(() => {
  const statusManager = { getAllForClient: vi.fn() };
  const supervisor = { requestStatusLiveSync: vi.fn() };
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  return {
    logger,
    verifyCliToken: vi.fn(),
    getLayout: vi.fn(),
    getWorkspaces: vi.fn(),
    getWorkspaceById: vi.fn(),
    getCachedRuntimePreflight: vi.fn(),
    getSessionCwd: vi.fn(),
    createWorkspaceTab: vi.fn(),
    launchAgentAfterShellReady: vi.fn(),
    waitForAgentReady: vi.fn(),
    statusManager,
    getStatusManager: vi.fn(() => statusManager),
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
vi.mock('@/lib/preflight', () => ({ getCachedRuntimePreflight: mocks.getCachedRuntimePreflight }));
vi.mock('@/lib/tmux', () => ({ getSessionCwd: mocks.getSessionCwd }));
vi.mock('@/lib/status-manager', () => ({ getStatusManager: mocks.getStatusManager }));
vi.mock('@/lib/runtime/supervisor', () => ({ getRuntimeSupervisor: mocks.getRuntimeSupervisor }));
vi.mock('@/lib/providers', () => ({ getProviderByPanelType: vi.fn() }));
vi.mock('@/lib/agent-launch-service', () => ({ launchAgentInTab: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => mocks.logger,
}));
vi.mock('@/lib/workspace-tab-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/workspace-tab-service')>()),
  createWorkspaceTab: mocks.createWorkspaceTab,
  launchAgentAfterShellReady: mocks.launchAgentAfterShellReady,
  waitForAgentReady: mocks.waitForAgentReady,
}));

import handler from '@/pages/api/cli/tabs';

const actualService = await vi.importActual<typeof import('@/lib/workspace-tab-service')>(
  '@/lib/workspace-tab-service',
);

const CALLER_HEADER = 'x-agentmux-caller-tab';

const WORKSPACES = [
  { id: 'ws-a', name: 'Workspace A', directories: ['/repo/a'] },
  { id: 'ws-b', name: 'Workspace B', directories: ['/repo/b'] },
];

const makeTab = (id: string, extra: Partial<ITab> = {}): ITab => ({
  id,
  sessionName: `pt-${id}`,
  name: id,
  order: 0,
  ...extra,
});

let layouts: Record<string, ILayoutData>;
let tabSeq = 0;

const resetLayouts = () => {
  layouts = {
    'ws-a': {
      root: {
        type: 'split',
        orientation: 'horizontal',
        ratio: 50,
        children: [
          { type: 'pane', id: 'pane-a1', tabs: [makeTab('tab-user', { panelType: 'terminal' })], activeTabId: 'tab-user' },
          {
            type: 'pane',
            id: 'pane-a2',
            tabs: [makeTab('tab-caller', { panelType: 'claude', cwd: '/work/caller-stored' })],
            activeTabId: 'tab-caller',
          },
        ],
      },
      activePaneId: 'pane-a2',
      updatedAt: '2026-11-11T00:00:00.000Z',
    },
    'ws-b': {
      root: { type: 'pane', id: 'pane-b1', tabs: [makeTab('tab-b-user')], activeTabId: 'tab-b-user' },
      activePaneId: 'pane-b1',
      updatedAt: '2026-11-11T00:00:00.000Z',
    },
  };
};

const paneOf = (workspaceId: string, paneId: string) => findPane(layouts[workspaceId].root, paneId)!;

const seedDelegatedTabs = (count: number) => {
  const pane = paneOf('ws-a', 'pane-a1');
  for (let i = 0; i < count; i += 1) {
    pane.tabs.push(makeTab(`tab-delegated-${i}`, { createdByTabId: i % 2 === 0 ? 'tab-caller' : 'tab-other' }));
  }
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

const createRequest = (body: unknown, callerTabId?: string): NextApiRequest => ({
  method: 'POST',
  query: {},
  body,
  headers: callerTabId ? { [CALLER_HEADER]: callerTabId } : {},
}) as unknown as NextApiRequest;

const callCreate = async (body: unknown, callerTabId?: string) => {
  const response = createResponse();
  await handler(createRequest(body, callerTabId), response.res);
  return response;
};

const createInput = (): ICreateWorkspaceTabInput => mocks.createWorkspaceTab.mock.calls[0][0];

const agentStatus = (installed: boolean, compatible?: boolean) => ({
  installed,
  version: installed ? '1.0.0' : null,
  ...(compatible === undefined ? {} : { compatible }),
});

beforeEach(() => {
  vi.stubEnv('AGENTMUX_RUNTIME_V2', '1');
  vi.stubEnv('AGENTMUX_RUNTIME_STATUS_V2_MODE', 'off');
  resetLayouts();
  tabSeq = 0;
  mocks.verifyCliToken.mockReturnValue(true);
  mocks.getLayout.mockImplementation(async (workspaceId: string) => layouts[workspaceId]);
  mocks.getWorkspaces.mockResolvedValue({ workspaces: WORKSPACES, activeWorkspaceId: 'ws-a' });
  mocks.getWorkspaceById.mockImplementation(async (id: string) => WORKSPACES.find((ws) => ws.id === id) ?? null);
  mocks.getCachedRuntimePreflight.mockResolvedValue({
    agents: { codex: agentStatus(true, true), claude: agentStatus(true) },
  });
  mocks.getSessionCwd.mockResolvedValue('/work/caller-live');
  mocks.createWorkspaceTab.mockImplementation(async (input: ICreateWorkspaceTabInput) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const pane = findPane(layouts[input.workspaceId].root, input.paneId);
    if (!pane) return null;
    tabSeq += 1;
    const tab = makeTab(`tab-new-${tabSeq}`, {
      name: input.name ?? '',
      order: pane.tabs.length,
      cwd: input.cwd,
      panelType: input.panelType ?? 'terminal',
      ...(input.createdByTabId ? { createdByTabId: input.createdByTabId } : {}),
    });
    pane.tabs.push(tab);
    if (input.activate !== false) pane.activeTabId = tab.id;
    return tab;
  });
  mocks.launchAgentAfterShellReady.mockResolvedValue({ ok: true });
  mocks.waitForAgentReady.mockResolvedValue(true);
  mocks.statusManager.getAllForClient.mockReturnValue({});
  mocks.supervisor.requestStatusLiveSync.mockResolvedValue({ tabs: {} });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('POST /api/cli/tabs without a caller tab', () => {
  it('creates the tab in the first pane with the first workspace directory and activates it', async () => {
    const response = await callCreate({ workspaceId: 'ws-a', name: 'build' });

    expect(response.statusCode).toBe(201);
    const input = createInput();
    expect(input).toMatchObject({ workspaceId: 'ws-a', paneId: 'pane-a1', name: 'build', cwd: '/repo/a', panelType: 'terminal' });
    expect(input).not.toHaveProperty('activate');
    expect(input).not.toHaveProperty('createdByTabId');
    expect(input).not.toHaveProperty('startAgent');
    expect(paneOf('ws-a', 'pane-a1').activeTabId).toBe('tab-new-1');
    expect(mocks.getSessionCwd).not.toHaveBeenCalled();
    expect(response.body).toEqual({
      tabId: 'tab-new-1',
      workspaceId: 'ws-a',
      paneId: 'pane-a1',
      sessionName: 'pt-tab-new-1',
      name: 'build',
      panelType: 'terminal',
      createdByTabId: null,
      ready: true,
    });
  });

  it('ignores the delegation limit', async () => {
    seedDelegatedTabs(6);

    const response = await callCreate({ workspaceId: 'ws-a' });

    expect(response.statusCode).toBe(201);
    expect(mocks.createWorkspaceTab).toHaveBeenCalledTimes(1);
  });

  it('keeps the existing workspaceId and workspace errors', async () => {
    const missingId = await callCreate({});
    expect(missingId.statusCode).toBe(400);
    expect(missingId.body).toEqual({ error: 'workspaceId is required' });

    const missingWorkspace = await callCreate({ workspaceId: 'ws-missing' });
    expect(missingWorkspace.statusCode).toBe(404);
    expect(missingWorkspace.body).toEqual({ error: 'Workspace not found' });
  });
});

describe('POST /api/cli/tabs with a caller tab', () => {
  it('creates the tab in the caller pane at the caller cwd without changing the active tab', async () => {
    const response = await callCreate({ workspaceId: 'ws-a', panelType: 'terminal' }, 'tab-caller');

    expect(response.statusCode).toBe(201);
    expect(createInput()).toMatchObject({
      workspaceId: 'ws-a',
      paneId: 'pane-a2',
      cwd: '/work/caller-live',
      panelType: 'terminal',
      activate: false,
      createdByTabId: 'tab-caller',
    });
    expect(mocks.getSessionCwd).toHaveBeenCalledWith('pt-tab-caller');
    expect(paneOf('ws-a', 'pane-a2').activeTabId).toBe('tab-caller');
    expect(response.body).toMatchObject({ paneId: 'pane-a2', createdByTabId: 'tab-caller', ready: true });
  });

  it("falls back to the caller tab's stored cwd when tmux cannot tell", async () => {
    mocks.getSessionCwd.mockResolvedValue(null);

    await callCreate({ workspaceId: 'ws-a' }, 'tab-caller');

    expect(createInput().cwd).toBe('/work/caller-stored');
  });

  it('creates the tab in the first pane of another workspace with its first directory', async () => {
    const response = await callCreate({ workspaceId: 'ws-b' }, 'tab-caller');

    expect(response.statusCode).toBe(201);
    expect(createInput()).toMatchObject({
      workspaceId: 'ws-b',
      paneId: 'pane-b1',
      cwd: '/repo/b',
      activate: false,
      createdByTabId: 'tab-caller',
    });
    expect(mocks.getSessionCwd).not.toHaveBeenCalled();
  });

  it('refuses with delegation-limit at six delegated tabs and creates nothing', async () => {
    seedDelegatedTabs(6);

    const response = await callCreate({ workspaceId: 'ws-a' }, 'tab-caller');

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({ error: 'delegation-limit', message: expect.any(String) });
    expect(mocks.createWorkspaceTab).not.toHaveBeenCalled();
  });

  it('counts delegated tabs in the target workspace only', async () => {
    seedDelegatedTabs(6);

    const response = await callCreate({ workspaceId: 'ws-b' }, 'tab-caller');

    expect(response.statusCode).toBe(201);
  });

  it('returns caller-tab-not-found for an unknown caller tab', async () => {
    const response = await callCreate({ workspaceId: 'ws-a' }, 'tab-gone');

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ error: 'caller-tab-not-found', message: expect.any(String) });
    expect(mocks.createWorkspaceTab).not.toHaveBeenCalled();
  });

  it('lets only one of three concurrent creates take the last delegated slot', async () => {
    seedDelegatedTabs(5);

    const responses = await Promise.all([
      callCreate({ workspaceId: 'ws-a' }, 'tab-caller'),
      callCreate({ workspaceId: 'ws-a' }, 'tab-caller'),
      callCreate({ workspaceId: 'ws-a' }, 'tab-caller'),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409, 409]);
    for (const response of responses.filter((candidate) => candidate.statusCode === 409)) {
      expect(response.body).toMatchObject({ error: 'delegation-limit' });
    }
    expect(mocks.createWorkspaceTab).toHaveBeenCalledTimes(1);
  });

  it('waits for agent readiness outside the delegation lock', async () => {
    let finishWaiting: (ready: boolean) => void = () => undefined;
    mocks.waitForAgentReady.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      finishWaiting = resolve;
    }));

    const agentCreate = callCreate({ workspaceId: 'ws-a', panelType: 'codex' }, 'tab-caller');
    await vi.waitFor(() => expect(mocks.waitForAgentReady).toHaveBeenCalledTimes(1));

    const terminalCreate = await callCreate({ workspaceId: 'ws-a' }, 'tab-caller');
    expect(terminalCreate.statusCode).toBe(201);

    finishWaiting(true);
    expect((await agentCreate).statusCode).toBe(201);
  });
});

describe('POST /api/cli/tabs request validation', () => {
  it('refuses an unknown panel type', async () => {
    const response = await callCreate({ workspaceId: 'ws-a', panelType: 'claude-code' });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: 'invalid-panel-type', message: expect.any(String) });
    expect(mocks.createWorkspaceTab).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing directory', path.join(os.tmpdir(), `agentmux-missing-${process.pid}-${Date.now()}`)],
    ['a relative path', 'relative/dir'],
    ['a file', path.resolve('package.json')],
    ['an empty value', ''],
  ])('refuses --cwd with %s', async (_label, cwd) => {
    const response = await callCreate({ workspaceId: 'ws-a', cwd }, 'tab-caller');

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: 'invalid-cwd', message: expect.any(String) });
    expect(mocks.createWorkspaceTab).not.toHaveBeenCalled();
  });

  it('uses an existing --cwd directory over the caller cwd', async () => {
    const cwd = os.tmpdir();

    const response = await callCreate({ workspaceId: 'ws-a', cwd }, 'tab-caller');

    expect(response.statusCode).toBe(201);
    expect(createInput().cwd).toBe(cwd);
    expect(mocks.getSessionCwd).not.toHaveBeenCalled();
  });
});

describe('POST /api/cli/tabs for agent tabs', () => {
  it('refuses with agent-unavailable before creating a tab when the agent is not installed', async () => {
    mocks.getCachedRuntimePreflight.mockResolvedValue({
      agents: { codex: agentStatus(true, true), claude: agentStatus(false) },
    });

    const response = await callCreate({ workspaceId: 'ws-a', panelType: 'claude' }, 'tab-caller');

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({ error: 'agent-unavailable', message: expect.any(String) });
    expect(mocks.createWorkspaceTab).not.toHaveBeenCalled();
  });

  it('refuses with agent-unavailable when the installed agent is not compatible', async () => {
    mocks.getCachedRuntimePreflight.mockResolvedValue({
      agents: { codex: agentStatus(true, false), claude: agentStatus(true) },
    });

    const response = await callCreate({ workspaceId: 'ws-a', panelType: 'codex' });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({ error: 'agent-unavailable' });
    expect(mocks.createWorkspaceTab).not.toHaveBeenCalled();
  });

  it('launches the agent and reports ready when it becomes ready', async () => {
    const before = Date.now();

    const response = await callCreate({ workspaceId: 'ws-a', panelType: 'claude' }, 'tab-caller');

    expect(response.statusCode).toBe(201);
    expect(createInput()).not.toHaveProperty('startAgent');
    expect(createInput().panelType).toBe('claude');
    expect(mocks.launchAgentAfterShellReady).toHaveBeenCalledWith({
      workspaceId: 'ws-a',
      paneId: 'pane-a2',
      tabId: 'tab-new-1',
    });
    const [readyTab, readyOptions] = mocks.waitForAgentReady.mock.calls[0];
    expect(readyTab).toMatchObject({ id: 'tab-new-1' });
    expect(readyOptions.launchStartedAt).toBeGreaterThanOrEqual(before);
    expect(readyOptions.launchStartedAt).toBeLessThanOrEqual(Date.now());
    expect(response.body).toMatchObject({ tabId: 'tab-new-1', panelType: 'claude', ready: true });
    expect(response.body).not.toHaveProperty('launchError');
  });

  it('reports ready: false when the agent does not become ready', async () => {
    mocks.waitForAgentReady.mockResolvedValue(false);

    const response = await callCreate({ workspaceId: 'ws-a', panelType: 'codex' });

    expect(response.statusCode).toBe(201);
    expect(response.body).toMatchObject({ panelType: 'codex', ready: false });
  });

  it('reports the launch error and does not wait when the launch fails', async () => {
    mocks.launchAgentAfterShellReady.mockResolvedValue({ ok: false, code: 'unsafe-process', processName: 'vim' });

    const response = await callCreate({ workspaceId: 'ws-a', panelType: 'codex' }, 'tab-caller');

    expect(response.statusCode).toBe(201);
    expect(response.body).toMatchObject({ ready: false, launchError: 'unsafe-process' });
    expect(mocks.waitForAgentReady).not.toHaveBeenCalled();
  });

  it('returns the created tab with launch-failed and does not wait when the launch throws', async () => {
    mocks.launchAgentAfterShellReady.mockRejectedValue(new Error('send-keys failed'));

    const response = await callCreate({ workspaceId: 'ws-a', panelType: 'claude' }, 'tab-caller');

    expect(response.statusCode).toBe(201);
    expect(response.body).toEqual({
      tabId: 'tab-new-1',
      workspaceId: 'ws-a',
      paneId: 'pane-a2',
      sessionName: 'pt-tab-new-1',
      name: '',
      panelType: 'claude',
      createdByTabId: 'tab-caller',
      ready: false,
      launchError: 'launch-failed',
    });
    expect(mocks.waitForAgentReady).not.toHaveBeenCalled();
    expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('send-keys failed'));
    expect(mocks.logger.error).not.toHaveBeenCalled();
  });

  it('returns internal-error when the service throws', async () => {
    mocks.createWorkspaceTab.mockRejectedValue(new Error('tmux exploded'));

    const response = await callCreate({ workspaceId: 'ws-a' }, 'tab-caller');

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ error: 'internal-error', message: 'tmux exploded' });
  });
});

describe.each([
  {
    mode: 'legacy status manager',
    env: { AGENTMUX_RUNTIME_V2: undefined, AGENTMUX_RUNTIME_STATUS_V2_MODE: undefined },
    publish: (tabId: string, entry: unknown) => {
      mocks.statusManager.getAllForClient.mockReturnValue({ [tabId]: entry });
    },
    otherSource: () => mocks.supervisor.requestStatusLiveSync,
  },
  {
    mode: 'Runtime v2 status live',
    env: { AGENTMUX_RUNTIME_V2: '1', AGENTMUX_RUNTIME_STATUS_V2_MODE: 'default' },
    publish: (tabId: string, entry: unknown) => {
      mocks.supervisor.requestStatusLiveSync.mockResolvedValue({ tabs: { [tabId]: entry } });
    },
    otherSource: () => mocks.statusManager.getAllForClient,
  },
])('POST /api/cli/tabs agent readiness in $mode mode', ({ env, publish, otherSource }) => {
  it('reports ready once that mode reports session-start after the launch', async () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    mocks.waitForAgentReady.mockImplementation((tab: ITab, options: { launchStartedAt: number }) =>
      actualService.waitForAgentReady(tab, { ...options, timeoutMs: 200, pollMs: 5 }));
    mocks.launchAgentAfterShellReady.mockImplementation(async ({ tabId }: { tabId: string }) => {
      publish(tabId, {
        cliState: 'idle',
        workspaceId: 'ws-a',
        tabName: '',
        lastEvent: { name: 'session-start', at: Date.now(), seq: 1 },
      });
      return { ok: true };
    });

    const response = await callCreate({ workspaceId: 'ws-a', panelType: 'claude' }, 'tab-caller');

    expect(response.statusCode).toBe(201);
    expect(response.body).toMatchObject({ createdByTabId: 'tab-caller', ready: true });
    expect(otherSource()).not.toHaveBeenCalled();
  });
});

describe('GET /api/cli/tabs', () => {
  it('adds createdByTabId and runtimeVersion to each tab', async () => {
    paneOf('ws-a', 'pane-a1').tabs.push(
      makeTab('tab-delegated', { panelType: 'codex', runtimeVersion: 1, createdByTabId: 'tab-caller' }),
      makeTab('tab-v2', { panelType: 'terminal', runtimeVersion: 2 }),
    );
    const response = createResponse();

    await handler({ method: 'GET', query: { workspaceId: 'ws-a' }, headers: {} } as unknown as NextApiRequest, response.res);

    expect(response.statusCode).toBe(200);
    expect((response.body as { tabs: unknown[] }).tabs).toEqual([
      { tabId: 'tab-user', workspaceId: 'ws-a', name: 'tab-user', sessionName: 'pt-tab-user', panelType: 'terminal', createdByTabId: null, runtimeVersion: 1 },
      { tabId: 'tab-delegated', workspaceId: 'ws-a', name: 'tab-delegated', sessionName: 'pt-tab-delegated', panelType: 'codex', createdByTabId: 'tab-caller', runtimeVersion: 1 },
      { tabId: 'tab-v2', workspaceId: 'ws-a', name: 'tab-v2', sessionName: 'pt-tab-v2', panelType: 'terminal', createdByTabId: null, runtimeVersion: 2 },
      { tabId: 'tab-caller', workspaceId: 'ws-a', name: 'tab-caller', sessionName: 'pt-tab-caller', panelType: 'claude', createdByTabId: null, runtimeVersion: 1 },
    ]);
  });
});

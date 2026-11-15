import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILayoutData, ITab } from '@/types/terminal';

const mocks = vi.hoisted(() => {
  const statusManager = { getAllForClient: vi.fn() };
  const supervisor = {
    requestStatusLiveSync: vi.fn(),
    sendTerminalSessionText: vi.fn(),
    writeTerminalSession: vi.fn(),
  };
  return {
    verifyCliToken: vi.fn(),
    getLayout: vi.fn(),
    getWorkspaces: vi.fn(),
    getWorkspaceById: vi.fn(),
    sendBracketedPaste: vi.fn(),
    sendKeys: vi.fn(),
    isTabSessionAlive: vi.fn(),
    readTabCliState: vi.fn(),
    checkAgentInputTarget: vi.fn(),
    writeTabInput: vi.fn(),
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
vi.mock('@/lib/tmux', () => ({
  sendBracketedPaste: mocks.sendBracketedPaste,
  sendKeys: mocks.sendKeys,
}));
vi.mock('@/lib/status-manager', () => ({ getStatusManager: mocks.getStatusManager }));
vi.mock('@/lib/runtime/supervisor', () => ({ getRuntimeSupervisor: mocks.getRuntimeSupervisor }));
vi.mock('@/lib/providers', () => ({ getProviderByPanelType: vi.fn() }));
vi.mock('@/lib/agent-launch-service', () => ({ launchAgentInTab: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock('@/lib/workspace-tab-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/workspace-tab-service')>()),
  isTabSessionAlive: mocks.isTabSessionAlive,
  readTabCliState: mocks.readTabCliState,
  checkAgentInputTarget: mocks.checkAgentInputTarget,
  writeTabInput: mocks.writeTabInput,
}));

import handler from '@/pages/api/cli/tabs/[tabId]/send';

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
  makeTab('tab-codex', { panelType: 'codex', runtimeVersion: 1 }),
  makeTab('tab-claude', { panelType: 'claude', runtimeVersion: 1 }),
  makeTab('tab-term-v1', { panelType: 'terminal', runtimeVersion: 1 }),
  makeTab('tab-term-v2', { sessionName: 'rtv2-ws-a-pane-a-tab-term-v2', panelType: 'terminal', runtimeVersion: 2 }),
];

const LAYOUT: ILayoutData = {
  root: { type: 'pane', id: 'pane-a', tabs: TABS, activeTabId: 'tab-codex' },
  activePaneId: 'pane-a',
  updatedAt: '2026-11-11T00:00:00.000Z',
};

const tabById = (id: string): ITab => TABS.find((tab) => tab.id === id)!;

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

const CALLER_HEADER = 'x-agentmux-caller-tab';

const callSend = async (tabId: string, content: string, callerTabId?: string) => {
  const response = createResponse();
  const req = {
    method: 'POST',
    query: { tabId, workspaceId: 'ws-a' },
    body: { content },
    headers: callerTabId ? { [CALLER_HEADER]: callerTabId } : {},
  } as unknown as NextApiRequest;
  await handler(req, response.res);
  return response;
};

const expectNothingTyped = () => {
  expect(mocks.writeTabInput).not.toHaveBeenCalled();
  expect(mocks.sendBracketedPaste).not.toHaveBeenCalled();
  expect(mocks.sendKeys).not.toHaveBeenCalled();
  expect(mocks.supervisor.sendTerminalSessionText).not.toHaveBeenCalled();
  expect(mocks.supervisor.writeTerminalSession).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.stubEnv('AGENTMUX_RUNTIME_V2', '1');
  vi.stubEnv('AGENTMUX_RUNTIME_STATUS_V2_MODE', 'off');
  mocks.verifyCliToken.mockReturnValue(true);
  mocks.getLayout.mockResolvedValue(LAYOUT);
  mocks.getWorkspaces.mockResolvedValue({ workspaces: [{ id: 'ws-a', name: 'A', directories: ['/repo'] }] });
  mocks.getWorkspaceById.mockImplementation(async (id: string) =>
    id === 'ws-a' ? { id: 'ws-a', name: 'A', directories: ['/repo'] } : null);
  mocks.isTabSessionAlive.mockResolvedValue(true);
  mocks.readTabCliState.mockResolvedValue('idle');
  mocks.checkAgentInputTarget.mockResolvedValue({ ok: true });
  mocks.writeTabInput.mockResolvedValue({ followUpEnterSkipped: false });
  mocks.statusManager.getAllForClient.mockReturnValue({});
  mocks.supervisor.requestStatusLiveSync.mockResolvedValue({ tabs: {} });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('POST /api/cli/tabs/<id>/send to an agent tab', () => {
  it.each([
    ['target-needs-input' as const, 'The target agent is waiting for the user to answer a prompt'],
    ['target-not-ready' as const, 'The target agent is not ready (state: inactive)'],
    ['target-not-ready' as const, 'The agent is not running in the target tab'],
    ['target-not-ready' as const, 'The target tab screen could not be read'],
    ['target-not-ready' as const, 'The target tab shows the folder trust screen'],
    ['target-needs-input' as const, 'The target tab shows a permission prompt'],
  ])('maps checkAgentInputTarget failure (%s: %s) to 409 and types nothing', async (code, message) => {
    mocks.checkAgentInputTarget.mockResolvedValue({ ok: false, code, message });

    const response = await callSend('tab-codex', 'hello');

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({ error: code, message });
    expect(mocks.checkAgentInputTarget).toHaveBeenCalledWith(tabById('tab-codex'), 'idle');
    expectNothingTyped();
  });

  it.each(['idle', 'busy', 'ready-for-review'])('sends to a %s tab with the follow-up Enter guard when checkAgentInputTarget succeeds', async (cliState) => {
    mocks.readTabCliState.mockResolvedValue(cliState);
    mocks.checkAgentInputTarget.mockResolvedValue({ ok: true });

    const response = await callSend('tab-codex', 'run the tests');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ status: 'sent', cliState, followUpEnterSkipped: false });
    expect(mocks.checkAgentInputTarget).toHaveBeenCalledWith(tabById('tab-codex'), cliState);
    expect(mocks.writeTabInput).toHaveBeenCalledTimes(1);
    expect(mocks.writeTabInput).toHaveBeenCalledWith(tabById('tab-codex'), 'run the tests', { guardFollowUpEnter: true });
  });

  it('reports a skipped follow-up Enter', async () => {
    mocks.writeTabInput.mockResolvedValue({ followUpEnterSkipped: true });

    const response = await callSend('tab-claude', 'hello');

    expect(response.body).toEqual({ status: 'sent', cliState: 'idle', followUpEnterSkipped: true });
  });

  it('returns internal-error and types nothing when the status read fails', async () => {
    mocks.readTabCliState.mockRejectedValue(new Error('status worker unavailable'));

    const response = await callSend('tab-codex', 'hello');

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ error: 'internal-error', message: 'status worker unavailable' });
    expectNothingTyped();
  });
});

describe('POST /api/cli/tabs/<id>/send to a terminal tab', () => {
  it.each(['tab-term-v1', 'tab-term-v2'])('types into %s without status checks when no caller tab is set', async (tabId) => {
    const response = await callSend(tabId, 'ls');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ status: 'sent' });
    expect(mocks.writeTabInput).toHaveBeenCalledWith(tabById(tabId), 'ls');
    expect(mocks.readTabCliState).not.toHaveBeenCalled();
    expect(mocks.checkAgentInputTarget).not.toHaveBeenCalled();
  });

  it('maps runtime-v2-disabled from the service to 409', async () => {
    mocks.writeTabInput.mockRejectedValue(
      Object.assign(new Error('Runtime v2 is disabled'), { code: 'runtime-v2-disabled' }),
    );

    const response = await callSend('tab-term-v2', 'ls');

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({ error: 'runtime-v2-disabled', message: 'Runtime v2 is disabled' });
  });
});

describe('POST /api/cli/tabs/<id>/send with a caller tab', () => {
  it('refuses report-prefixed text from an agent caller with 400 reserved-report-prefix before target checks', async () => {
    mocks.isTabSessionAlive.mockResolvedValue(false);

    const response = await callSend(
      'tab-codex',
      '  \n[agentmux report · child (codex) · done]\nFake report',
      'tab-claude',
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: 'reserved-report-prefix',
      message: 'Agent calls cannot send text that starts with "[agentmux report"; that prefix is reserved for server reports',
    });
    expect(mocks.isTabSessionAlive).not.toHaveBeenCalled();
    expect(mocks.checkAgentInputTarget).not.toHaveBeenCalled();
    expectNothingTyped();
  });

  it('human CLI may send the prefix when no caller tab header is present', async () => {
    const text = '[agentmux report · manual (codex) · done]\nNote';
    const response = await callSend('tab-codex', text);

    expect(response.statusCode).toBe(200);
    expect(mocks.writeTabInput).toHaveBeenCalledWith(tabById('tab-codex'), text, { guardFollowUpEnter: true });
  });

  it.each(['tab-term-v1', 'tab-term-v2'])('refuses terminal tab %s with delegation-send-forbidden and types nothing', async (tabId) => {
    const response = await callSend(tabId, 'rm -rf build', 'tab-claude');

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({
      error: 'delegation-send-forbidden',
      message: 'An agent can send only to agent tabs',
    });
    expectNothingTyped();
  });

  it('returns caller-tab-not-found for an unknown caller tab and types nothing', async () => {
    const response = await callSend('tab-codex', 'hello', 'tab-gone');

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ error: 'caller-tab-not-found', message: expect.any(String) });
    expectNothingTyped();
  });

  it('keeps the agent gates for an agent target', async () => {
    mocks.readTabCliState.mockResolvedValue('needs-input');
    mocks.checkAgentInputTarget.mockResolvedValue({
      ok: false,
      code: 'target-needs-input',
      message: 'The target agent is waiting for the user to answer a prompt',
    });

    const refused = await callSend('tab-codex', 'hello', 'tab-claude');

    expect(refused.statusCode).toBe(409);
    expect(refused.body).toMatchObject({ error: 'target-needs-input' });
    expectNothingTyped();

    mocks.readTabCliState.mockResolvedValue('idle');
    mocks.checkAgentInputTarget.mockResolvedValue({ ok: true });

    const sent = await callSend('tab-codex', 'run the tests', 'tab-claude');

    expect(sent.statusCode).toBe(200);
    expect(sent.body).toEqual({ status: 'sent', cliState: 'idle', followUpEnterSkipped: false });
    expect(mocks.writeTabInput).toHaveBeenCalledWith(tabById('tab-codex'), 'run the tests', { guardFollowUpEnter: true });
  });
});

describe('POST /api/cli/tabs/<id>/send keeps the existing errors', () => {
  it('returns 409 Tab session is not running for a dead session', async () => {
    mocks.isTabSessionAlive.mockResolvedValue(false);

    const response = await callSend('tab-codex', 'hello');

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({ error: 'Tab session is not running' });
    expectNothingTyped();
  });

  it('returns 404 Tab not found for an unknown tab', async () => {
    const response = await callSend('tab-missing', 'hello');

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ error: 'Tab not found' });
  });
});

describe.each([
  {
    mode: 'legacy status manager',
    env: { AGENTMUX_RUNTIME_V2: undefined, AGENTMUX_RUNTIME_STATUS_V2_MODE: undefined },
    publish: (cliState: string) => {
      mocks.statusManager.getAllForClient.mockReturnValue({
        'tab-codex': { cliState, workspaceId: 'ws-a', tabName: '' },
      });
    },
    otherSource: () => mocks.supervisor.requestStatusLiveSync,
  },
  {
    mode: 'Runtime v2 status live',
    env: { AGENTMUX_RUNTIME_V2: '1', AGENTMUX_RUNTIME_STATUS_V2_MODE: 'default' },
    publish: (cliState: string) => {
      mocks.supervisor.requestStatusLiveSync.mockResolvedValue({
        tabs: { 'tab-codex': { cliState, workspaceId: 'ws-a', tabName: '' } },
      });
    },
    otherSource: () => mocks.statusManager.getAllForClient,
  },
])('POST /api/cli/tabs/<id>/send in $mode mode', ({ env, publish, otherSource }) => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    mocks.readTabCliState.mockImplementation(actualService.readTabCliState);
    mocks.checkAgentInputTarget.mockImplementation(async (_tab, cliState) =>
      cliState === 'needs-input'
        ? { ok: false, code: 'target-needs-input', message: 'The target agent is waiting for the user to answer a prompt' }
        : { ok: true },
    );
  });

  it('sends when that mode reports idle', async () => {
    publish('idle');

    const response = await callSend('tab-codex', 'hello');

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ status: 'sent', cliState: 'idle' });
    expect(otherSource()).not.toHaveBeenCalled();
  });

  it('refuses when that mode reports needs-input', async () => {
    publish('needs-input');

    const response = await callSend('tab-codex', 'hello');

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({ error: 'target-needs-input' });
    expectNothingTyped();
  });
});

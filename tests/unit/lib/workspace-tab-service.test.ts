import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ITab } from '@/types/terminal';

const mocks = vi.hoisted(() => {
  const statusManager = {
    getAllForClient: vi.fn(),
    registerTab: vi.fn(),
    removeTab: vi.fn(),
  };
  const supervisor = {
    ensureStarted: vi.fn(),
    createTerminalTab: vi.fn(),
    deleteTerminalTab: vi.fn(),
    requestStatusLiveSync: vi.fn(),
    registerStatusLiveTab: vi.fn(),
    removeStatusLiveTab: vi.fn(),
    captureTerminalSession: vi.fn(),
    sendTerminalSessionText: vi.fn(),
    hasTerminalSession: vi.fn(),
    writeTerminalSession: vi.fn(),
  };
  return {
    statusManager,
    supervisor,
    getStatusManager: vi.fn(() => statusManager),
    getRuntimeSupervisor: vi.fn(() => supervisor),
    execFile: vi.fn(),
    hasSession: vi.fn(),
    getSessionPanePid: vi.fn(),
    capturePaneContent: vi.fn(),
    addTabToPane: vi.fn(),
    addExistingTabToPane: vi.fn(),
    removeTabFromPane: vi.fn(),
    readLayoutFile: vi.fn(),
    getLayout: vi.fn(),
    updateTabAgentSessionId: vi.fn(),
    getWorkspaceById: vi.fn(),
    getWorkspaces: vi.fn(),
    launchAgentInTab: vi.fn(),
  };
});

vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  execFile: mocks.execFile,
}));

vi.mock('@/lib/tmux', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tmux')>();
  return {
    ...actual,
    hasSession: mocks.hasSession,
    getSessionPanePid: mocks.getSessionPanePid,
    capturePaneContent: mocks.capturePaneContent,
    sendBracketedPaste: vi.fn(actual.sendBracketedPaste),
  };
});

vi.mock('@/lib/layout-store', () => ({
  addTabToPane: mocks.addTabToPane,
  addExistingTabToPane: mocks.addExistingTabToPane,
  removeTabFromPane: mocks.removeTabFromPane,
  readLayoutFile: mocks.readLayoutFile,
  resolveLayoutFile: (workspaceId: string) => `/layout/${workspaceId}.json`,
  getLayout: mocks.getLayout,
  updateTabAgentSessionId: mocks.updateTabAgentSessionId,
}));

vi.mock('@/lib/workspace-store', () => ({
  getWorkspaceById: mocks.getWorkspaceById,
  getWorkspaces: mocks.getWorkspaces,
}));

vi.mock('@/lib/status-manager', () => ({ getStatusManager: mocks.getStatusManager }));
vi.mock('@/lib/runtime/supervisor', () => ({ getRuntimeSupervisor: mocks.getRuntimeSupervisor }));
vi.mock('@/lib/agent-launch-service', () => ({ launchAgentInTab: mocks.launchAgentInTab }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { sendBracketedPaste } from '@/lib/tmux';
import { getProviderByPanelType } from '@/lib/providers';
import {
  closeWorkspaceTab,
  countDelegatedTabs,
  createWorkspaceTab,
  findTabInAnyWorkspace,
  isAgentProcessRunning,
  isTabSessionAlive,
  launchAgentAfterShellReady,
  readLastAssistantMessage,
  readTabCliState,
  readTabScreen,
  waitForAgentReady,
  writeTabInput,
} from '@/lib/workspace-tab-service';

const PERMISSION_SCREEN = [
  ' Bash command',
  '   rm -rf build',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  "   2. Yes, and don't ask again for rm commands in /tmp/x",
  '   3. No, and tell Claude what to do differently (esc)',
].join('\n');

const TRUST_SCREEN = [
  '> You are in /tmp/project',
  '',
  '  Do you trust the contents of this directory?',
  '',
  '› 1. Yes, continue',
  '  2. No, quit',
].join('\n');

const HOOKS_REVIEW_SCREEN = [
  '  Hooks need review',
  '',
  '  Hooks can run outside the sandbox after you trust them.',
  '',
  '› 1. Trust all and continue',
  "  2. Continue without trusting (hooks won't run)",
].join('\n');

const agentTab = (overrides: Partial<ITab> = {}): ITab => ({
  id: 'tab-a',
  sessionName: 'pt-ws-a-pane-a-tab-a',
  name: '',
  order: 0,
  panelType: 'claude',
  runtimeVersion: 1,
  ...overrides,
});

const runtimeTab = (overrides: Partial<ITab> = {}): ITab => ({
  id: 'tab-v2',
  sessionName: 'rtv2-ws-a-pane-a-tab-v2',
  name: '',
  order: 1,
  panelType: 'terminal',
  runtimeVersion: 2,
  ...overrides,
});

const tmuxCalls = (): string[][] => mocks.execFile.mock.calls.map((call) => call[1] as string[]);
const enterCalls = (): number[] => mocks.execFile.mock.calls
  .map((call, index) => ({ args: call[1] as string[], order: mocks.execFile.mock.invocationCallOrder[index] }))
  .filter(({ args }) => args.includes('send-keys') && args.at(-1) === 'Enter')
  .map(({ order }) => order);

const paneLayout = (tabs: ITab[], activeTabId: string | null) => ({
  root: { type: 'pane' as const, id: 'pane-a', tabs, activeTabId },
  activePaneId: 'pane-a',
  updatedAt: '2026-11-11T00:00:00.000Z',
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('AGENTMUX_RUNTIME_V2', '1');
  vi.stubEnv('AGENTMUX_RUNTIME_TERMINAL_V2_MODE', 'off');
  vi.stubEnv('AGENTMUX_RUNTIME_STATUS_V2_MODE', 'off');
  mocks.getStatusManager.mockReturnValue(mocks.statusManager);
  mocks.getRuntimeSupervisor.mockReturnValue(mocks.supervisor);
  mocks.execFile.mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1) as (err: Error | null, result: { stdout: string; stderr: string }) => void;
    callback(null, { stdout: '', stderr: '' });
  });
  mocks.statusManager.getAllForClient.mockReturnValue({});
  mocks.supervisor.registerStatusLiveTab.mockResolvedValue({ accepted: true });
  mocks.supervisor.removeStatusLiveTab.mockResolvedValue({ accepted: true });
  mocks.getWorkspaceById.mockResolvedValue({ id: 'ws-a', name: 'Workspace A', directories: ['/repo'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('readTabCliState', () => {
  it('reads the Runtime v2 live status in status live mode', async () => {
    vi.stubEnv('AGENTMUX_RUNTIME_STATUS_V2_MODE', 'default');
    mocks.supervisor.requestStatusLiveSync.mockResolvedValue({
      tabs: { 'tab-a': { cliState: 'busy', workspaceId: 'ws-a', tabName: '' } },
      rateLimits: {},
    });

    await expect(readTabCliState(agentTab({ cliState: 'idle' }))).resolves.toBe('busy');
    expect(mocks.statusManager.getAllForClient).not.toHaveBeenCalled();
  });

  it('reads the status manager outside status live mode', async () => {
    mocks.statusManager.getAllForClient.mockReturnValue({
      'tab-a': { cliState: 'needs-input', workspaceId: 'ws-a', tabName: '' },
    });

    await expect(readTabCliState(agentTab({ cliState: 'idle' }))).resolves.toBe('needs-input');
    expect(mocks.getRuntimeSupervisor).not.toHaveBeenCalled();
  });

  it('falls back to the stored tab state, then null', async () => {
    await expect(readTabCliState(agentTab({ cliState: 'idle' }))).resolves.toBe('idle');
    await expect(readTabCliState(agentTab())).resolves.toBeNull();
  });
});

describe('writeTabInput', () => {
  it('pastes into a v1 tab with two Enters by default', async () => {
    vi.useFakeTimers();

    const pending = writeTabInput(agentTab(), 'hi');
    await vi.advanceTimersByTimeAsync(600);

    await expect(pending).resolves.toEqual({ followUpEnterSkipped: false });
    expect(vi.mocked(sendBracketedPaste)).toHaveBeenCalledWith('pt-ws-a-pane-a-tab-a', 'hi');
    expect(tmuxCalls()).toContainEqual(expect.arrayContaining(['send-keys', '-l', '\x1b[200~hi\x1b[201~']));
    expect(enterCalls()).toHaveLength(2);
    expect(mocks.capturePaneContent).not.toHaveBeenCalled();
  });

  it('types into a v2 tab through the supervisor with a single Enter', async () => {
    mocks.supervisor.sendTerminalSessionText.mockResolvedValue(undefined);

    await expect(writeTabInput(runtimeTab(), 'hi')).resolves.toEqual({ followUpEnterSkipped: false });

    expect(mocks.supervisor.sendTerminalSessionText).toHaveBeenCalledWith({
      sessionName: 'rtv2-ws-a-pane-a-tab-v2',
      text: '\x1b[200~hi\x1b[201~',
      enter: true,
    });
    expect(mocks.supervisor.writeTerminalSession).not.toHaveBeenCalled();
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('holds back the follow-up Enter when a permission prompt appears after the paste', async () => {
    vi.useFakeTimers();
    mocks.capturePaneContent.mockResolvedValue(PERMISSION_SCREEN);

    const pending = writeTabInput(agentTab(), 'hi', { guardFollowUpEnter: true });
    await vi.advanceTimersByTimeAsync(600);

    await expect(pending).resolves.toEqual({ followUpEnterSkipped: true });
    const enters = enterCalls();
    expect(enters).toHaveLength(1);
    expect(mocks.capturePaneContent).toHaveBeenCalledWith('pt-ws-a-pane-a-tab-a');
    expect(mocks.capturePaneContent.mock.invocationCallOrder[0]).toBeGreaterThan(enters[0]);
  });

  it.each([
    ['trust', TRUST_SCREEN],
    ['Codex hook review', HOOKS_REVIEW_SCREEN],
  ])('holds back the follow-up Enter when the %s screen appears after the paste', async (_label, screen) => {
    vi.useFakeTimers();
    mocks.capturePaneContent.mockResolvedValue(screen);

    const pending = writeTabInput(agentTab({ panelType: 'codex' }), 'hi', { guardFollowUpEnter: true });
    await vi.advanceTimersByTimeAsync(600);

    await expect(pending).resolves.toEqual({ followUpEnterSkipped: true });
    expect(enterCalls()).toHaveLength(1);
  });

  it('holds back the follow-up Enter when the screen after the paste cannot be read', async () => {
    vi.useFakeTimers();
    mocks.capturePaneContent.mockResolvedValue(null);

    const pending = writeTabInput(agentTab(), 'hi', { guardFollowUpEnter: true });
    await vi.advanceTimersByTimeAsync(600);

    await expect(pending).resolves.toEqual({ followUpEnterSkipped: true });
    expect(enterCalls()).toHaveLength(1);
  });

  it('sends the follow-up Enter when the screen after the paste is ordinary', async () => {
    vi.useFakeTimers();
    mocks.capturePaneContent.mockResolvedValue('› hi\n\n  Working (1s • esc to interrupt)\n');

    const pending = writeTabInput(agentTab(), 'hi', { guardFollowUpEnter: true });
    await vi.advanceTimersByTimeAsync(600);

    await expect(pending).resolves.toEqual({ followUpEnterSkipped: false });
    expect(enterCalls()).toHaveLength(2);
  });
});

describe('readTabScreen', () => {
  it('captures a v2 tab through the supervisor', async () => {
    mocks.supervisor.captureTerminalSession.mockResolvedValue({
      sessionName: 'rtv2-ws-a-pane-a-tab-v2',
      content: '$ ls\nREADME.md\n',
    });

    await expect(readTabScreen(runtimeTab())).resolves.toBe('$ ls\nREADME.md\n');
    expect(mocks.supervisor.captureTerminalSession).toHaveBeenCalledWith({ sessionName: 'rtv2-ws-a-pane-a-tab-v2' });
    expect(mocks.capturePaneContent).not.toHaveBeenCalled();
  });

  it('returns null when the supervisor capture fails', async () => {
    mocks.supervisor.captureTerminalSession.mockRejectedValue(new Error('session is not ready'));

    await expect(readTabScreen(runtimeTab())).resolves.toBeNull();
  });

  it('captures a v1 tab through tmux', async () => {
    mocks.capturePaneContent.mockResolvedValue('screen');

    await expect(readTabScreen(agentTab())).resolves.toBe('screen');
    expect(mocks.capturePaneContent).toHaveBeenCalledWith('pt-ws-a-pane-a-tab-a');
  });
});

describe('isTabSessionAlive', () => {
  it('asks the supervisor for v2 tabs and tmux for v1 tabs', async () => {
    mocks.supervisor.hasTerminalSession.mockResolvedValue(true);
    mocks.hasSession.mockResolvedValue(false);

    await expect(isTabSessionAlive(runtimeTab())).resolves.toBe(true);
    await expect(isTabSessionAlive(agentTab())).resolves.toBe(false);
    expect(mocks.supervisor.hasTerminalSession).toHaveBeenCalledWith({ sessionName: 'rtv2-ws-a-pane-a-tab-v2' });
    expect(mocks.hasSession).toHaveBeenCalledWith('pt-ws-a-pane-a-tab-a');
  });
});

describe('Runtime v2 disabled', () => {
  it('treats v2 tabs as not running without starting the supervisor', async () => {
    vi.stubEnv('AGENTMUX_RUNTIME_V2', '0');

    await expect(isTabSessionAlive(runtimeTab())).resolves.toBe(false);
    await expect(readTabScreen(runtimeTab())).resolves.toBeNull();
    await expect(writeTabInput(runtimeTab(), 'hi')).rejects.toMatchObject({ code: 'runtime-v2-disabled' });
    expect(mocks.getRuntimeSupervisor).not.toHaveBeenCalled();
    expect(mocks.execFile).not.toHaveBeenCalled();
  });
});

describe('isAgentProcessRunning', () => {
  it('is false without a pane pid', async () => {
    const provider = getProviderByPanelType('claude')!;
    const isAgentRunning = vi.spyOn(provider, 'isAgentRunning');
    mocks.getSessionPanePid.mockResolvedValue(null);

    await expect(isAgentProcessRunning(agentTab())).resolves.toBe(false);
    expect(isAgentRunning).not.toHaveBeenCalled();
  });

  it('follows the provider process check', async () => {
    const provider = getProviderByPanelType('claude')!;
    const isAgentRunning = vi.spyOn(provider, 'isAgentRunning').mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mocks.getSessionPanePid.mockResolvedValue(4242);

    await expect(isAgentProcessRunning(agentTab())).resolves.toBe(false);
    await expect(isAgentProcessRunning(agentTab())).resolves.toBe(true);
    expect(isAgentRunning).toHaveBeenCalledWith(4242);
  });

  it('is false for terminal and v2 tabs', async () => {
    mocks.getSessionPanePid.mockResolvedValue(4242);

    await expect(isAgentProcessRunning(agentTab({ panelType: 'terminal' }))).resolves.toBe(false);
    await expect(isAgentProcessRunning(runtimeTab())).resolves.toBe(false);
    expect(mocks.getSessionPanePid).not.toHaveBeenCalled();
  });
});

describe('readLastAssistantMessage', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmux-tab-service-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const writeJsonl = async (name: string, lines: unknown[]): Promise<string> => {
    const filePath = path.join(dir, name);
    await fs.writeFile(filePath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
    return filePath;
  };

  it('returns the last Claude assistant reply', async () => {
    const jsonlPath = await writeJsonl('claude.jsonl', [
      { type: 'user', uuid: 'u1', timestamp: '2026-11-11T00:00:00.000Z', message: { role: 'user', content: 'Summarize the repo' } },
      {
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-11-11T00:00:01.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Reading the files first.' }] },
      },
      {
        type: 'assistant',
        uuid: 'a2',
        timestamp: '2026-11-11T00:00:02.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'The repo has two packages.' }] },
      },
    ]);

    await expect(readLastAssistantMessage(agentTab({ agentJsonlPath: jsonlPath }))).resolves.toEqual({
      text: 'The repo has two packages.',
      timestamp: Date.parse('2026-11-11T00:00:02.000Z'),
    });
  });

  it('returns the last Codex assistant reply', async () => {
    const jsonlPath = await writeJsonl('codex.jsonl', [
      { type: 'event_msg', timestamp: '2026-11-11T00:00:00.000Z', payload: { type: 'user_message', message: 'Summarize the repo' } },
      { type: 'event_msg', timestamp: '2026-11-11T00:00:01.000Z', payload: { type: 'agent_message', message: 'Reading the files first.' } },
      {
        type: 'event_msg',
        timestamp: '2026-11-11T00:00:02.000Z',
        payload: { type: 'agent_message', message: 'The repo has two packages.', phase: 'final' },
      },
    ]);

    await expect(readLastAssistantMessage(agentTab({ panelType: 'codex', agentJsonlPath: jsonlPath }))).resolves.toEqual({
      text: 'The repo has two packages.',
      timestamp: Date.parse('2026-11-11T00:00:02.000Z'),
    });
  });

  it('resolves the JSONL path from the session id when the tab has no path', async () => {
    const jsonlPath = await writeJsonl('resolved.jsonl', [
      {
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-11-11T00:00:01.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
      },
    ]);
    const provider = getProviderByPanelType('claude')!;
    const resolveJsonlPath = vi.spyOn(provider, 'resolveJsonlPath').mockResolvedValue(jsonlPath);

    const result = await readLastAssistantMessage(agentTab({ agentSessionId: 'session-1', cwd: '/repo' }));

    expect(resolveJsonlPath).toHaveBeenCalledWith('session-1', '/repo');
    expect(result?.text).toBe('Done.');
  });

  it('returns null when the JSONL file does not exist', async () => {
    await expect(readLastAssistantMessage(agentTab({ agentJsonlPath: path.join(dir, 'missing.jsonl') }))).resolves.toBeNull();
    await expect(readLastAssistantMessage(agentTab())).resolves.toBeNull();
  });

  it('returns null for terminal tabs', async () => {
    await expect(readLastAssistantMessage(agentTab({ panelType: 'terminal' }))).resolves.toBeNull();
  });
});

describe('waitForAgentReady', () => {
  const launchStartedAt = 1_000_000;

  it('becomes ready once the session-start after the launch shows up', async () => {
    mocks.statusManager.getAllForClient
      .mockReturnValueOnce({ 'tab-a': { cliState: 'inactive', lastEvent: null } })
      .mockReturnValueOnce({ 'tab-a': { cliState: 'idle', lastEvent: null } })
      .mockReturnValue({ 'tab-a': { cliState: 'idle', lastEvent: { name: 'session-start', at: launchStartedAt + 1, seq: 1 } } });

    await expect(waitForAgentReady(agentTab(), { launchStartedAt, pollMs: 10, timeoutMs: 1_000 })).resolves.toBe(true);
    expect(mocks.statusManager.getAllForClient).toHaveBeenCalledTimes(3);
  });

  it('does not trust idle without a session-start event', async () => {
    mocks.statusManager.getAllForClient.mockReturnValue({ 'tab-a': { cliState: 'idle', lastEvent: null } });

    await expect(waitForAgentReady(agentTab(), { launchStartedAt, timeoutMs: 50, pollMs: 10 })).resolves.toBe(false);
  });

  it('does not trust a session-start from before the launch', async () => {
    mocks.statusManager.getAllForClient.mockReturnValue({
      'tab-a': { cliState: 'idle', lastEvent: { name: 'session-start', at: launchStartedAt - 1, seq: 1 } },
    });

    await expect(waitForAgentReady(agentTab(), { launchStartedAt, timeoutMs: 50, pollMs: 10 })).resolves.toBe(false);
  });
});

describe('launchAgentAfterShellReady', () => {
  it('launches the agent after the shell delay and returns the result', async () => {
    vi.useFakeTimers();
    mocks.launchAgentInTab.mockResolvedValue({ ok: false, code: 'agent-unavailable' });

    const pending = launchAgentAfterShellReady({ workspaceId: 'ws-a', paneId: 'pane-a', tabId: 'tab-a' });
    await vi.advanceTimersByTimeAsync(499);
    expect(mocks.launchAgentInTab).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toEqual({ ok: false, code: 'agent-unavailable' });
    expect(mocks.launchAgentInTab).toHaveBeenCalledWith({
      workspaceId: 'ws-a',
      paneId: 'pane-a',
      tabId: 'tab-a',
      action: 'launch',
    });
  });
});

describe('createWorkspaceTab', () => {
  beforeEach(() => {
    mocks.supervisor.createTerminalTab.mockResolvedValue({
      id: 'tab-runtime',
      sessionName: 'rtv2-ws-a-pane-a-tab-runtime',
      name: '',
      order: 0,
      cwd: '/repo',
      panelType: 'terminal',
      runtimeVersion: 2,
      lifecycleState: 'ready',
    });
    mocks.addExistingTabToPane.mockImplementation(async (_ws: string, _pane: string, tab: ITab) => ({ ...tab, order: 1 }));
    mocks.addTabToPane.mockResolvedValue(agentTab({ id: 'tab-new', sessionName: 'pt-ws-a-pane-a-tab-new' }));
  });

  it('restores the active tab read before creating a v2 tab with activate false', async () => {
    vi.stubEnv('AGENTMUX_RUNTIME_TERMINAL_V2_MODE', 'new-tabs');
    mocks.readLayoutFile.mockResolvedValue(paneLayout([agentTab({ id: 'tab-user' })], 'tab-user'));

    const tab = await createWorkspaceTab({
      workspaceId: 'ws-a',
      paneId: 'pane-a',
      panelType: 'terminal',
      activate: false,
      createdByTabId: 'tab-caller',
    });

    expect(tab).toMatchObject({ id: 'tab-runtime', runtimeVersion: 2 });
    expect(mocks.addExistingTabToPane).toHaveBeenCalledWith(
      'ws-a',
      'pane-a',
      expect.objectContaining({ id: 'tab-runtime', runtimeVersion: 2 }),
      { activate: false, createdByTabId: 'tab-caller', restoreActiveTabId: 'tab-user' },
    );
    expect(mocks.readLayoutFile.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.supervisor.createTerminalTab.mock.invocationCallOrder[0]);
    expect(mocks.addTabToPane).not.toHaveBeenCalled();
  });

  it('passes the activation and creator options to a v1 agent tab', async () => {
    vi.stubEnv('AGENTMUX_RUNTIME_TERMINAL_V2_MODE', 'new-tabs');

    await createWorkspaceTab({
      workspaceId: 'ws-a',
      paneId: 'pane-a',
      panelType: 'claude',
      activate: false,
      createdByTabId: 'tab-caller',
    });

    expect(mocks.addTabToPane).toHaveBeenCalledWith(
      'ws-a',
      'pane-a',
      undefined,
      '/repo',
      'claude',
      undefined,
      { activate: false, createdByTabId: 'tab-caller' },
    );
    expect(mocks.supervisor.createTerminalTab).not.toHaveBeenCalled();
  });

  it('creates plain terminal tabs through Runtime v2 in terminal v2 mode', async () => {
    vi.stubEnv('AGENTMUX_RUNTIME_TERMINAL_V2_MODE', 'new-tabs');

    const tab = await createWorkspaceTab({ workspaceId: 'ws-a', paneId: 'pane-a' });

    expect(tab).toMatchObject({ id: 'tab-runtime', runtimeVersion: 2 });
    expect(mocks.supervisor.createTerminalTab).toHaveBeenCalled();
    expect(mocks.addTabToPane).not.toHaveBeenCalled();
    expect(mocks.readLayoutFile).not.toHaveBeenCalled();
  });

  it('registers the new tab in the status manager outside status live mode', async () => {
    await createWorkspaceTab({ workspaceId: 'ws-a', paneId: 'pane-a', panelType: 'claude' });

    expect(mocks.statusManager.registerTab).toHaveBeenCalledWith('tab-new', expect.objectContaining({
      cliState: 'inactive',
      workspaceId: 'ws-a',
      panelType: 'claude',
    }));
  });
});

describe('closeWorkspaceTab', () => {
  it('removes the Runtime v2 live status entry in status live mode', async () => {
    vi.stubEnv('AGENTMUX_RUNTIME_STATUS_V2_MODE', 'default');
    mocks.removeTabFromPane.mockResolvedValue(true);

    await expect(closeWorkspaceTab('ws-a', 'pane-a', 'tab-a')).resolves.toBe(true);
    expect(mocks.removeTabFromPane).toHaveBeenCalledWith('ws-a', 'pane-a', 'tab-a');
    expect(mocks.supervisor.removeStatusLiveTab).toHaveBeenCalledWith({ tabId: 'tab-a' });
    expect(mocks.statusManager.removeTab).not.toHaveBeenCalled();
  });

  it('removes the status manager entry outside status live mode', async () => {
    mocks.removeTabFromPane.mockResolvedValue(true);

    await expect(closeWorkspaceTab('ws-a', 'pane-a', 'tab-a')).resolves.toBe(true);
    expect(mocks.statusManager.removeTab).toHaveBeenCalledWith('tab-a');
    expect(mocks.getRuntimeSupervisor).not.toHaveBeenCalled();
  });

  it('returns false and keeps the status entry when the tab is missing', async () => {
    mocks.removeTabFromPane.mockResolvedValue(false);

    await expect(closeWorkspaceTab('ws-a', 'pane-a', 'tab-a')).resolves.toBe(false);
    expect(mocks.statusManager.removeTab).not.toHaveBeenCalled();
  });
});

describe('tab lookup', () => {
  it('finds a tab in any workspace', async () => {
    const target = agentTab({ id: 'tab-b', sessionName: 'pt-ws-b-pane-b-tab-b' });
    mocks.getWorkspaces.mockResolvedValue({ workspaces: [{ id: 'ws-a' }, { id: 'ws-b' }] });
    mocks.getLayout.mockImplementation(async (workspaceId: string) => (workspaceId === 'ws-b'
      ? { ...paneLayout([target], 'tab-b'), root: { type: 'pane', id: 'pane-b', tabs: [target], activeTabId: 'tab-b' } }
      : paneLayout([agentTab()], 'tab-a')));

    await expect(findTabInAnyWorkspace('tab-b')).resolves.toEqual({ workspaceId: 'ws-b', paneId: 'pane-b', tab: target });
    await expect(findTabInAnyWorkspace('tab-missing')).resolves.toBeNull();
  });

  it('counts the tabs an agent created in a workspace', async () => {
    mocks.getLayout.mockResolvedValue({
      root: {
        type: 'split',
        orientation: 'horizontal',
        ratio: 50,
        children: [
          { type: 'pane', id: 'pane-a', activeTabId: 'tab-a', tabs: [agentTab(), agentTab({ id: 'tab-d1', createdByTabId: 'tab-a' })] },
          { type: 'pane', id: 'pane-b', activeTabId: null, tabs: [agentTab({ id: 'tab-d2', createdByTabId: 'tab-x' }), agentTab({ id: 'tab-u', createdByTabId: null })] },
        ],
      },
      activePaneId: 'pane-a',
      updatedAt: '2026-11-11T00:00:00.000Z',
    });

    await expect(countDelegatedTabs('ws-a')).resolves.toBe(2);
    expect(mocks.getLayout).toHaveBeenCalledWith('ws-a');
  });
});

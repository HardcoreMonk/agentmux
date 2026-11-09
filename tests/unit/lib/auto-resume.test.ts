import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IAgentProvider } from '@/lib/providers';

const hasSessionMock = vi.hoisted(() => vi.fn<() => Promise<boolean>>());
const createSessionMock = vi.hoisted(() => vi.fn<() => Promise<void>>());
const getPaneCurrentCommandMock = vi.hoisted(() => vi.fn<() => Promise<string | null>>());
const sendKeysMock = vi.hoisted(() => vi.fn<() => Promise<void>>());
const listSessionsMock = vi.hoisted(() => vi.fn<() => Promise<string[]>>());
const killServerMock = vi.hoisted(() => vi.fn<() => Promise<void>>());
const scanSessionsMock = vi.hoisted(() => vi.fn<() => Promise<void>>());
const applyConfigMock = vi.hoisted(() => vi.fn<() => Promise<void>>());
const initWorkspaceStoreMock = vi.hoisted(() => vi.fn<() => Promise<void>>());
const getWorkspacesMock = vi.hoisted(() => vi.fn());
const readLayoutFileMock = vi.hoisted(() => vi.fn());
const resolveLayoutFileMock = vi.hoisted(() => vi.fn((id: string) => `/tmp/${id}.json`));
const collectAllTabsMock = vi.hoisted(() => vi.fn());
const rescanMock = vi.hoisted(() => vi.fn<() => Promise<void>>());

vi.mock('@/lib/tmux', () => ({
  hasSession: hasSessionMock,
  createSession: createSessionMock,
  getPaneCurrentCommand: getPaneCurrentCommandMock,
  sendKeys: sendKeysMock,
  listSessions: listSessionsMock,
  killServer: killServerMock,
  scanSessions: scanSessionsMock,
  applyConfig: applyConfigMock,
}));

vi.mock('@/lib/workspace-store', () => ({
  initWorkspaceStore: initWorkspaceStoreMock,
  getWorkspaces: getWorkspacesMock,
}));

vi.mock('@/lib/layout-store', () => ({
  readLayoutFile: readLayoutFileMock,
  resolveLayoutFile: resolveLayoutFileMock,
  collectAllTabs: collectAllTabsMock,
}));

vi.mock('@/lib/status-manager', () => ({
  getStatusManager: () => ({
    rescan: rescanMock,
  }),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const makeFakeProvider = (): IAgentProvider => ({
  id: 'codex',
  displayName: 'Codex',
  panelType: 'codex',
  statusBehavior: {
    watchJsonlWhenBound: true,
    deferStopHookUntilJsonlIdle: true,
  },
  readSessionId: (tab: { agentSessionId?: string | null }) => tab.agentSessionId ?? null,
  buildLaunchCommand: vi.fn(async () => 'codex'),
  buildResumeCommand: vi.fn(async (sessionId: string) => `codex resume ${sessionId}`),
} as unknown as IAgentProvider);

describe('executeAutoResume and autoResumeOnStartup', () => {
  beforeEach(() => {
    hasSessionMock.mockReset();
    createSessionMock.mockReset();
    getPaneCurrentCommandMock.mockReset();
    sendKeysMock.mockReset();
    listSessionsMock.mockReset();
    killServerMock.mockReset();
    scanSessionsMock.mockReset();
    applyConfigMock.mockReset();
    initWorkspaceStoreMock.mockReset();
    getWorkspacesMock.mockReset();
    readLayoutFileMock.mockReset();
    collectAllTabsMock.mockReset();
    rescanMock.mockReset();

    createSessionMock.mockResolvedValue(undefined);
    getPaneCurrentCommandMock.mockResolvedValue('bash');
    sendKeysMock.mockResolvedValue(undefined);
  });

  const makeTargets = () => {
    const provider = makeFakeProvider();
    return [
      {
        workspaceId: 'ws-1',
        tabId: 'tab-1',
        tmuxSession: 'pt-ws-1-p-1-tab-1',
        sessionId: 'sess-1',
        provider,
      },
      {
        workspaceId: 'ws-1',
        tabId: 'tab-2',
        tmuxSession: 'pt-ws-1-p-1-tab-2',
        sessionId: 'sess-2',
        provider,
      },
      {
        workspaceId: 'ws-1',
        tabId: 'tab-3',
        tmuxSession: 'pt-ws-1-p-1-tab-3',
        sessionId: 'sess-3',
        provider,
      },
    ];
  };

  it('resumes only the missing session when 2 of 3 targets were in preexistingSessions (Review Focus 5)', async () => {
    const { executeAutoResume } = await import('@/lib/auto-resume');
    const targets = makeTargets();
    const preexisting = new Set(['pt-ws-1-p-1-tab-1', 'pt-ws-1-p-1-tab-2']);

    hasSessionMock.mockImplementation((async (name: string) => preexisting.has(name)) as unknown as () => Promise<boolean>);

    const result = await executeAutoResume(targets, preexisting);

    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(createSessionMock).toHaveBeenCalledWith('pt-ws-1-p-1-tab-3', 80, 24);
    expect(sendKeysMock).toHaveBeenCalledTimes(1);
    expect(sendKeysMock).toHaveBeenCalledWith('pt-ws-1-p-1-tab-3', 'codex resume sess-3');
    expect(result).toEqual({
      created: ['pt-ws-1-p-1-tab-3'],
      resumed: ['pt-ws-1-p-1-tab-3'],
    });
  });

  it('resumes all 3 targets when all sessions already exist from crossCheckLayout but preexistingSessions is empty (reboot path)', async () => {
    const { executeAutoResume } = await import('@/lib/auto-resume');
    const targets = makeTargets();

    hasSessionMock.mockResolvedValue(true);

    const result = await executeAutoResume(targets, new Set());

    expect(createSessionMock).not.toHaveBeenCalled();
    expect(sendKeysMock).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      created: [],
      resumed: [
        'pt-ws-1-p-1-tab-1',
        'pt-ws-1-p-1-tab-2',
        'pt-ws-1-p-1-tab-3',
      ],
    });
  });

  it('sends no resume commands when all targets were in preexistingSessions', async () => {
    const { executeAutoResume } = await import('@/lib/auto-resume');
    const targets = makeTargets();
    const preexisting = new Set([
      'pt-ws-1-p-1-tab-1',
      'pt-ws-1-p-1-tab-2',
      'pt-ws-1-p-1-tab-3',
    ]);

    hasSessionMock.mockResolvedValue(true);

    const result = await executeAutoResume(targets, preexisting);

    expect(createSessionMock).not.toHaveBeenCalled();
    expect(sendKeysMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      created: [],
      resumed: [],
    });
  });

  it('excludes targets skipped because the provider process is already running from resumed list', async () => {
    const { executeAutoResume } = await import('@/lib/auto-resume');
    const targets = makeTargets().slice(0, 2);

    hasSessionMock.mockResolvedValue(true);
    getPaneCurrentCommandMock
      .mockResolvedValueOnce('codex')
      .mockResolvedValueOnce('bash');

    const result = await executeAutoResume(targets, new Set());

    expect(sendKeysMock).toHaveBeenCalledTimes(1);
    expect(sendKeysMock).toHaveBeenCalledWith('pt-ws-1-p-1-tab-2', 'codex resume sess-2');
    expect(result).toEqual({
      created: [],
      resumed: ['pt-ws-1-p-1-tab-2'],
    });
  });

  it('passes an empty preexistingSessions set in /api/tmux/reset', async () => {
    const autoResumeModule = await import('@/lib/auto-resume');
    const autoResumeSpy = vi
      .spyOn(autoResumeModule, 'autoResumeOnStartup')
      .mockResolvedValue(undefined);
    listSessionsMock.mockResolvedValue(['pt-ws-1-p-1-tab-1']);
    killServerMock.mockResolvedValue(undefined);
    scanSessionsMock.mockResolvedValue(undefined);
    applyConfigMock.mockResolvedValue(undefined);
    initWorkspaceStoreMock.mockResolvedValue(undefined);
    rescanMock.mockResolvedValue(undefined);

    const { default: resetHandler } = await import('@/pages/api/tmux/reset');
    const statusJson = vi.fn();
    const res = {
      setHeader: vi.fn(),
      status: vi.fn(() => ({ json: statusJson })),
    } as unknown as NextApiResponse;

    await resetHandler({ method: 'POST' } as NextApiRequest, res);

    expect(autoResumeSpy).toHaveBeenCalledTimes(1);
    const passedArg = autoResumeSpy.mock.calls[0]?.[0] as { preexistingSessions?: ReadonlySet<string> } | undefined;
    expect(passedArg?.preexistingSessions).toBeInstanceOf(Set);
    expect(passedArg?.preexistingSessions?.size).toBe(0);
    autoResumeSpy.mockRestore();
  });
});

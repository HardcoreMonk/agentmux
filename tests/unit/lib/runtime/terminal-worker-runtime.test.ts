import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TAdoptResult } from '@/lib/tmux-server-scope';

const execFileMock = vi.hoisted(() => vi.fn());
const ptySpawnMock = vi.hoisted(() => vi.fn());
const resolveRuntimeTmuxConfigPathMock = vi.hoisted(() => vi.fn(() => '/repo/src/config/tmux.conf'));
const shouldIsolateTmuxServerMock = vi.hoisted(() => vi.fn(() => false));
const adoptTmuxServerIntoScopeMock = vi.hoisted(() =>
  vi.fn<() => Promise<TAdoptResult>>(async () => ({ status: 'adopted', pid: 1234 })),
);

vi.mock('child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('node-pty', () => ({
  spawn: ptySpawnMock,
}));

vi.mock('@/lib/runtime/worker-paths', () => ({
  resolveRuntimeTmuxConfigPath: resolveRuntimeTmuxConfigPathMock,
}));

vi.mock('@/lib/tmux-server-scope', () => ({
  shouldIsolateTmuxServer: shouldIsolateTmuxServerMock,
  adoptTmuxServerIntoScope: adoptTmuxServerIntoScopeMock,
}));

vi.mock('@/lib/shell-env', () => ({
  buildShellEnv: vi.fn(() => ({ HOME: '/home/test', TERM: 'xterm-256color' })),
  buildShellLaunchCommand: vi.fn(() => 'env -i /bin/bash -l'),
}));

vi.mock('@/lib/pristine-env', () => ({
  PRISTINE_ENV: { HOME: '/home/test' },
}));

const execFileSuccess = (): void => {
  execFileMock.mockImplementation((_cmd, _args, _options, callback) => {
    callback(null, '', '');
  });
};

const execFileFailure = (message: string): void => {
  execFileMock.mockImplementation((_cmd, _args, _options, callback) => {
    callback(new Error(message), '', '');
  });
};

const createFakePty = () => {
  let exitHandler: (() => void) | null = null;
  let dataHandler: ((data: string) => void) | null = null;
  return {
    onData: vi.fn((onData: (data: string) => void) => {
      dataHandler = onData;
      return { dispose: vi.fn() };
    }),
    onExit: vi.fn((handler: () => void) => {
      exitHandler = handler;
      return { dispose: vi.fn() };
    }),
    emitData: (data: string) => dataHandler?.(data),
    emitExit: () => exitHandler?.(),
    kill: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
  };
};

describe('terminal worker runtime', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    ptySpawnMock.mockReset();
    resolveRuntimeTmuxConfigPathMock.mockReset();
    shouldIsolateTmuxServerMock.mockReset();
    adoptTmuxServerIntoScopeMock.mockReset();
    resolveRuntimeTmuxConfigPathMock.mockReturnValue('/repo/src/config/tmux.conf');
    shouldIsolateTmuxServerMock.mockReturnValue(false);
    adoptTmuxServerIntoScopeMock.mockResolvedValue({ status: 'adopted', pid: 1234 });
    execFileSuccess();
  });

  it('continues session creation when tmux server scope adoption fails (Review Focus 3)', async () => {
    shouldIsolateTmuxServerMock.mockReturnValue(true);
    adoptTmuxServerIntoScopeMock.mockResolvedValue({
      status: 'failed',
      pid: 1234,
      reason: 'busctl failed',
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { createTerminalWorkerRuntime } = await import('@/lib/runtime/terminal/terminal-worker-runtime');
    const runtime = createTerminalWorkerRuntime();

    await expect(
      runtime.createSession({
        sessionName: 'rtv2-ws-a-pane-b-tab-c',
        cols: 80,
        rows: 24,
      }),
    ).resolves.toEqual({ sessionName: 'rtv2-ws-a-pane-b-tab-c' });

    expect(adoptTmuxServerIntoScopeMock).toHaveBeenCalledWith('codexmux-runtime-v2');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('codexmux-runtime-v2'));
    warnSpy.mockRestore();
  });

  it('cleans up partial creates and preserves source-file failure', async () => {
    const { createTerminalWorkerRuntime } = await import('@/lib/runtime/terminal/terminal-worker-runtime');
    execFileMock
      .mockImplementationOnce((_cmd, _args, _options, callback) => callback(null, '', ''))
      .mockImplementationOnce((_cmd, _args, _options, callback) => callback(new Error('source failed'), '', ''))
      .mockImplementationOnce((_cmd, _args, _options, callback) => callback(new Error('kill failed'), '', ''));

    const runtime = createTerminalWorkerRuntime();

    await expect(runtime.createSession({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      cols: 80,
      rows: 24,
    })).rejects.toMatchObject({
      code: 'runtime-v2-tmux-config-source-failed',
      retryable: false,
      message: expect.stringContaining('source failed'),
    });
    expect(execFileMock.mock.calls.map((call) => call[1])).toEqual([
      expect.arrayContaining(['new-session']),
      expect.arrayContaining(['source-file', '/repo/src/config/tmux.conf']),
      expect.arrayContaining(['kill-session', '-t', 'rtv2-ws-a-pane-b-tab-c']),
    ]);
  });

  it('surfaces missing runtime tmux config errors', async () => {
    const missing = Object.assign(new Error('Runtime v2 tmux config is missing'), {
      code: 'runtime-v2-tmux-config-missing',
      retryable: false,
    });
    resolveRuntimeTmuxConfigPathMock.mockImplementation(() => {
      throw missing;
    });
    const { createTerminalWorkerRuntime } = await import('@/lib/runtime/terminal/terminal-worker-runtime');
    const runtime = createTerminalWorkerRuntime();

    await expect(runtime.createSession({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      cols: 80,
      rows: 24,
    })).rejects.toMatchObject({
      code: 'runtime-v2-tmux-config-missing',
      retryable: false,
    });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('treats kill-session as best-effort cleanup', async () => {
    const { createTerminalWorkerRuntime } = await import('@/lib/runtime/terminal/terminal-worker-runtime');
    execFileFailure('session already gone');
    const runtime = createTerminalWorkerRuntime();

    await expect(runtime.killSession('rtv2-ws-a-pane-b-tab-c')).resolves.toEqual({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      killed: true,
    });
    expect(execFileMock).toHaveBeenCalledWith(
      'tmux',
      expect.arrayContaining(['-L', 'codexmux-runtime-v2', 'kill-session', '-t', 'rtv2-ws-a-pane-b-tab-c']),
      expect.objectContaining({ timeout: 5000 }),
      expect.any(Function),
    );
  });

  it('checks tmux session existence before spawning node-pty attach', async () => {
    const fakePty = createFakePty();
    ptySpawnMock.mockReturnValue(fakePty);
    const { createTerminalWorkerRuntime } = await import('@/lib/runtime/terminal/terminal-worker-runtime');
    const runtime = createTerminalWorkerRuntime();

    await expect(runtime.attach('rtv2-ws-a-pane-b-tab-c', 80, 24, () => undefined)).resolves.toEqual({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      attached: true,
    });

    expect(execFileMock).toHaveBeenCalledWith(
      'tmux',
      expect.arrayContaining(['-L', 'codexmux-runtime-v2', 'has-session', '-t', 'rtv2-ws-a-pane-b-tab-c']),
      expect.objectContaining({ timeout: 5000 }),
      expect.any(Function),
    );
    expect(ptySpawnMock).toHaveBeenCalledWith(
      'tmux',
      ['-u', '-L', 'codexmux-runtime-v2', 'attach-session', '-t', 'rtv2-ws-a-pane-b-tab-c'],
      expect.objectContaining({ cols: 80, rows: 24 }),
    );
    expect(execFileMock.mock.invocationCallOrder[0]).toBeLessThan(ptySpawnMock.mock.invocationCallOrder[0]);
  });

  it('removes stale pty attachments when the attach process exits', async () => {
    const firstPty = createFakePty();
    const secondPty = createFakePty();
    ptySpawnMock
      .mockReturnValueOnce(firstPty)
      .mockReturnValueOnce(secondPty);
    const { createTerminalWorkerRuntime } = await import('@/lib/runtime/terminal/terminal-worker-runtime');
    const runtime = createTerminalWorkerRuntime();

    await runtime.attach('rtv2-ws-a-pane-b-tab-c', 80, 24, () => undefined);
    firstPty.emitExit();
    await runtime.attach('rtv2-ws-a-pane-b-tab-c', 100, 30, () => undefined);

    expect(ptySpawnMock).toHaveBeenCalledTimes(2);
    expect(ptySpawnMock.mock.calls[1]).toEqual([
      'tmux',
      ['-u', '-L', 'codexmux-runtime-v2', 'attach-session', '-t', 'rtv2-ws-a-pane-b-tab-c'],
      expect.objectContaining({ cols: 100, rows: 30 }),
    ]);
  });

  it('rejects missing tmux sessions before spawning node-pty', async () => {
    execFileFailure('missing session');
    const { createTerminalWorkerRuntime } = await import('@/lib/runtime/terminal/terminal-worker-runtime');
    const runtime = createTerminalWorkerRuntime();

    await expect(runtime.attach('rtv2-ws-a-pane-b-tab-c', 80, 24, () => undefined)).rejects.toMatchObject({
      code: 'runtime-v2-terminal-session-not-found',
      retryable: false,
      message: expect.stringContaining('missing session'),
    });
    expect(ptySpawnMock).not.toHaveBeenCalled();
  });

  it('checks tmux session presence without spawning node-pty', async () => {
    const { createTerminalWorkerRuntime } = await import('@/lib/runtime/terminal/terminal-worker-runtime');
    const runtime = createTerminalWorkerRuntime();

    await expect(runtime.hasSession('rtv2-ws-a-pane-b-tab-c')).resolves.toEqual({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      exists: true,
    });

    expect(execFileMock).toHaveBeenCalledWith(
      'tmux',
      expect.arrayContaining(['-L', 'codexmux-runtime-v2', 'has-session', '-t', 'rtv2-ws-a-pane-b-tab-c']),
      expect.objectContaining({ timeout: 5000 }),
      expect.any(Function),
    );
    expect(ptySpawnMock).not.toHaveBeenCalled();
  });

  it('captures pane content and sends text without attaching a pty', async () => {
    execFileMock.mockImplementation((_cmd, _args, _options, callback) => {
      callback(null, { stdout: 'screen text', stderr: '' });
    });
    const { createTerminalWorkerRuntime } = await import('@/lib/runtime/terminal/terminal-worker-runtime');
    const runtime = createTerminalWorkerRuntime();

    await expect(runtime.capturePane('rtv2-ws-a-pane-b-tab-c')).resolves.toEqual({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      content: 'screen text',
    });
    await expect(runtime.sendText('rtv2-ws-a-pane-b-tab-c', 'echo p4', true)).resolves.toEqual({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      sent: true,
    });

    const calls = execFileMock.mock.calls.map((call) => call[1]);
    expect(calls).toEqual([
      ['-L', 'codexmux-runtime-v2', 'capture-pane', '-p', '-t', 'rtv2-ws-a-pane-b-tab-c'],
      ['-L', 'codexmux-runtime-v2', 'send-keys', '-t', 'rtv2-ws-a-pane-b-tab-c', '-l', 'echo p4'],
      ['-L', 'codexmux-runtime-v2', 'send-keys', '-t', 'rtv2-ws-a-pane-b-tab-c', 'Enter'],
    ]);
    expect(ptySpawnMock).not.toHaveBeenCalled();
  });

  it('skips Enter when enter is false and maps a missing session to not-found', async () => {
    execFileSuccess();
    const { createTerminalWorkerRuntime } = await import('@/lib/runtime/terminal/terminal-worker-runtime');
    const runtime = createTerminalWorkerRuntime();
    await runtime.sendText('rtv2-ws-a-pane-b-tab-c', 'x', false);
    expect(execFileMock).toHaveBeenCalledTimes(1);

    execFileFailure("can't find session: rtv2-ws-a-pane-b-tab-c");
    await expect(runtime.capturePane('rtv2-ws-a-pane-b-tab-c')).rejects.toMatchObject({
      code: 'runtime-v2-terminal-session-not-found',
    });
    await expect(runtime.sendText('rtv2-ws-a-pane-b-tab-c', 'x', true)).rejects.toMatchObject({
      code: 'runtime-v2-terminal-session-not-found',
    });
  });

  it('returns false for missing tmux session presence checks', async () => {
    execFileFailure("can't find session");
    const { createTerminalWorkerRuntime } = await import('@/lib/runtime/terminal/terminal-worker-runtime');
    const runtime = createTerminalWorkerRuntime();

    await expect(runtime.hasSession('rtv2-ws-a-pane-b-tab-c')).resolves.toEqual({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      exists: false,
    });
    expect(ptySpawnMock).not.toHaveBeenCalled();
  });

  it('preserves unexpected tmux session presence failures', async () => {
    execFileFailure('permission denied');
    const { createTerminalWorkerRuntime } = await import('@/lib/runtime/terminal/terminal-worker-runtime');
    const runtime = createTerminalWorkerRuntime();

    await expect(runtime.hasSession('rtv2-ws-a-pane-b-tab-c')).rejects.toMatchObject({
      code: 'runtime-v2-terminal-presence-check-failed',
      retryable: false,
      message: expect.stringContaining('permission denied'),
    });
  });

  it('returns optional terminal runtime metadata for tmux sessions', async () => {
    execFileMock
      .mockImplementationOnce((_cmd, _args, _options, callback) => callback(null, '', ''))
      .mockImplementationOnce((_cmd, _args, _options, callback) => callback(
        null,
        { stdout: '/work/project\tbash\t4242\t1790000000\n', stderr: '' },
      ));
    const { createTerminalWorkerRuntime } = await import('@/lib/runtime/terminal/terminal-worker-runtime');
    const runtime = createTerminalWorkerRuntime();

    await expect(runtime.getSessionInfo?.('rtv2-ws-a-pane-b-tab-c')).resolves.toEqual({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      exists: true,
      cwd: '/work/project',
      command: 'bash',
      pid: 4242,
      startedAt: 1790000000000,
      metadataSource: 'terminal-runtime',
    });
  });

  it('satisfies the terminal runtime contract with mocked tmux and node-pty', async () => {
    const fakePty = createFakePty();
    ptySpawnMock.mockReturnValue(fakePty);
    const { createTerminalWorkerRuntime } = await import('@/lib/runtime/terminal/terminal-worker-runtime');
    const runtime = createTerminalWorkerRuntime();
    const seen: string[] = [];

    await expect(runtime.createSession({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      cols: 80,
      rows: 24,
      cwd: '/work/project',
    })).resolves.toEqual({ sessionName: 'rtv2-ws-a-pane-b-tab-c' });

    await expect(runtime.attach('rtv2-ws-a-pane-b-tab-c', 80, 24, (data) => {
      seen.push(data);
    })).resolves.toEqual({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      attached: true,
    });

    fakePty.emitData('ready\n');
    await expect(runtime.writeStdin('rtv2-ws-a-pane-b-tab-c', 'pwd\n')).resolves.toEqual({ written: 4 });
    await expect(runtime.resize('rtv2-ws-a-pane-b-tab-c', 100, 30)).resolves.toEqual({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      cols: 100,
      rows: 30,
    });
    await expect(runtime.hasSession('rtv2-ws-a-pane-b-tab-c')).resolves.toEqual({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      exists: true,
    });
    await expect(runtime.detach('rtv2-ws-a-pane-b-tab-c')).resolves.toEqual({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      detached: true,
    });
    await expect(runtime.killSession('rtv2-ws-a-pane-b-tab-c')).resolves.toEqual({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      killed: true,
    });

    expect(seen).toEqual(['ready\n']);
    expect(fakePty.write).toHaveBeenCalledWith('pwd\n');
    expect(fakePty.resize).toHaveBeenCalledWith(100, 30);
  });
});

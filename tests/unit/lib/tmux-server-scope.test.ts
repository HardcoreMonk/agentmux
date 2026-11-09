import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adoptTmuxServerIntoScope,
  ensureTmuxServerIsolation,
  shouldIsolateTmuxServer,
  tmuxScopeUnitName,
  type ITmuxScopeDeps,
} from '@/lib/tmux-server-scope';

const execFileMock = vi.hoisted(() => vi.fn());
const warnMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: warnMock,
    error: vi.fn(),
  }),
}));

describe('tmux-server-scope', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    warnMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('computes the transient scope unit name from the socket name', () => {
    expect(tmuxScopeUnitName('codexmux')).toBe('agentmux-tmux-codexmux.scope');
    expect(tmuxScopeUnitName('codexmux-runtime-v2')).toBe('agentmux-tmux-codexmux-runtime-v2.scope');
  });

  it('gates isolation on INVOCATION_ID, NODE_ENV=production, and AGENTMUX_TMUX_SCOPE !== off', () => {
    expect(shouldIsolateTmuxServer({})).toBe(false);
    expect(shouldIsolateTmuxServer({ INVOCATION_ID: 'x', NODE_ENV: 'production' })).toBe(true);
    expect(shouldIsolateTmuxServer({ INVOCATION_ID: 'x', NODE_ENV: 'test' })).toBe(false);
    expect(
      shouldIsolateTmuxServer({
        INVOCATION_ID: 'x',
        NODE_ENV: 'production',
        AGENTMUX_TMUX_SCOPE: 'off',
      }),
    ).toBe(false);
  });

  it('returns skipped when the tmux server is not running', async () => {
    const deps: ITmuxScopeDeps = {
      getServerPid: vi.fn(async () => null),
      readCgroup: vi.fn(),
      startTransientScope: vi.fn(),
    };

    await expect(adoptTmuxServerIntoScope('codexmux', deps)).resolves.toEqual({
      status: 'skipped',
      reason: 'no-server',
    });
    expect(deps.readCgroup).not.toHaveBeenCalled();
    expect(deps.startTransientScope).not.toHaveBeenCalled();
  });

  it('returns already-isolated without calling startTransientScope when cgroup already ends with unit', async () => {
    const deps: ITmuxScopeDeps = {
      getServerPid: vi.fn(async () => 4321),
      readCgroup: vi.fn(
        async () => '/user.slice/user-1000.slice/user@1000.service/app.slice/agentmux-tmux-codexmux.scope',
      ),
      startTransientScope: vi.fn(),
    };

    await expect(adoptTmuxServerIntoScope('codexmux', deps)).resolves.toEqual({
      status: 'already-isolated',
      pid: 4321,
    });
    expect(deps.startTransientScope).not.toHaveBeenCalled();
  });

  it('starts the transient scope and polls until cgroup reflects the new scope', async () => {
    const readCgroup = vi
      .fn<ITmuxScopeDeps['readCgroup']>()
      .mockResolvedValueOnce('/user.slice/user-1000.slice/user@1000.service/app.slice/codexmux.service')
      .mockResolvedValueOnce('/user.slice/user-1000.slice/user@1000.service/app.slice/codexmux.service')
      .mockResolvedValueOnce(
        '/user.slice/user-1000.slice/user@1000.service/app.slice/agentmux-tmux-codexmux.scope',
      );
    const startTransientScope = vi.fn<ITmuxScopeDeps['startTransientScope']>(async () => undefined);

    const result = await adoptTmuxServerIntoScope('codexmux', {
      getServerPid: async () => 5678,
      readCgroup,
      startTransientScope,
    });

    expect(result).toEqual({
      status: 'adopted',
      pid: 5678,
    });
    expect(startTransientScope).toHaveBeenCalledWith('agentmux-tmux-codexmux.scope', 5678);
    expect(readCgroup).toHaveBeenCalledTimes(3);
  });

  it('returns already-isolated when startTransientScope rejects because another caller already isolated it', async () => {
    const readCgroup = vi
      .fn<ITmuxScopeDeps['readCgroup']>()
      .mockResolvedValueOnce('/user.slice/user-1000.slice/user@1000.service/app.slice/codexmux.service')
      .mockResolvedValueOnce(
        '/user.slice/user-1000.slice/user@1000.service/app.slice/agentmux-tmux-codexmux.scope',
      );
    const startTransientScope = vi.fn<ITmuxScopeDeps['startTransientScope']>(async () => {
      throw new Error('Unit agentmux-tmux-codexmux.scope already exists');
    });

    await expect(
      adoptTmuxServerIntoScope('codexmux', {
        getServerPid: async () => 5678,
        readCgroup,
        startTransientScope,
      }),
    ).resolves.toEqual({
      status: 'already-isolated',
      pid: 5678,
    });
  });

  it('returns failed with reason when startTransientScope rejects and cgroup is unchanged', async () => {
    const readCgroup = vi
      .fn<ITmuxScopeDeps['readCgroup']>()
      .mockResolvedValue('/user.slice/user-1000.slice/user@1000.service/app.slice/codexmux.service');
    const startTransientScope = vi.fn<ITmuxScopeDeps['startTransientScope']>(async () => {
      throw new Error('busctl unavailable');
    });

    await expect(
      adoptTmuxServerIntoScope('codexmux', {
        getServerPid: async () => 5678,
        readCgroup,
        startTransientScope,
      }),
    ).resolves.toEqual({
      status: 'failed',
      pid: 5678,
      reason: 'busctl unavailable',
    });
  });

  it('returns failed when startTransientScope resolves but cgroup does not change within 5 seconds', async () => {
    vi.useFakeTimers();
    const readCgroup = vi
      .fn<ITmuxScopeDeps['readCgroup']>()
      .mockResolvedValue('/user.slice/user-1000.slice/user@1000.service/app.slice/codexmux.service');
    const startTransientScope = vi.fn<ITmuxScopeDeps['startTransientScope']>(async () => undefined);

    const promise = adoptTmuxServerIntoScope('codexmux', {
      getServerPid: async () => 9999,
      readCgroup,
      startTransientScope,
    });

    await vi.advanceTimersByTimeAsync(5_500);
    const result = await promise;

    expect(result.status).toBe('failed');
    expect(result.pid).toBe(9999);
    expect(result.reason).toContain('agentmux-tmux-codexmux.scope');
  });

  it('retries startTransientScope while the previous scope is still being cleaned up', async () => {
    vi.useFakeTimers();
    const readCgroup = vi
      .fn<ITmuxScopeDeps['readCgroup']>()
      .mockResolvedValueOnce('/app.slice/codexmux.service')
      .mockResolvedValueOnce('/app.slice/codexmux.service')
      .mockResolvedValueOnce('/app.slice/codexmux.service')
      .mockResolvedValueOnce('/app.slice/codexmux.service')
      .mockResolvedValue('/app.slice/agentmux-tmux-codexmux.scope');
    const startTransientScope = vi
      .fn<ITmuxScopeDeps['startTransientScope']>()
      .mockRejectedValueOnce(new Error('already exists'))
      .mockRejectedValueOnce(new Error('already exists'))
      .mockResolvedValueOnce(undefined);

    const promise = adoptTmuxServerIntoScope('codexmux', {
      getServerPid: async () => 5678,
      readCgroup,
      startTransientScope,
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(promise).resolves.toEqual({ status: 'adopted', pid: 5678 });
    expect(startTransientScope).toHaveBeenCalledTimes(3);
  });

  it('adopts both sockets in ensureTmuxServerIsolation when isolation is enabled', async () => {
    const startTransientScope = vi.fn<ITmuxScopeDeps['startTransientScope']>(async () => undefined);
    const deps: ITmuxScopeDeps = {
      getServerPid: vi.fn(async (socket) => (socket === 'codexmux' ? 111 : 222)),
      readCgroup: vi.fn(async (pid) =>
        pid === 111
          ? '/user.slice/agentmux-tmux-codexmux.scope'
          : '/user.slice/agentmux-tmux-codexmux-runtime-v2.scope',
      ),
      startTransientScope,
    };

    await expect(
      ensureTmuxServerIsolation(deps, { INVOCATION_ID: '1', NODE_ENV: 'production' }),
    ).resolves.toEqual([
      { status: 'already-isolated', pid: 111 },
      { status: 'already-isolated', pid: 222 },
    ]);
  });

  it('resolves createSession and logs a warning even when scope adoption fails (Review Focus 3)', async () => {
    vi.stubEnv('INVOCATION_ID', 'unit-1');
    vi.stubEnv('NODE_ENV', 'production');

    type TExecCallback = (err: Error | null, res: { stdout: string; stderr: string }) => void;
    execFileMock.mockImplementation((cmd: string, args: string[], _opts: unknown, cb?: TExecCallback) => {
      const callback = typeof _opts === 'function' ? (_opts as TExecCallback) : cb;
      if (cmd === 'tmux' && args.includes('display-message') && args.includes('#{pid}')) {
        callback?.(null, { stdout: '7777\n', stderr: '' });
        return;
      }
      if (cmd === 'busctl') {
        callback?.(new Error('busctl spawn failed'), { stdout: '', stderr: 'busctl spawn failed' });
        return;
      }
      callback?.(null, { stdout: '', stderr: '' });
    });

    const { createSession } = await import('@/lib/tmux');
    await expect(createSession('pt-ws-1', 80, 24, '/tmp')).resolves.toBeUndefined();
    expect(warnMock).toHaveBeenCalledWith(expect.stringContaining('codexmux'));
  });
});

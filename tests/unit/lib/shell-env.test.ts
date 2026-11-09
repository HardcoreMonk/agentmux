import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('shell-env TMUX_TMPDIR inheritance', () => {
  let originalPristineEnv: string | undefined;

  beforeEach(() => {
    originalPristineEnv = process.env.__CMUX_PRISTINE_ENV;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalPristineEnv === undefined) {
      delete process.env.__CMUX_PRISTINE_ENV;
    } else {
      process.env.__CMUX_PRISTINE_ENV = originalPristineEnv;
    }
    vi.resetModules();
  });

  it('includes TMUX_TMPDIR in buildShellEnv and buildShellLaunchCommand when present in PRISTINE_ENV', async () => {
    process.env.__CMUX_PRISTINE_ENV = JSON.stringify({
      HOME: '/tmp/test-home',
      PATH: '/usr/bin:/bin',
      SHELL: '/bin/bash',
      TMUX_TMPDIR: '/tmp/agentmux-vitest-tmux-isolated',
    });

    const { buildShellEnv, buildShellLaunchCommand } = await import('@/lib/shell-env');
    const env = buildShellEnv();
    const launchCmd = buildShellLaunchCommand();

    expect(env.TMUX_TMPDIR).toBe('/tmp/agentmux-vitest-tmux-isolated');
    expect(launchCmd).toContain("TMUX_TMPDIR='/tmp/agentmux-vitest-tmux-isolated'");
  });

  it('omits TMUX_TMPDIR when absent from PRISTINE_ENV', async () => {
    process.env.__CMUX_PRISTINE_ENV = JSON.stringify({
      HOME: '/tmp/test-home',
      PATH: '/usr/bin:/bin',
      SHELL: '/bin/bash',
    });

    const { buildShellEnv, buildShellLaunchCommand } = await import('@/lib/shell-env');
    const env = buildShellEnv();
    const launchCmd = buildShellLaunchCommand();

    expect('TMUX_TMPDIR' in env).toBe(false);
    expect(env.TMUX_TMPDIR).toBeUndefined();
    expect(launchCmd).not.toContain('TMUX_TMPDIR=');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  access: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: mocks.execFile,
  }),
}));
vi.mock('fs/promises', () => ({ access: mocks.access }));
vi.mock('@/lib/shell-env', () => ({
  buildShellEnv: () => ({}),
  defaultShell: () => '/bin/sh',
}));

import { MIN_CLAUDE_VERSION, checkClaudeTool, getRuntimePreflightStatus } from '@/lib/preflight';
import { isRuntimeOk } from '@/types/preflight';

const mockTools = (versions: Record<string, string | null>) => {
  mocks.execFile.mockImplementation(async (cmd: string, args: string[]) => {
    if (args[0] === '-ilc') return { stdout: '/usr/bin' };
    const version = versions[cmd];
    if (version === undefined || version === null) throw new Error('ENOENT');
    return { stdout: version };
  });
};

describe('per-provider runtime preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockRejectedValue(new Error('ENOENT'));
  });

  it('opens with Claude only when Codex is not installed', async () => {
    mockTools({ tmux: 'tmux 3.4', git: 'git version 2.44.0', claude: '2.1.322 (Claude Code)' });
    const status = await getRuntimePreflightStatus();
    expect(status.agents.claude?.compatible).toBe(true);
    expect(status.agents.codex?.installed).toBe(false);
    expect(isRuntimeOk(status)).toBe(true);
  });

  it('fails when no agent is installed', async () => {
    mockTools({ tmux: 'tmux 3.4', git: 'git version 2.44.0' });
    const status = await getRuntimePreflightStatus();
    expect(isRuntimeOk(status)).toBe(false);
  });

  it('marks Claude below the minimum version incompatible', async () => {
    mockTools({ claude: '1.9.0 (Claude Code)' });
    const claude = await checkClaudeTool();
    expect(claude).toMatchObject({ installed: true, compatible: false, minimumVersion: MIN_CLAUDE_VERSION });
  });

  it('reports a binary outside PATH through binaryPath', async () => {
    mockTools({});
    mocks.access.mockResolvedValue(undefined);
    const claude = await checkClaudeTool();
    expect(claude.installed).toBe(false);
    expect(claude.binaryPath).toMatch(/\.local\/bin$/);
  });
});

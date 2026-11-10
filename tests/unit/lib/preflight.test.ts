import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createTerminalRuntimePreflightStatus,
  isSemanticVersionAtLeast,
  parseToolSemanticVersion,
} from '@/lib/preflight';
import {
  isRuntimeOk,
  readRuntimeAgentStatus,
  readRuntimeTerminalName,
  readRuntimeTerminalStatus,
} from '@/types/preflight';
import type { IRuntimePreflightResult } from '@/types/preflight';

const readyBase = {
  tmux: { installed: true, compatible: true, version: '3.4' },
  git: { installed: true, version: '2.44.0' },
};

describe('preflight agent status', () => {
  it('uses the Codex agent runtime status', () => {
    const status: IRuntimePreflightResult = {
      ...readyBase,
      agent: { installed: true, version: '0.12.0' },
      agents: { codex: { installed: true, version: '0.12.0' } },
    };

    expect(readRuntimeAgentStatus(status)).toEqual(status.agent);
    expect(isRuntimeOk(status)).toBe(true);
  });

  it('fails runtime readiness when the Codex agent is missing', () => {
    const status: IRuntimePreflightResult = {
      ...readyBase,
      agent: { installed: false, version: null },
      agents: { codex: { installed: false, version: null } },
    };

    expect(readRuntimeAgentStatus(status)).toEqual(status.agent);
    expect(isRuntimeOk(status)).toBe(false);
  });

  it('accepts the Windows terminal runtime instead of requiring tmux on win32', () => {
    const status: IRuntimePreflightResult = {
      platform: 'win32',
      tmux: { installed: false, compatible: false, version: null },
      terminalRuntime: {
        adapter: 'windows',
        installed: true,
        compatible: true,
        version: null,
      },
      git: { installed: true, version: '2.44.0' },
      agent: { installed: true, version: '0.12.0' },
      agents: { codex: { installed: true, version: '0.12.0' } },
    };

    expect(readRuntimeTerminalStatus(status)).toEqual(status.terminalRuntime);
    expect(readRuntimeTerminalName(status)).toBe('Windows Terminal Runtime');
    expect(isRuntimeOk(status)).toBe(true);
  });

  it('fails Windows runtime readiness when the terminal runtime is unavailable', () => {
    const status: IRuntimePreflightResult = {
      platform: 'win32',
      tmux: { installed: false, compatible: false, version: null },
      terminalRuntime: {
        adapter: 'windows',
        installed: false,
        compatible: false,
        version: null,
      },
      git: { installed: true, version: '2.44.0' },
      agent: { installed: true, version: '0.12.0' },
      agents: { codex: { installed: true, version: '0.12.0' } },
    };

    expect(isRuntimeOk(status)).toBe(false);
  });

  it('builds platform terminal runtime status without changing the tmux compatibility field', () => {
    const missingTmux = { installed: false, compatible: false, version: null };
    const readyTmux = { installed: true, compatible: true, version: '3.4' };

    expect(createTerminalRuntimePreflightStatus({
      platform: 'win32',
      tmux: missingTmux,
    })).toEqual({
      adapter: 'windows',
      installed: true,
      compatible: true,
      version: null,
    });

    expect(createTerminalRuntimePreflightStatus({
      platform: 'linux',
      tmux: readyTmux,
    })).toEqual({
      adapter: 'tmux',
      installed: true,
      compatible: true,
      version: '3.4',
    });
  });

  it('parses semantic versions without trailing punctuation', () => {
    expect(parseToolSemanticVersion('git version 2.54.0.windows.1')).toBe('2.54.0');
    expect(parseToolSemanticVersion('codex-cli 0.128.0')).toBe('0.128.0');
    expect(parseToolSemanticVersion('tmux 3.4')).toBe('3.4');
  });

  it('requires Codex 0.144.1 or newer without using float comparison', () => {
    expect(isSemanticVersionAtLeast('0.144.1', '0.144.1')).toBe(true);
    expect(isSemanticVersionAtLeast('0.147.0', '0.144.1')).toBe(true);
    expect(isSemanticVersionAtLeast('0.99.0', '0.144.1')).toBe(false);
    expect(isSemanticVersionAtLeast(null, '0.144.1')).toBe(false);
  });
});

describe('getPreflightStatus agents', () => {
  const setup = async (files: string[]) => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const home = await mkdtemp(path.join(os.tmpdir(), 'preflight-home-'));
    await mkdir(path.join(home, '.local', 'bin'), { recursive: true });
    await writeFile(path.join(home, '.local', 'bin', 'claude'), '');
    for (const file of files) await writeFile(path.join(home, file), '');
    vi.stubEnv('HOME', home);
    vi.resetModules();
    const mod = await import('@/lib/preflight');
    return { mod, cleanup: () => rm(home, { recursive: true, force: true }) };
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('marks Claude logged in when ~/.claude.json exists', async () => {
    const { mod, cleanup } = await setup(['.claude.json']);
    try {
      const status = await mod.getPreflightStatus();
      expect(status.agents.claude?.loggedIn).toBe(true);
      expect(status.agent).toBe(status.agents.codex);
    } finally {
      await cleanup();
    }
  });

  it('marks Claude logged out without credentials files', async () => {
    const { mod, cleanup } = await setup([]);
    try {
      const status = await mod.getPreflightStatus();
      expect(status.agents.claude?.loggedIn).toBe(false);
    } finally {
      await cleanup();
    }
  });
});

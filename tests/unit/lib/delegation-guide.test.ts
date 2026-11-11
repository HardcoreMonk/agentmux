import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildDelegationEnvPrefix,
  buildDelegationGuide,
  buildDelegationShimSource,
  ensureDelegationAssets,
  getClaudeDelegationGuidePath,
  getDelegationShimDir,
  isDelegationGuideEnabled,
} from '@/lib/delegation-guide';

const repoRoot = process.cwd();
const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmux-delegation-test-'));
  tempDirs.push(dir);
  return dir;
};

const buildCleanCliEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith('AMUX_')
      || key.startsWith('CMUX_')
      || key.startsWith('AGENTMUX_')
      || key.startsWith('CODEXMUX_')
      || key.startsWith('__CMUX_')
    ) {
      delete env[key];
    }
  }
  return { ...env, NO_UPDATE_NOTIFIER: '1' };
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('isDelegationGuideEnabled', () => {
  it('is on unless explicitly false', () => {
    expect(isDelegationGuideEnabled({})).toBe(true);
    expect(isDelegationGuideEnabled({ agentDelegationGuideEnabled: true })).toBe(true);
    expect(isDelegationGuideEnabled({ agentDelegationGuideEnabled: false })).toBe(false);
  });
});

describe('buildDelegationGuide', () => {
  it('describes the CLI and env vars without embedding ids', () => {
    const guide = buildDelegationGuide('claude');
    expect(guide).toContain('agentmux tab create');
    expect(guide).toContain('AMUX_WORKSPACE_ID');
    expect(guide).not.toMatch(/ws-|tab-/);
  });

  it('offers only agent tab types to create, since agents cannot send to terminal tabs', () => {
    const guide = buildDelegationGuide('claude');
    expect(guide).toContain('- agentmux tab create -t claude|codex [-n NAME] [--cwd DIR]');
    expect(guide).not.toContain('terminal');
  });

  it('adds only the sandbox paragraph for codex', () => {
    const claude = buildDelegationGuide('claude');
    const codex = buildDelegationGuide('codex');
    expect(codex.startsWith(claude)).toBe(true);
    expect(codex.slice(claude.length)).toContain('your sandbox blocks local network access');
    expect(claude).not.toContain('sandbox blocks');
  });
});

describe('buildDelegationShimSource', () => {
  it('quotes every value for sh', () => {
    const source = buildDelegationShimSource({
      nodePath: '/n o/node',
      cliEntryPath: "/a'b/bin/agentmux.js",
      dataDir: '/d',
    });
    const lines = source.split('\n');
    expect(lines[0]).toBe('#!/bin/sh');
    expect(lines[1]).toBe(
      `AGENTMUX_DATA_DIR='/d' ELECTRON_RUN_AS_NODE=1 exec '/n o/node' '/a'\\''b/bin/agentmux.js' "$@"`,
    );
  });
});

describe('buildDelegationEnvPrefix', () => {
  it('quotes ids and prepends the shim dir to PATH', () => {
    expect(buildDelegationEnvPrefix({ workspaceId: 'ws-1', tabId: 'tab-1', shimDir: '/d/bin' }))
      .toBe(`AMUX_WORKSPACE_ID='ws-1' AMUX_TAB_ID='tab-1' PATH='/d/bin':"$PATH" `);
  });
});

describe('ensureDelegationAssets', () => {
  it('writes the shim and guide with private modes and is idempotent', async () => {
    const tmp = await makeTempDir();
    const input = { baseDir: tmp, nodePath: process.execPath, appDir: repoRoot };
    await ensureDelegationAssets(input);

    const shimPath = path.join(getDelegationShimDir(tmp), 'agentmux');
    const guidePath = getClaudeDelegationGuidePath(tmp);
    expect(shimPath).toBe(path.join(tmp, 'bin', 'agentmux'));
    expect(guidePath).toBe(path.join(tmp, 'delegation', 'claude.md'));
    expect((await fs.stat(shimPath)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(guidePath)).mode & 0o777).toBe(0o600);
    expect(await fs.readFile(guidePath, 'utf-8')).toBe(buildDelegationGuide('claude'));

    const before = [(await fs.stat(shimPath)).mtimeMs, (await fs.stat(guidePath)).mtimeMs];
    await new Promise((resolve) => setTimeout(resolve, 20));
    await ensureDelegationAssets(input);
    const after = [(await fs.stat(shimPath)).mtimeMs, (await fs.stat(guidePath)).mtimeMs];
    expect(after).toEqual(before);
  });

  it('survives concurrent calls on a fresh dir', async () => {
    const tmp = await makeTempDir();
    const input = { baseDir: tmp, nodePath: process.execPath, appDir: repoRoot };
    await Promise.all(Array.from({ length: 8 }, () => ensureDelegationAssets(input)));
    const shimPath = path.join(tmp, 'bin', 'agentmux');
    const guidePath = getClaudeDelegationGuidePath(tmp);
    expect((await fs.stat(shimPath)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(guidePath)).mode & 0o777).toBe(0o600);
    expect(await fs.readFile(guidePath, 'utf-8')).toBe(buildDelegationGuide('claude'));
    expect(await fs.readFile(shimPath, 'utf-8')).toContain('ELECTRON_RUN_AS_NODE=1');
    expect(await fs.readdir(path.join(tmp, 'bin'))).toEqual(['agentmux']);
  });

  it('produces a shim that runs the CLI', async () => {
    const tmp = await makeTempDir();
    await ensureDelegationAssets({ baseDir: tmp, nodePath: process.execPath, appDir: repoRoot });
    const shimPath = path.join(tmp, 'bin', 'agentmux');
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(shimPath, ['help'], { env: buildCleanCliEnv() }, (err, out) => {
        if (err) reject(err);
        else resolve(out);
      });
    });
    expect(stdout).toContain('tab create');
  });
});

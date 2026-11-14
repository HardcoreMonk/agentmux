import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { restoreBuildOutputs, runDeploy, snapshotBuildOutputs } from '../../../scripts/deploy-local-lib.mjs';

type TCall = [string, ...string[]];

const buildEnv = { NEXT_PUBLIC_COMMIT_HASH: 'abc1234', NEXT_PUBLIC_BUILD_TIME: '2026-11-15T00:00:00.000Z' };

const writeFile = (file: string, content: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
};

describe('deploy-local', () => {
  let rootDir: string;
  let calls: TCall[];
  let buildOptions: unknown;
  let logs: string[];
  let healthCalls: number;

  const p = (...segments: string[]) => path.join(rootDir, ...segments);

  const seedOutputs = () => {
    writeFile(p('.next/standalone/server.js'), 'original-server');
    writeFile(p('.next/static/a.js'), 'original-static');
    writeFile(p('.next/cache/keep.txt'), 'keep');
    writeFile(p('.next/dev/keep.txt'), 'dev-keep');
    writeFile(p('.next/BUILD_ID'), 'original-build-id');
    writeFile(p('dist/server.js'), 'original-dist');
  };

  const deploy = (statuses: Record<string, number> = {}, onBuild?: () => void) =>
    runDeploy({
      rootDir,
      buildEnv,
      log: (message: string) => logs.push(message),
      waitForHealth: async () => {
        healthCalls += 1;
        return { status: 'ok' };
      },
      run: (cmd: string, args: string[], options?: unknown) => {
        calls.push([cmd, ...args]);
        const key = args.includes('install') ? 'install' : args.includes('tsc') ? 'tsc' : args.includes('build') ? 'build' : cmd;
        if (key === 'build') {
          buildOptions = options;
          onBuild?.();
        }
        return statuses[key] ?? 0;
      },
    });

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), 'deploy-local-'));
    calls = [];
    logs = [];
    buildOptions = undefined;
    healthCalls = 0;
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('runs install, tsc, build, restart in order and snapshots outputs', async () => {
    seedOutputs();

    expect(await deploy()).toBe(0);

    expect(calls).toEqual([
      ['corepack', 'pnpm', 'install', '--frozen-lockfile'],
      ['corepack', 'pnpm', 'exec', 'tsc', '--noEmit', '-p', 'tsconfig.deploy-check.json'],
      ['corepack', 'pnpm', 'build'],
      ['systemctl', '--user', 'restart', 'agentmux.service'],
    ]);
    expect(buildOptions).toEqual({ env: buildEnv });
    expect(healthCalls).toBe(1);
    expect(readFileSync(p('.deploy-backup/next/standalone/server.js'), 'utf8')).toBe('original-server');
    expect(readFileSync(p('.deploy-backup/dist/server.js'), 'utf8')).toBe('original-dist');
    expect(existsSync(p('.deploy-backup/next/cache'))).toBe(false);
    // `.next/dev` holds `next dev` output (2.2 GB on the live host); the running service never reads it.
    expect(existsSync(p('.deploy-backup/next/dev'))).toBe(false);
  });

  it('stops at install failure without snapshotting', async () => {
    seedOutputs();

    expect(await deploy({ install: 7 })).toBe(7);

    expect(calls).toHaveLength(1);
    expect(existsSync(p('.deploy-backup'))).toBe(false);
  });

  it('stops at tsc failure and leaves outputs untouched', async () => {
    seedOutputs();

    expect(await deploy({ tsc: 2 })).toBe(2);

    expect(calls.map((call) => call.join(' '))).toEqual([
      'corepack pnpm install --frozen-lockfile',
      'corepack pnpm exec tsc --noEmit -p tsconfig.deploy-check.json',
    ]);
    expect(healthCalls).toBe(0);
    expect(readFileSync(p('.next/standalone/server.js'), 'utf8')).toBe('original-server');
  });

  it('restores previous outputs when build fails', async () => {
    seedOutputs();

    const code = await deploy({ build: 1 }, () => {
      rmSync(p('.next/standalone'), { recursive: true, force: true });
      rmSync(p('.next/static'), { recursive: true, force: true });
      rmSync(p('.next/BUILD_ID'), { force: true });
      rmSync(p('dist'), { recursive: true, force: true });
      writeFile(p('.next/standalone/partial.js'), 'partial');
    });

    expect(code).toBe(1);
    expect(calls.some((call) => call[0] === 'systemctl')).toBe(false);
    expect(healthCalls).toBe(0);
    expect(readFileSync(p('.next/standalone/server.js'), 'utf8')).toBe('original-server');
    expect(readFileSync(p('.next/static/a.js'), 'utf8')).toBe('original-static');
    expect(readFileSync(p('.next/BUILD_ID'), 'utf8')).toBe('original-build-id');
    expect(readFileSync(p('dist/server.js'), 'utf8')).toBe('original-dist');
    expect(existsSync(p('.next/standalone/partial.js'))).toBe(false);
    expect(readFileSync(p('.next/cache/keep.txt'), 'utf8')).toBe('keep');
    expect(readFileSync(p('.next/dev/keep.txt'), 'utf8')).toBe('dev-keep');
    expect(logs).toContain(
      '[deploy-local] build failed; restored the previous build output; the service was not restarted',
    );
  });

  it('keeps failed restore details and the build status', async () => {
    seedOutputs();

    const code = await deploy({ build: 3 }, () => {
      rmSync(p('.deploy-backup/next'), { recursive: true, force: true });
      writeFile(p('.deploy-backup/next'), 'not a directory');
    });

    expect(code).toBe(3);
    expect(calls.some((call) => call[0] === 'systemctl')).toBe(false);
    expect(healthCalls).toBe(0);
    expect(
      logs.some((line) =>
        line.startsWith(
          '[deploy-local] build failed and restoring the previous build output also failed:',
        ) && line.endsWith('recover manually from .deploy-backup/'),
      ),
    ).toBe(true);
  });

  it('handles a first deploy without .next or dist', async () => {
    expect(await snapshotBuildOutputs(rootDir)).toEqual({ next: false, dist: false });

    expect(await deploy()).toBe(0);
    expect(calls).toHaveLength(4);
    expect(healthCalls).toBe(1);
  });

  it('keeps symlinks as symlinks through snapshot and restore', async () => {
    seedOutputs();
    symlinkSync('server.js', p('.next/standalone/link.js'));

    const snapshot = await snapshotBuildOutputs(rootDir);
    expect(snapshot).toEqual({ next: true, dist: true });
    expect(lstatSync(p('.deploy-backup/next/standalone/link.js')).isSymbolicLink()).toBe(true);

    rmSync(p('.next/standalone'), { recursive: true, force: true });
    await restoreBuildOutputs(rootDir, snapshot);

    expect(lstatSync(p('.next/standalone/link.js')).isSymbolicLink()).toBe(true);
  });

  it('keeps dangling relative and absolute symlinks verbatim', async () => {
    seedOutputs();
    const links = {
      '.next/standalone/node_modules/x': '../../../node_modules/.pnpm/x',
      '.next/standalone/abs-link': '/nonexistent/deploy-local-target',
    };
    mkdirSync(p('.next/standalone/node_modules'), { recursive: true });
    for (const [link, target] of Object.entries(links)) symlinkSync(target, p(link), 'dir');

    const snapshot = await snapshotBuildOutputs(rootDir);
    rmSync(p('.next/standalone'), { recursive: true, force: true });
    await restoreBuildOutputs(rootDir, snapshot);

    for (const [link, target] of Object.entries(links)) {
      expect(lstatSync(p(link)).isSymbolicLink()).toBe(true);
      expect(readlinkSync(p(link))).toBe(target);
      const backup = link.replace('.next/', '.deploy-backup/next/');
      expect(readlinkSync(p(backup))).toBe(target);
    }
  });
});

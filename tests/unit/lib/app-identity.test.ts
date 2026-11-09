import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DATA_DIR_NAME,
  LEGACY_DATA_DIR_NAME,
  LEGACY_PRODUCT_NAME,
  PRODUCT_NAME,
  getDataDir,
  getDisplayDataDir,
  getServiceUnitName,
  inspectDataDirLayout,
  prepareDataDir,
  resolveDataDirPath,
} from '@/lib/app-identity';

const tempDirs: string[] = [];

const makeTempDir = (prefix = 'agentmux-identity-test-'): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const sha256 = (filePath: string): string =>
  createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

afterEach(() => {
  vi.unstubAllEnvs();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('app-identity', () => {
  it('exposes product constants, display data dir, and service unit name', () => {
    expect(PRODUCT_NAME).toBe('agentmux');
    expect(LEGACY_PRODUCT_NAME).toBe('codexmux');
    expect(DATA_DIR_NAME).toBe('.agentmux');
    expect(LEGACY_DATA_DIR_NAME).toBe('.codexmux');
    expect(getServiceUnitName()).toBe('agentmux.service');
    expect(getDisplayDataDir({})).toBe('~/.agentmux');
    expect(getDisplayDataDir({ AGENTMUX_DATA_DIR: '/custom/agentmux' })).toBe('/custom/agentmux');
    expect(getDisplayDataDir({ CODEXMUX_DATA_DIR: '/custom/codexmux' })).toBe('/custom/codexmux');
  });

  it('creates a relative alias symlink for legacy-only layout while preserving files and repeat idempotency', () => {
    const homeDir = makeTempDir();
    const legacyDir = path.join(homeDir, '.codexmux');
    fs.mkdirSync(legacyDir, { mode: 0o700 });
    const fileA = path.join(legacyDir, 'config.json');
    const fileB = path.join(legacyDir, 'cli-token');
    fs.writeFileSync(fileA, '{"updatedAt":"2026-11-09"}\n', { mode: 0o600 });
    fs.writeFileSync(fileB, 'secret-token\n', { mode: 0o600 });
    fs.chmodSync(fileA, 0o600);
    fs.chmodSync(fileB, 0o600);

    const hashABefore = sha256(fileA);
    const hashBBefore = sha256(fileB);
    const modeABefore = fs.statSync(fileA).mode & 0o777;
    const modeBBefore = fs.statSync(fileB).mode & 0o777;

    expect(inspectDataDirLayout(homeDir)).toEqual({ kind: 'legacy-only' });

    const resolved = prepareDataDir({ homeDir, env: {} });
    expect(resolved).toBe(legacyDir);
    expect(inspectDataDirLayout(homeDir)).toEqual({ kind: 'aliased' });

    const aliasPath = path.join(homeDir, '.agentmux');
    expect(fs.lstatSync(aliasPath).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(aliasPath)).toBe('.codexmux');
    expect(sha256(fileA)).toBe(hashABefore);
    expect(sha256(fileB)).toBe(hashBBefore);
    expect(fs.statSync(fileA).mode & 0o777).toBe(modeABefore);
    expect(fs.statSync(fileB).mode & 0o777).toBe(modeBBefore);

    const fixedTime = new Date('2026-01-02T03:04:05.000Z');
    fs.utimesSync(legacyDir, fixedTime, fixedTime);
    fs.utimesSync(homeDir, fixedTime, fixedTime);
    const entriesBefore = fs.readdirSync(homeDir).sort();
    const homeMtimeBefore = fs.statSync(homeDir).mtimeMs;
    const legacyMtimeBefore = fs.statSync(legacyDir).mtimeMs;

    const secondResolved = prepareDataDir({ homeDir, env: {} });
    expect(secondResolved).toBe(legacyDir);
    expect(fs.readdirSync(homeDir).sort()).toEqual(entriesBefore);
    expect(fs.statSync(homeDir).mtimeMs).toBe(homeMtimeBefore);
    expect(fs.statSync(legacyDir).mtimeMs).toBe(legacyMtimeBefore);
  });

  it('creates only .agentmux on a fresh HOME', () => {
    const homeDir = makeTempDir();
    expect(inspectDataDirLayout(homeDir)).toEqual({ kind: 'fresh' });

    const resolved = prepareDataDir({ homeDir, env: {} });
    const agentmuxDir = path.join(homeDir, '.agentmux');
    expect(resolved).toBe(agentmuxDir);
    expect(fs.readdirSync(homeDir)).toEqual(['.agentmux']);
    expect(fs.lstatSync(agentmuxDir).isDirectory()).toBe(true);
    expect(fs.statSync(agentmuxDir).mode & 0o777).toBe(0o700);
    expect(fs.existsSync(path.join(homeDir, '.codexmux'))).toBe(false);
    expect(inspectDataDirLayout(homeDir)).toEqual({ kind: 'agentmux-only' });
  });

  it('fails closed on both-real, unexpected-symlink, dangling-symlink, and not-directory conflicts without mutating HOME', () => {
    // 1. both-real
    const bothRealHome = makeTempDir();
    fs.mkdirSync(path.join(bothRealHome, '.codexmux'));
    fs.mkdirSync(path.join(bothRealHome, '.agentmux'));
    const bothRealEntries = fs.readdirSync(bothRealHome).sort();
    expect(inspectDataDirLayout(bothRealHome)).toEqual({
      kind: 'conflict',
      reason: 'both-real',
    });
    expect(() => prepareDataDir({ homeDir: bothRealHome, env: {} })).toThrowError(
      expect.objectContaining({
        code: 'data-dir-conflict',
        reason: 'both-real',
      }),
    );
    expect(fs.readdirSync(bothRealHome).sort()).toEqual(bothRealEntries);

    // 2. unexpected-symlink
    const unexpectedHome = makeTempDir();
    const otherTarget = makeTempDir('agentmux-other-target-');
    fs.mkdirSync(path.join(unexpectedHome, '.codexmux'));
    fs.symlinkSync(otherTarget, path.join(unexpectedHome, '.agentmux'));
    const unexpectedEntries = fs.readdirSync(unexpectedHome).sort();
    expect(inspectDataDirLayout(unexpectedHome)).toEqual({
      kind: 'conflict',
      reason: 'unexpected-symlink',
    });
    expect(() => prepareDataDir({ homeDir: unexpectedHome, env: {} })).toThrowError(
      expect.objectContaining({
        code: 'data-dir-conflict',
        reason: 'unexpected-symlink',
      }),
    );
    expect(fs.readdirSync(unexpectedHome).sort()).toEqual(unexpectedEntries);

    // 3. dangling-symlink
    const danglingHome = makeTempDir();
    fs.symlinkSync('.codexmux', path.join(danglingHome, '.agentmux'));
    const danglingEntries = fs.readdirSync(danglingHome).sort();
    expect(inspectDataDirLayout(danglingHome)).toEqual({
      kind: 'conflict',
      reason: 'dangling-symlink',
    });
    expect(() => prepareDataDir({ homeDir: danglingHome, env: {} })).toThrowError(
      expect.objectContaining({
        code: 'data-dir-conflict',
        reason: 'dangling-symlink',
      }),
    );
    expect(fs.readdirSync(danglingHome).sort()).toEqual(danglingEntries);

    // 4. not-directory
    const notDirHome = makeTempDir();
    fs.writeFileSync(path.join(notDirHome, '.codexmux'), 'not a directory');
    const notDirEntries = fs.readdirSync(notDirHome).sort();
    expect(inspectDataDirLayout(notDirHome)).toEqual({
      kind: 'conflict',
      reason: 'not-directory',
    });
    expect(() => prepareDataDir({ homeDir: notDirHome, env: {} })).toThrowError(
      expect.objectContaining({
        code: 'data-dir-conflict',
        reason: 'not-directory',
      }),
    );
    expect(fs.readdirSync(notDirHome).sort()).toEqual(notDirEntries);
  });

  it('handles .codexmux symlink layouts: migrated agentmux-only, unexpected target, dangling target, and mutual symlink loop', () => {
    // 1. real .agentmux + .codexmux -> '.agentmux' relative symlink (post-migration state)
    const migratedHome = makeTempDir();
    const agentmuxDir = path.join(migratedHome, '.agentmux');
    fs.mkdirSync(agentmuxDir, { mode: 0o700 });
    fs.symlinkSync('.agentmux', path.join(migratedHome, '.codexmux'));
    const migratedEntriesBefore = fs.readdirSync(migratedHome).sort();
    expect(inspectDataDirLayout(migratedHome)).toEqual({ kind: 'agentmux-only' });
    expect(resolveDataDirPath(migratedHome, {})).toBe(agentmuxDir);
    expect(prepareDataDir({ homeDir: migratedHome, env: {} })).toBe(agentmuxDir);
    expect(fs.readdirSync(migratedHome).sort()).toEqual(migratedEntriesBefore);

    // 2. .codexmux -> another real directory in /tmp
    const unexpectedCodexmuxHome = makeTempDir();
    const otherRealDir = makeTempDir('agentmux-other-real-dir-');
    fs.symlinkSync(otherRealDir, path.join(unexpectedCodexmuxHome, '.codexmux'));
    const unexpectedCodexmuxEntries = fs.readdirSync(unexpectedCodexmuxHome).sort();
    expect(inspectDataDirLayout(unexpectedCodexmuxHome)).toEqual({
      kind: 'conflict',
      reason: 'unexpected-symlink',
    });
    expect(() => prepareDataDir({ homeDir: unexpectedCodexmuxHome, env: {} })).toThrowError(
      expect.objectContaining({
        code: 'data-dir-conflict',
        reason: 'unexpected-symlink',
      }),
    );
    expect(fs.readdirSync(unexpectedCodexmuxHome).sort()).toEqual(unexpectedCodexmuxEntries);

    // 3. .codexmux dangling symlink
    const danglingCodexmuxHome = makeTempDir();
    fs.symlinkSync('.agentmux', path.join(danglingCodexmuxHome, '.codexmux'));
    const danglingCodexmuxEntries = fs.readdirSync(danglingCodexmuxHome).sort();
    expect(inspectDataDirLayout(danglingCodexmuxHome)).toEqual({
      kind: 'conflict',
      reason: 'dangling-symlink',
    });
    expect(() => prepareDataDir({ homeDir: danglingCodexmuxHome, env: {} })).toThrowError(
      expect.objectContaining({
        code: 'data-dir-conflict',
        reason: 'dangling-symlink',
      }),
    );
    expect(fs.readdirSync(danglingCodexmuxHome).sort()).toEqual(danglingCodexmuxEntries);

    // 4. .agentmux <-> .codexmux mutual symlink loop
    const loopHome = makeTempDir();
    fs.symlinkSync('.codexmux', path.join(loopHome, '.agentmux'));
    fs.symlinkSync('.agentmux', path.join(loopHome, '.codexmux'));
    const loopEntries = fs.readdirSync(loopHome).sort();
    expect(inspectDataDirLayout(loopHome)).toEqual({
      kind: 'conflict',
      reason: 'unexpected-symlink',
    });
    expect(() => prepareDataDir({ homeDir: loopHome, env: {} })).toThrowError(
      expect.objectContaining({
        code: 'data-dir-conflict',
        reason: 'unexpected-symlink',
      }),
    );
    expect(fs.readdirSync(loopHome).sort()).toEqual(loopEntries);
  });

  it('resolves data directory paths without side effects across all layouts and symlinked HOME', () => {
    // fresh
    const freshHome = makeTempDir();
    expect(resolveDataDirPath(freshHome, {})).toBe(path.join(freshHome, '.agentmux'));
    expect(fs.readdirSync(freshHome)).toEqual([]);

    // agentmux-only
    const agentmuxOnlyHome = makeTempDir();
    fs.mkdirSync(path.join(agentmuxOnlyHome, '.agentmux'));
    expect(resolveDataDirPath(agentmuxOnlyHome, {})).toBe(path.join(agentmuxOnlyHome, '.agentmux'));
    expect(fs.readdirSync(agentmuxOnlyHome)).toEqual(['.agentmux']);

    // legacy-only
    const legacyHome = makeTempDir();
    fs.mkdirSync(path.join(legacyHome, '.codexmux'));
    expect(resolveDataDirPath(legacyHome, {})).toBe(path.join(legacyHome, '.codexmux'));
    expect(fs.readdirSync(legacyHome)).toEqual(['.codexmux']);

    // aliased (relative and absolute homeDir/.codexmux targets)
    const aliasedHome = makeTempDir();
    fs.mkdirSync(path.join(aliasedHome, '.codexmux'));
    fs.symlinkSync('.codexmux', path.join(aliasedHome, '.agentmux'));
    expect(resolveDataDirPath(aliasedHome, {})).toBe(path.join(aliasedHome, '.codexmux'));

    const absAliasedHome = makeTempDir();
    fs.mkdirSync(path.join(absAliasedHome, '.codexmux'));
    fs.symlinkSync(path.join(absAliasedHome, '.codexmux'), path.join(absAliasedHome, '.agentmux'));
    expect(inspectDataDirLayout(absAliasedHome)).toEqual({ kind: 'aliased' });
    expect(resolveDataDirPath(absAliasedHome, {})).toBe(path.join(absAliasedHome, '.codexmux'));

    // conflicts: returns .codexmux if it is a real directory, otherwise .agentmux
    const bothRealHome = makeTempDir();
    fs.mkdirSync(path.join(bothRealHome, '.codexmux'));
    fs.mkdirSync(path.join(bothRealHome, '.agentmux'));
    expect(resolveDataDirPath(bothRealHome, {})).toBe(path.join(bothRealHome, '.codexmux'));

    const danglingHome = makeTempDir();
    fs.symlinkSync('.codexmux', path.join(danglingHome, '.agentmux'));
    expect(resolveDataDirPath(danglingHome, {})).toBe(path.join(danglingHome, '.agentmux'));

    const notDirHome = makeTempDir();
    fs.writeFileSync(path.join(notDirHome, '.codexmux'), 'file');
    expect(resolveDataDirPath(notDirHome, {})).toBe(path.join(notDirHome, '.agentmux'));

    // symlinked HOME itself: preserves homeDir prefix without realpath expansion
    const realBase = makeTempDir('agentmux-real-home-');
    fs.mkdirSync(path.join(realBase, '.codexmux'));
    const symlinkContainer = makeTempDir('agentmux-symlink-home-');
    const symlinkedHome = path.join(symlinkContainer, 'linked-home');
    fs.symlinkSync(realBase, symlinkedHome);
    expect(resolveDataDirPath(symlinkedHome, {})).toBe(path.join(symlinkedHome, '.codexmux'));
  });

  it('honors AGENTMUX_DATA_DIR and CODEXMUX_DATA_DIR overrides and never memoizes getDataDir()', async () => {
    const homeA = makeTempDir();
    const homeB = makeTempDir();
    fs.mkdirSync(path.join(homeA, '.codexmux'));

    expect(resolveDataDirPath(homeA, { AGENTMUX_DATA_DIR: '/x' })).toBe('/x');
    expect(resolveDataDirPath(homeA, { CODEXMUX_DATA_DIR: '/x' })).toBe('/x');
    expect(
      resolveDataDirPath(homeA, {
        AGENTMUX_DATA_DIR: '/preferred',
        CODEXMUX_DATA_DIR: '/fallback',
      }),
    ).toBe('/preferred');

    vi.stubEnv('HOME', homeA);
    vi.stubEnv('AGENTMUX_DATA_DIR', '');
    vi.stubEnv('CODEXMUX_DATA_DIR', '');
    expect(getDataDir()).toBe(path.join(homeA, '.codexmux'));

    vi.stubEnv('HOME', homeB);
    vi.resetModules();
    const reloaded = await import('@/lib/app-identity');
    expect(reloaded.getDataDir()).toBe(path.join(homeB, '.agentmux'));
  });
});

describe('app-identity win32', () => {
  it('uses ~/.codexmux without creating .agentmux on a fresh home', () => {
    const homeDir = makeTempDir();

    expect(resolveDataDirPath(homeDir, {}, 'win32')).toBe(path.join(homeDir, '.codexmux'));
    expect(prepareDataDir({ homeDir, env: {}, platform: 'win32' })).toBe(
      path.join(homeDir, '.codexmux'),
    );
    expect(fs.existsSync(path.join(homeDir, '.codexmux'))).toBe(true);
    expect(fs.existsSync(path.join(homeDir, '.agentmux'))).toBe(false);
  });

  it('ignores a coexisting .agentmux directory instead of reporting a conflict', () => {
    const homeDir = makeTempDir();
    fs.mkdirSync(path.join(homeDir, '.agentmux'));
    fs.mkdirSync(path.join(homeDir, '.codexmux'));

    expect(() => prepareDataDir({ homeDir, env: {}, platform: 'win32' })).not.toThrow();
    expect(resolveDataDirPath(homeDir, {}, 'win32')).toBe(path.join(homeDir, '.codexmux'));
  });
});

describe('app-identity legacy-only race', () => {
  it('returns the legacy path when symlink creation loses to an existing alias', () => {
    const homeDir = makeTempDir();
    fs.mkdirSync(path.join(homeDir, '.codexmux'));
    const realSymlink = fs.symlinkSync.bind(fs);
    vi.spyOn(fs, 'symlinkSync').mockImplementationOnce((target, linkPath, type) => {
      realSymlink(target, linkPath, type);
      throw Object.assign(new Error('exists'), { code: 'EEXIST' });
    });

    expect(prepareDataDir({ homeDir, env: {} })).toBe(path.join(homeDir, '.codexmux'));
    vi.restoreAllMocks();
  });
});

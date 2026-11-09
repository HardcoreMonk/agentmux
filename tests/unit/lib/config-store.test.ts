import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/sync-server', () => ({ broadcastSync: vi.fn() }));

const VALID_HASH = `scrypt:${'a'.repeat(32)}:${'b'.repeat(128)}`;
const VALID_SECRET = 'c'.repeat(64);
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
let homeDir = '';

const resetConfigGlobals = () => {
  const state = globalThis as unknown as {
    __ptConfigLock?: Promise<void>;
    __ptConfigContentCache?: string;
  };
  delete state.__ptConfigLock;
  delete state.__ptConfigContentCache;
};

const configPath = () => path.join(homeDir, '.agentmux', 'config.json');

const writeRawConfig = async (content: string) => {
  await fs.mkdir(path.dirname(configPath()), { recursive: true });
  await fs.writeFile(configPath(), content, 'utf8');
};

const importStore = async () => {
  vi.resetModules();
  return import('@/lib/config-store');
};

beforeEach(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-config-test-'));
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  resetConfigGlobals();
});

afterEach(async () => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  resetConfigGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  await fs.rm(homeDir, { recursive: true, force: true });
});

describe('config store integrity', () => {
  it('returns null only when config.json is missing', async () => {
    const { readConfig } = await importStore();

    await expect(readConfig()).resolves.toBeNull();
  });

  it('creates a missing config even when the previous content is cached', async () => {
    const { initConfigStore } = await importStore();

    await initConfigStore();
    await fs.unlink(configPath());
    await initConfigStore();

    await expect(fs.readFile(configPath(), 'utf8')).resolves.toContain('updatedAt');
  });

  it('preserves malformed JSON instead of replacing it with an empty config', async () => {
    const malformed = '{"authPassword":';
    await writeRawConfig(malformed);
    const { initConfigStore } = await importStore();

    await expect(initConfigStore()).rejects.toThrow();
    await expect(fs.readFile(configPath(), 'utf8')).resolves.toBe(malformed);
  });

  it('rejects non-object JSON roots', async () => {
    for (const value of ['null', '[]', '"config"']) {
      await writeRawConfig(value);
      const { readConfig } = await importStore();
      await expect(readConfig()).rejects.toThrow();
    }
  });

  it('propagates read errors other than ENOENT without writing', async () => {
    await writeRawConfig('{"updatedAt":"before"}');
    const before = await fs.readFile(configPath(), 'utf8');
    const readError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const readSpy = vi.spyOn(fs, 'readFile').mockRejectedValueOnce(readError);
    const { initConfigStore } = await importStore();

    await expect(initConfigStore()).rejects.toMatchObject({ code: 'EACCES' });
    readSpy.mockRestore();
    await expect(fs.readFile(configPath(), 'utf8')).resolves.toBe(before);
  });

  it('does not let updateConfig recreate a missing config', async () => {
    const { updateConfig } = await importStore();

    await expect(updateConfig({ locale: 'ko' })).rejects.toThrow();
    await expect(fs.stat(configPath())).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('stored auth state', () => {
  it.each([
    [{ updatedAt: 'now' }, { mode: 'setup-required', authSecret: null }],
    [{ updatedAt: 'now', authSecret: VALID_SECRET }, { mode: 'setup-required', authSecret: VALID_SECRET }],
    [
      { updatedAt: 'now', authPassword: 'legacy-sha512', authSecret: VALID_SECRET },
      { mode: 'setup-required', authSecret: VALID_SECRET },
    ],
    [
      { updatedAt: 'now', authPassword: VALID_HASH, authSecret: VALID_SECRET },
      { mode: 'configured', passwordHash: VALID_HASH, authSecret: VALID_SECRET },
    ],
  ])('classifies %# without weakening legacy reset behavior', async (config, expected) => {
    const { resolveStoredAuthState } = await importStore();

    expect(resolveStoredAuthState(config)).toEqual(expected);
  });

  it('classifies incomplete and malformed scrypt state as invalid', async () => {
    const { resolveStoredAuthState } = await importStore();

    expect(resolveStoredAuthState({ updatedAt: 'now', authPassword: VALID_HASH })).toEqual({
      mode: 'invalid',
      reason: 'missing-auth-secret',
    });
    expect(resolveStoredAuthState({
      updatedAt: 'now',
      authPassword: 'scrypt:not-a-valid-hash',
      authSecret: VALID_SECRET,
    })).toEqual({ mode: 'invalid', reason: 'malformed-scrypt-hash' });
    expect(resolveStoredAuthState({
      updatedAt: 'now',
      authPassword: 42 as never,
      authSecret: VALID_SECRET,
    })).toEqual({ mode: 'invalid', reason: 'invalid-auth-field' });
    for (const authSecret of ['x', 'not-hex'.repeat(10), 'A'.repeat(64)]) {
      expect(resolveStoredAuthState({
        updatedAt: 'now',
        authPassword: VALID_HASH,
        authSecret,
      })).toEqual({ mode: 'invalid', reason: 'invalid-auth-field' });
    }
  });

  it('uses exact scrypt shape and safely rejects malformed verification input', async () => {
    const { isHashedPassword, verifyPassword } = await importStore();

    expect(isHashedPassword(VALID_HASH)).toBe(true);
    expect(isHashedPassword('scrypt:short:short')).toBe(false);
    await expect(verifyPassword('password', 'scrypt:short:short')).resolves.toBe(false);
  });

  it('does not coerce invalid stored auth into needsSetup', async () => {
    await writeRawConfig(JSON.stringify({ updatedAt: 'now', authPassword: VALID_HASH }));
    const { needsSetup } = await importStore();

    await expect(needsSetup()).rejects.toThrow();
  });
});

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/sync-server', () => ({ broadcastSync: vi.fn() }));

const VALID_HASH = `scrypt:${'a'.repeat(32)}:${'b'.repeat(128)}`;
const VALID_SECRET = 'c'.repeat(64);
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalInitPassword = process.env.INIT_PASSWORD;
let homeDir = '';

const resetConfigGlobals = () => {
  const state = globalThis as unknown as {
    __ptConfigLock?: Promise<void>;
    __ptConfigContentCache?: string;
  };
  delete state.__ptConfigLock;
  delete state.__ptConfigContentCache;
};

const importModules = async () => {
  vi.resetModules();
  const store = await import('@/lib/config-store');
  const credentials = await import('@/lib/auth-credentials');
  return { store, credentials };
};

beforeEach(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-auth-bootstrap-test-'));
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  delete process.env.INIT_PASSWORD;
  resetConfigGlobals();
});

afterEach(async () => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  if (originalInitPassword === undefined) delete process.env.INIT_PASSWORD;
  else process.env.INIT_PASSWORD = originalInitPassword;
  resetConfigGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  await fs.rm(homeDir, { recursive: true, force: true });
});

describe('auth credential bootstrap', () => {
  it('uses configured credentials and discards INIT_PASSWORD', async () => {
    process.env.INIT_PASSWORD = 'temporary-password';
    const { credentials } = await importModules();

    await expect(credentials.initAuthCredentials({
      updatedAt: 'now',
      authPassword: VALID_HASH,
      authSecret: VALID_SECRET,
    })).resolves.toEqual({
      mode: 'configured',
      passwordHash: VALID_HASH,
      secret: VALID_SECRET,
    });
    expect(process.env.INIT_PASSWORD).toBeUndefined();
  });

  it('returns setup-open for empty and secret-only setup state', async () => {
    const { credentials } = await importModules();

    await expect(credentials.initAuthCredentials({ updatedAt: 'now' })).resolves.toEqual({
      mode: 'setup-open',
    });
    await expect(credentials.initAuthCredentials({
      updatedAt: 'now',
      authSecret: VALID_SECRET,
    })).resolves.toEqual({ mode: 'setup-open' });
  });

  it('hashes a valid INIT_PASSWORD and persists a missing secret', async () => {
    process.env.INIT_PASSWORD = 'bootstrap-password';
    const { store, credentials } = await importModules();
    const config = await store.initConfigStore();

    const result = await credentials.initAuthCredentials(config);

    expect(result.mode).toBe('init-password');
    if (result.mode !== 'init-password') throw new Error('unexpected bootstrap mode');
    expect(store.isHashedPassword(result.passwordHash)).toBe(true);
    expect(result.secret).toMatch(/^[0-9a-f]{64}$/);
    await expect(store.readConfig()).resolves.toMatchObject({ authSecret: result.secret });
  });

  it('reuses the setup secret in INIT_PASSWORD mode', async () => {
    process.env.INIT_PASSWORD = 'bootstrap-password';
    const { credentials } = await importModules();

    const result = await credentials.initAuthCredentials({
      updatedAt: 'now',
      authSecret: VALID_SECRET,
    });

    expect(result).toMatchObject({ mode: 'init-password', secret: VALID_SECRET });
  });

  it('fails closed for a short INIT_PASSWORD without mutating config', async () => {
    process.env.INIT_PASSWORD = 'abc';
    const { store, credentials } = await importModules();
    const config = await store.initConfigStore();
    const before = await fs.readFile(path.join(homeDir, '.agentmux', 'config.json'), 'utf8');

    await expect(credentials.initAuthCredentials(config)).rejects.toThrow(/INIT_PASSWORD/);
    await expect(fs.readFile(path.join(homeDir, '.agentmux', 'config.json'), 'utf8')).resolves.toBe(before);
  });

  it('does not let INIT_PASSWORD bypass invalid stored auth state', async () => {
    process.env.INIT_PASSWORD = 'bootstrap-password';
    const { credentials } = await importModules();

    await expect(credentials.initAuthCredentials({
      updatedAt: 'now',
      authPassword: VALID_HASH,
    })).rejects.toThrow();
  });

  it('propagates secret persistence failure', async () => {
    process.env.INIT_PASSWORD = 'bootstrap-password';
    vi.resetModules();
    const store = await import('@/lib/config-store');
    const updateSpy = vi.spyOn(store, 'updateConfig').mockRejectedValue(new Error('write failed'));
    const credentials = await import('@/lib/auth-credentials');

    await expect(credentials.initAuthCredentials({ updatedAt: 'now' })).rejects.toThrow('write failed');
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });
});

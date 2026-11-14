import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/cli-token', () => ({ getCliToken: () => 'test-token' }));

import { isCodexHookFingerprintTrusted, recordCodexHookTrusted } from '@/lib/codex-hook-trust';

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmux-hook-trust-'));
  vi.stubEnv('AGENTMUX_DATA_DIR', dataDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('codex hook trust', () => {
  it('is untrusted before anything is recorded', async () => {
    expect(await isCodexHookFingerprintTrusted()).toBe(false);
  });

  it('is trusted after recording', async () => {
    await recordCodexHookTrusted();

    expect(await isCodexHookFingerprintTrusted()).toBe(true);
  });

  it('is untrusted again when the hook command changes', async () => {
    await recordCodexHookTrusted();
    const original = process.execPath;
    Object.defineProperty(process, 'execPath', { value: '/other/node', configurable: true });
    try {
      expect(await isCodexHookFingerprintTrusted()).toBe(false);
    } finally {
      Object.defineProperty(process, 'execPath', { value: original, configurable: true });
    }
  });

  it('does not rewrite an unchanged fingerprint', async () => {
    await recordCodexHookTrusted();
    const file = path.join(dataDir, 'codex-hook-trust.json');
    const past = new Date(Date.now() - 60_000);
    await fs.utimes(file, past, past);

    const before = (await fs.stat(file)).mtimeMs;

    await recordCodexHookTrusted();

    expect((await fs.stat(file)).mtimeMs).toBe(before);
  });
});

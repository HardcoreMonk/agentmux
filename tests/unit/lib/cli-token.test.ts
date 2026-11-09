import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import type { NextApiRequest } from 'next';

const originalHome = process.env.HOME;
let tmpDirs: string[] = [];

const clearCachedToken = () => {
  delete (globalThis as unknown as { __ptCliToken?: string }).__ptCliToken;
};

const importCliTokenWithTempHome = async () => {
  const tmpHome = mkdtempSync(path.join(os.tmpdir(), 'codexmux-cli-token-'));
  tmpDirs.push(tmpHome);
  process.env.HOME = tmpHome;
  clearCachedToken();
  vi.resetModules();
  return import('@/lib/cli-token');
};

const requestWithHeaders = (headers: Record<string, string>): NextApiRequest =>
  ({ headers }) as unknown as NextApiRequest;

describe('cli token verification', () => {
  afterEach(() => {
    process.env.HOME = originalHome;
    clearCachedToken();
    vi.resetModules();
    for (const dir of tmpDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs = [];
  });

  it('exposes new and legacy CLI token header constants', async () => {
    const { CLI_TOKEN_HEADER, LEGACY_CLI_TOKEN_HEADER } = await importCliTokenWithTempHome();
    expect(CLI_TOKEN_HEADER).toBe('x-agentmux-token');
    expect(LEGACY_CLI_TOKEN_HEADER).toBe('x-cmux-token');
  });

  it('accepts either x-agentmux-token or legacy x-cmux-token alone', async () => {
    const { getCliToken, verifyCliToken } = await importCliTokenWithTempHome();
    const token = getCliToken();

    expect(verifyCliToken(requestWithHeaders({ 'x-agentmux-token': token }))).toBe(true);
    expect(verifyCliToken(requestWithHeaders({ 'x-cmux-token': token }))).toBe(true);
  });

  it('prefers x-agentmux-token when both headers are present with different values', async () => {
    const { getCliToken, readCliTokenHeader, verifyCliToken } = await importCliTokenWithTempHome();
    const token = getCliToken();

    expect(
      readCliTokenHeader({
        'x-agentmux-token': 'new-val',
        'x-cmux-token': 'legacy-val',
      }),
    ).toBe('new-val');

    const webHeaders = new Headers({
      'x-agentmux-token': 'new-web',
      'x-cmux-token': 'legacy-web',
    });
    expect(readCliTokenHeader(webHeaders)).toBe('new-web');

    expect(
      verifyCliToken(
        requestWithHeaders({
          'x-agentmux-token': token,
          'x-cmux-token': 'wrong-legacy-token',
        }),
      ),
    ).toBe(true);

    expect(
      verifyCliToken(
        requestWithHeaders({
          'x-agentmux-token': 'wrong-new-token',
          'x-cmux-token': token,
        }),
      ),
    ).toBe(false);
  });

  it('rejects requests without any CLI token header', async () => {
    const { verifyCliToken } = await importCliTokenWithTempHome();

    expect(verifyCliToken(requestWithHeaders({}))).toBe(false);
  });
});

import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('isAllowedJsonlPath', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows local Codex session JSONL paths', async () => {
    const home = path.join(os.tmpdir(), 'codexmux-path-validation-local');
    vi.stubEnv('HOME', home);

    const { isAllowedJsonlPath } = await import('@/lib/path-validation');

    expect(isAllowedJsonlPath(
      path.join(home, '.codex', 'sessions', '2026', '05', '05', 'session.jsonl'),
      { homeDir: home },
    )).toBe(true);
  });

  it('rejects legacy remote Codex JSONL paths', async () => {
    const home = path.join(os.tmpdir(), 'codexmux-path-validation-remote');
    vi.stubEnv('HOME', home);

    const { isAllowedJsonlPath } = await import('@/lib/path-validation');

    expect(isAllowedJsonlPath(
      path.join(home, '.codexmux', 'remote', 'codex', 'win11', 'session.jsonl'),
      { homeDir: home },
    )).toBe(false);
  });

  it('allows Windows Codex session JSONL paths with an injected home directory', async () => {
    const { isAllowedJsonlPath } = await import('@/lib/path-validation');

    expect(isAllowedJsonlPath(
      'C:\\Users\\yohan\\.codex\\sessions\\2026\\05\\06\\session.jsonl',
      { homeDir: 'C:\\Users\\yohan' },
    )).toBe(true);
  });

  it('rejects Windows sibling directories that only share the sessions prefix', async () => {
    const { isAllowedJsonlPath } = await import('@/lib/path-validation');

    expect(isAllowedJsonlPath(
      'C:\\Users\\yohan\\.codex\\sessions-backup\\session.jsonl',
      { homeDir: 'C:\\Users\\yohan' },
    )).toBe(false);
  });

  it('rejects Windows legacy remote Codex sidecar paths', async () => {
    const { isAllowedJsonlPath } = await import('@/lib/path-validation');

    expect(isAllowedJsonlPath(
      'C:\\Users\\yohan\\.codexmux\\remote\\codex\\win11\\session.jsonl',
      { homeDir: 'C:\\Users\\yohan' },
    )).toBe(false);
  });
});

describe('isJsonlPathUnderRoots', () => {
  it('allows a JSONL file under any of the roots', async () => {
    const { isJsonlPathUnderRoots } = await import('@/lib/path-validation');
    const roots = ['/home/test/.codex/sessions', '/home/test/.claude/projects'];

    expect(isJsonlPathUnderRoots('/home/test/.codex/sessions/a.jsonl', roots)).toBe(true);
    expect(isJsonlPathUnderRoots('/home/test/.claude/projects/x/b.jsonl', roots)).toBe(true);
  });

  it('rejects paths outside every root and with an empty root list', async () => {
    const { isJsonlPathUnderRoots } = await import('@/lib/path-validation');

    expect(isJsonlPathUnderRoots('/home/test/other/a.jsonl', ['/home/test/.codex/sessions'])).toBe(false);
    expect(isJsonlPathUnderRoots('/home/test/.codex/sessions/a.jsonl', [])).toBe(false);
  });
});

describe('getCodexHomeDir', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('falls back to <home>/.codex when CODEX_HOME is unset or empty', async () => {
    const { getCodexHomeDir } = await import('@/lib/path-validation');

    vi.stubEnv('CODEX_HOME', '');
    expect(getCodexHomeDir('/tmp/h')).toBe(path.join('/tmp/h', '.codex'));
    expect(getCodexHomeDir('C:\\Users\\yohan')).toBe('C:\\Users\\yohan\\.codex');
  });

  it('uses CODEX_HOME when set', async () => {
    vi.stubEnv('CODEX_HOME', '/tmp/isolated-codex');
    const { getCodexHomeDir } = await import('@/lib/path-validation');

    expect(getCodexHomeDir('/tmp/h')).toBe('/tmp/isolated-codex');
    expect(getCodexHomeDir()).toBe('/tmp/isolated-codex');
  });

  it('makes getCodexSessionsDir and Codex JSONL validation follow CODEX_HOME', async () => {
    vi.stubEnv('CODEX_HOME', '/tmp/isolated-codex');
    const { getCodexSessionsDir, isAllowedJsonlPath } = await import('@/lib/path-validation');

    expect(getCodexSessionsDir('/tmp/h')).toBe('/tmp/isolated-codex/sessions');
    expect(isAllowedJsonlPath('/tmp/isolated-codex/sessions/2026/11/15/s.jsonl', { homeDir: '/tmp/h' })).toBe(true);
    expect(isAllowedJsonlPath('/tmp/h/.codex/sessions/2026/11/15/s.jsonl', { homeDir: '/tmp/h' })).toBe(false);
  });
});

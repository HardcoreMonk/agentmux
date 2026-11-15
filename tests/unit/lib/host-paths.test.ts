import { describe, expect, it } from 'vitest';
import { resolveHostPaths } from '@/lib/host-paths';

describe('resolveHostPaths codexDir', () => {
  it('defaults to <home>/.codex', () => {
    expect(resolveHostPaths({ platform: 'linux', env: { HOME: '/home/me' } }).codexDir).toBe('/home/me/.codex');
    expect(resolveHostPaths({ platform: 'win32', env: { USERPROFILE: 'C:\\Users\\me' } }).codexDir)
      .toBe('C:\\Users\\me\\.codex');
  });

  it('follows CODEX_HOME from the given env', () => {
    expect(resolveHostPaths({ platform: 'linux', env: { HOME: '/home/me', CODEX_HOME: '/srv/codex' } }).codexDir)
      .toBe('/srv/codex');
    expect(resolveHostPaths({ platform: 'win32', env: { USERPROFILE: 'C:\\Users\\me', CODEX_HOME: 'D:\\codex' } }).codexDir)
      .toBe('D:\\codex');
  });
});

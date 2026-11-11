import { describe, expect, it } from 'vitest';

import { matchAgentStartupScreen } from '@/lib/agent-startup-screen';

const TRUST_SCREEN = [
  '> You are in /tmp/project',
  '',
  '  Do you trust the contents of this directory?',
  '',
  '› 1. Yes, continue',
  '  2. No, quit',
].join('\n');

const CODEX_UPDATE_SCREEN = [
  '  ✨ Update available! 0.166.0 -> 0.167.0',
  '',
  '  Release notes: https://example.com/releases',
  '',
  '› 1. Update now',
  '  2. Skip',
  '  3. Skip until next version',
  '',
  '  Press enter to continue',
].join('\n');

describe('matchAgentStartupScreen', () => {
  it('detects the directory trust screen', () => {
    expect(matchAgentStartupScreen(TRUST_SCREEN)).toBe('trust');
  });

  it('detects the Codex update screen', () => {
    expect(matchAgentStartupScreen(CODEX_UPDATE_SCREEN)).toBe('codex-update');
  });

  it('needs both update lines before calling it the Codex update screen', () => {
    expect(matchAgentStartupScreen('Update available! 0.166.0 -> 0.167.0\n› ')).toBeNull();
  });

  it('returns null for an ordinary agent screen', () => {
    expect(matchAgentStartupScreen('› Explain this codebase\n\n  gpt-5 high · 100% context left\n')).toBeNull();
  });
});

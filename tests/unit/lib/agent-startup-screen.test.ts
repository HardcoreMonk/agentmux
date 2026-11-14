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

const CODEX_HOOKS_REVIEW_SCREEN = [
  '  Hooks need review',
  '',
  '  Hooks can run outside the sandbox after you trust them.',
  '',
  '› 1. Trust all and continue',
  "  2. Continue without trusting (hooks won't run)",
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

  // Codex 0.167.0 `tui/src/update_prompt.rs`: "Update available · <current> → <latest>", and the default
  // highlight is "Update now", so an Enter typed into this screen would start an update.
  it('detects the Codex 0.167 update screen', () => {
    const screen = [
      '',
      '  Update available · 0.167.0 → 0.169.0',
      '  Release notes: https://github.com/openai/codex/releases/latest',
      '',
      '› 1. Update now (runs `npm install -g @openai/codex`)',
      '  2. Skip',
      '  3. Skip until next version',
      '',
      '  Press enter to continue · esc to skip',
    ].join('\n');
    expect(matchAgentStartupScreen(screen)).toBe('codex-update');
  });

  it('detects the Codex 0.167 update screen when narrow pane wrapping splits the lines', () => {
    const wrapped = [
      '  Update available ·',
      '  0.167.0 → 0.169.0',
      '› 1. Update now (runs',
      '     `npm install -g @openai/codex`)',
      '  2. Skip',
      '  3. Skip until next',
      '     version',
    ].join('\n');
    expect(matchAgentStartupScreen(wrapped)).toBe('codex-update');
  });

  it('does not treat an update notice in ordinary text as the Codex update screen', () => {
    expect(matchAgentStartupScreen('• Update available · 0.169.0 is out, see the notes.\n\n› ')).toBeNull();
  });

  it('detects the Codex hook review screen', () => {
    expect(matchAgentStartupScreen(CODEX_HOOKS_REVIEW_SCREEN)).toBe('codex-hooks-review');
  });

  it('detects the Codex hook review screen when narrow pane wrapping splits the lines', () => {
    const wrapped = ['  hooks need', '  review', '› 1. Trust all and', '  continue'].join('\n');
    expect(matchAgentStartupScreen(wrapped)).toBe('codex-hooks-review');
  });

  it('does not treat the hook review title in ordinary text as the hook review screen', () => {
    expect(matchAgentStartupScreen('• Hooks need review before the release is cut.\n\n› ')).toBeNull();
  });

  it('returns null for an ordinary agent screen', () => {
    expect(matchAgentStartupScreen('› Explain this codebase\n\n  gpt-5 high · 100% context left\n')).toBeNull();
  });
});

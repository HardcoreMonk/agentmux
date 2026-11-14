import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  codexHooksReviewKeys,
  codexUpdateAnswerKeys,
  isCodexBlockingScreen,
  isCodexTuiReadyContent,
  matchCodexHooksReview,
  matchCodexUpdatePrompt,
} from '@/lib/codex-screen';

const fixture = (name: string): string =>
  fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/codex-screens', `${name}.txt`), 'utf-8');

const FOLDER_TRUST_SCREEN = [
  '> You are in /tmp/project',
  '',
  '  Do you trust the contents of this directory?',
  '',
  '› 1. Yes, continue',
  '  2. No, quit',
].join('\n');

describe('matchCodexHooksReview', () => {
  it('reads the count, options, and selection', () => {
    expect(matchCodexHooksReview(fixture('hooks-review'))).toEqual({
      changedCount: 3,
      options: ['1. Review hooks', '2. Trust all and continue', "3. Continue without trusting (hooks won't run)"],
      selectedIndex: 0,
      trusting: false,
    });
  });

  it('reads a singular count', () => {
    expect(matchCodexHooksReview(fixture('hooks-review-one'))?.changedCount).toBe(1);
  });

  it('marks the trusting card', () => {
    const info = matchCodexHooksReview(fixture('hooks-trusting'));
    expect(info?.trusting).toBe(true);
    expect(info?.options).toHaveLength(3);
  });

  it('ignores a plain sentence', () => {
    expect(matchCodexHooksReview('Hooks need review before you can continue.')).toBeNull();
  });

  it('reads a 40-column wrapped screen the same way', () => {
    const wrapped = matchCodexHooksReview(fixture('hooks-review-wrapped'));
    expect(wrapped).toMatchObject({ changedCount: 3, selectedIndex: 0, trusting: false });
    expect(wrapped?.options).toHaveLength(3);
    expect(codexHooksReviewKeys(wrapped!, 'trust')).toBe('2\r');
    expect(codexHooksReviewKeys(wrapped!, 'skip')).toBe('3');
  });
});

describe('matchCodexUpdatePrompt', () => {
  it('reads the 0.167 prompt', () => {
    expect(matchCodexUpdatePrompt(fixture('update-prompt'))).toEqual({
      status: 'prompt',
      currentVersion: '0.169.0',
      latestVersion: '0.170.0',
      updateCommand: 'npm install -g @openai/codex',
    });
  });

  it('reads the older format', () => {
    const text = 'Update available! 0.166.0 -> 0.167.0\n› 1. Update now (runs `npm i -g x`)\n  3. Skip until next version';
    expect(matchCodexUpdatePrompt(text)).toMatchObject({ status: 'prompt', currentVersion: '0.166.0', latestVersion: '0.167.0' });
  });

  it.each(['updating', 'success', 'failed'] as const)('reads the %s screen', (status) => {
    expect(matchCodexUpdatePrompt(fixture(`update-${status}`))?.status).toBe(status);
  });

  it('is null for an ordinary screen', () => {
    expect(matchCodexUpdatePrompt(fixture('tui-ready'))).toBeNull();
  });
});

describe('isCodexTuiReadyContent', () => {
  it('is true on the input box', () => {
    expect(isCodexTuiReadyContent(fixture('tui-ready'))).toBe(true);
  });

  it('is true when only blank lines follow the input box', () => {
    expect(isCodexTuiReadyContent(`  > _ Codex\n› Ask Codex${'\n'.repeat(11)}`)).toBe(true);
  });

  it.each([
    ['numbered choices', '  Update available · 1.0.0 → 1.1.0\n› 1. Update now (runs `x`)\n  3. Skip until next version'],
    ['disabled input', '› Input disabled.'],
    ['empty screen', ''],
  ])('is false for %s', (_name, text) => {
    expect(isCodexTuiReadyContent(text)).toBe(false);
  });

  it('is false for the hook review and trusting cards', () => {
    expect(isCodexTuiReadyContent(fixture('hooks-review'))).toBe(false);
    expect(isCodexTuiReadyContent(fixture('hooks-trusting'))).toBe(false);
  });

  it('is false for the older "Input disabled." line', () => {
    expect(isCodexTuiReadyContent('› Ask Codex\nInput disabled.')).toBe(false);
  });
});

describe('answer keys', () => {
  it('maps hook answers', () => {
    const info = matchCodexHooksReview(fixture('hooks-review'))!;
    expect(codexHooksReviewKeys(info, 'trust')).toBe('2\r');
    expect(codexHooksReviewKeys(info, 'skip')).toBe('3');
    expect(codexHooksReviewKeys({ ...info, trusting: true }, 'trust')).toBeNull();
    expect(codexHooksReviewKeys({ ...info, options: [] }, 'trust')).toBeNull();
  });

  it('maps update answers', () => {
    expect(codexUpdateAnswerKeys('update')).toBe('1');
    expect(codexUpdateAnswerKeys('skip')).toBe('2');
    expect(codexUpdateAnswerKeys('skip-version')).toBe('3');
  });
});

describe('isCodexBlockingScreen', () => {
  it.each([
    ['update prompt', fixture('update-prompt')],
    ['updating', fixture('update-updating')],
    ['hook review', fixture('hooks-review')],
    ['hook trusting', fixture('hooks-trusting')],
    ['folder trust', FOLDER_TRUST_SCREEN],
  ])('is true for %s', (_name, text) => {
    expect(isCodexBlockingScreen(text)).toBe(true);
  });

  it.each([
    ['input box', fixture('tui-ready')],
    ['update success', fixture('update-success')],
    ['update failed', fixture('update-failed')],
  ])('is false for %s', (_name, text) => {
    expect(isCodexBlockingScreen(text)).toBe(false);
  });
});

const diffed = (text: string): string =>
  text.split('\n').map((line, i) => `  ${String(i + 1).padStart(3)} +${line}`).join('\n');

describe('quoted screens in the conversation', () => {
  const reproduction = [
    '    2 +  Hooks need review',
    '    3 +  3 hooks are new or changed.',
    '    7 +› 1. Review hooks',
    '    8 +  2. Trust all and continue',
    "    9 +  3. Continue without trusting (hooks won't run)",
    '',
    '› Ask Codex to do anything',
  ].join('\n');

  it('does not read a diffed hook review as a card', () => {
    expect(matchCodexHooksReview(reproduction)).toBeNull();
    expect(isCodexBlockingScreen(reproduction)).toBe(false);
    expect(isCodexTuiReadyContent(reproduction)).toBe(true);
  });

  it('does not read a sentence quoting the card text', () => {
    const text = '• The screen says "Hooks need review" and offers "Trust all and continue".\n› Ask Codex';
    expect(matchCodexHooksReview(text)).toBeNull();
  });

  it('does not read a diffed update prompt', () => {
    expect(matchCodexUpdatePrompt(diffed(fixture('update-prompt')))).toBeNull();
    expect(matchCodexUpdatePrompt(diffed(fixture('update-success')))).toBeNull();
  });
});

describe('the latest update line wins', () => {
  it.each(['updating', 'success', 'failed'] as const)('reads %s below an old prompt', (status) => {
    const text = `${fixture('update-prompt')}\n${fixture(`update-${status}`)}`;
    expect(matchCodexUpdatePrompt(text)?.status).toBe(status);
  });

  it('reads a wrapped update command', () => {
    const text = [
      '› 1. Update now (runs `npm install -g',
      '  @openai/codex`)',
      '  3. Skip until next version',
    ].join('\n');
    expect(matchCodexUpdatePrompt(text)?.updateCommand).toBe('npm install -g @openai/codex');
  });
});

describe('screens the TUI wrapped in a narrow pane', () => {
  const narrowUpdate = [
    '  Update available ·',
    '  0.167.0 → 0.169.0',
    '› 1. Update now (runs',
    '     `npm install -g @openai/codex`)',
    '  2. Skip',
    '  3. Skip until next',
    '     version',
  ].join('\n');
  const narrowHooks = ['  Hooks need', '  review', '  2 hooks are new', '  or changed.', '› 1. Review hooks', '  2. Trust all and', '  continue'].join('\n');

  it('reads a wrapped update prompt', () => {
    expect(matchCodexUpdatePrompt(narrowUpdate)).toMatchObject({
      status: 'prompt',
      currentVersion: '0.167.0',
      latestVersion: '0.169.0',
      updateCommand: 'npm install -g @openai/codex',
    });
    expect(isCodexBlockingScreen(narrowUpdate)).toBe(true);
  });

  it('reads a wrapped hook review', () => {
    const info = matchCodexHooksReview(narrowHooks);
    expect(info).toMatchObject({ changedCount: 2, selectedIndex: 0, trusting: false });
    expect(info?.options).toEqual(['1. Review hooks', '2. Trust all and continue']);
    expect(codexHooksReviewKeys(info!, 'trust')).toBe('2\r');
    expect(isCodexBlockingScreen(narrowHooks)).toBe(true);
  });

  it('still ignores diffed copies of the wrapped text', () => {
    expect(matchCodexUpdatePrompt(diffed(narrowUpdate))).toBeNull();
    expect(matchCodexHooksReview(diffed(narrowHooks))).toBeNull();
  });
});

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { createTrustPromptTracker, matchTrustPrompt, trustAnswerKeys } from '@/lib/trust-prompt-detector';

const CLAUDE_SCREEN = [
  ' Accessing workspace:',
  '',
  ' /tmp/x',
  '',
  ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team).',
  " Claude Code'll be able to read, edit, and execute files here.",
  '',
  ' Security guide',
  '',
  ' ❯ No, exit',
  '   Yes, I trust this folder',
  '',
  ' Enter to confirm · Esc to cancel',
].join('\n');

const CODEX_SCREEN = [
  '> You are in /tmp/y',
  '',
  '  Do you trust the contents of this directory?',
  '',
  '› 1. Yes, continue',
  '  2. No, quit',
].join('\n');

describe('matchTrustPrompt', () => {
  it('Claude 번호 없는 trust 화면을 선택지와 현재 위치까지 감지한다', () => {
    expect(matchTrustPrompt(CLAUDE_SCREEN)).toEqual({
      agent: 'claude',
      folderPath: '/tmp/x',
      options: ['No, exit', 'Yes, I trust this folder'],
      selectedIndex: 0,
    });
  });

  it('Quick safety check 문구가 바뀌어도 선택지 두 개로 감지한다', () => {
    const screen = ['Accessing workspace:', '/tmp/z', '  No, exit', '❯ Yes, I trust this folder'].join('\n');
    const info = matchTrustPrompt(screen);
    expect(info?.agent).toBe('claude');
    expect(info?.folderPath).toBe('/tmp/z');
    expect(info?.selectedIndex).toBe(1);
  });

  it('Codex 번호 선택지 화면을 감지한다', () => {
    const info = matchTrustPrompt(CODEX_SCREEN);
    expect(info?.agent).toBe('codex');
    expect(info?.folderPath).toBe('/tmp/y');
  });

  it('일반 출력은 null이다', () => {
    expect(matchTrustPrompt('$ ls\nfoo bar\n')).toBeNull();
  });
});

describe('trustAnswerKeys', () => {
  const info = matchTrustPrompt(CLAUDE_SCREEN)!;

  it('Claude yes는 화살표로 이동 후 Enter, no는 Esc다', () => {
    expect(trustAnswerKeys(info, 'yes')).toBe('\x1b[B\r');
    expect(trustAnswerKeys(info, 'no')).toBe('\x1b');
  });

  it('이미 목표 선택지에 있으면 Enter만 보낸다', () => {
    expect(trustAnswerKeys({ ...info, selectedIndex: 1 }, 'yes')).toBe('\r');
  });

  it('Codex는 숫자 키를 쓴다', () => {
    const codex = matchTrustPrompt(CODEX_SCREEN)!;
    expect(trustAnswerKeys(codex, 'yes')).toBe('1');
    expect(trustAnswerKeys(codex, 'no')).toBe('2');
  });
});

describe('createTrustPromptTracker', () => {
  const makeTracker = () => {
    let t = 0;
    const tracker = createTrustPromptTracker(() => t);
    return { tracker, advance: (ms: number) => { t += ms; } };
  };

  it('탭 전환 뒤 이전 탭의 응답은 키를 보내지 않는다', () => {
    const { tracker } = makeTracker();
    expect(tracker.observe('a', CLAUDE_SCREEN)).not.toBeNull();
    // 탭 B로 전환: B 화면은 trust가 아님
    expect(tracker.observe('b', '$ ls')).toBeNull();
    expect(tracker.respond('b', 'yes')).toBeNull();
    expect(tracker.respond('a', 'yes')).toBeNull();
  });

  it('reset 뒤에는 응답이 키를 보내지 않는다', () => {
    const { tracker } = makeTracker();
    tracker.observe('a', CLAUDE_SCREEN);
    tracker.reset();
    expect(tracker.respond('a', 'yes')).toBeNull();
  });

  it('응답 직후 같은 화면이 재감지되어도 카드를 다시 띄우지 않는다', () => {
    const { tracker, advance } = makeTracker();
    tracker.observe('a', CLAUDE_SCREEN);
    expect(tracker.respond('a', 'yes')).toBe('\x1b[B\r');
    advance(250);
    expect(tracker.observe('a', CLAUDE_SCREEN)).toBeNull();
    advance(2000);
    expect(tracker.observe('a', CLAUDE_SCREEN)).not.toBeNull();
  });

  it('화면이 trust가 아니게 되면 suppress가 풀린다', () => {
    const { tracker } = makeTracker();
    tracker.observe('a', CLAUDE_SCREEN);
    tracker.respond('a', 'no');
    expect(tracker.observe('a', '$ ')).toBeNull();
    expect(tracker.observe('a', CLAUDE_SCREEN)).not.toBeNull();
  });
});

const folderFixture = (name: string): string =>
  fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/codex-screens', `${name}.txt`), 'utf-8');

describe('Codex 0.169 folder access screen', () => {
  it('reads the folder trust screen', () => {
    expect(matchTrustPrompt(folderFixture('folder-trust'))).toEqual({
      agent: 'codex',
      folderPath: '~/work/demo',
      options: ['Trust and continue', 'Back to Agent Command Center'],
      selectedIndex: 0,
    });
  });

  it('reads the screen wrapped at 40 columns', () => {
    const wrapped = [
      '  Folder access',
      '  ~/work/a-long-checkout-name',
      '',
      '  Trust this folder? Codex can read,',
      '  edit, and run files here, subject to',
      '  your permission settings.',
      '',
      '› 1. Trust and continue',
      '  2. Quit',
      '',
      '  enter continue · esc quit',
    ].join('\n');
    const info = matchTrustPrompt(wrapped);
    expect(info?.agent).toBe('codex');
    expect(info?.folderPath).toBe('~/work/a-long-checkout-name');
    expect(info?.options).toEqual(['Trust and continue', 'Quit']);
  });

  it('ignores a pasted copy that has the input box below', () => {
    const quoted = `${folderFixture('folder-trust')}\n› Ask Codex to do anything\n`;
    expect(matchTrustPrompt(quoted)).toBeNull();
  });

  it('does not treat the restricted variant as a trust prompt', () => {
    expect(matchTrustPrompt(folderFixture('folder-restricted'))).toBeNull();
  });

  it('confirms the new screen with Enter and declines with 2', () => {
    const info = matchTrustPrompt(folderFixture('folder-trust'))!;
    expect(trustAnswerKeys(info, 'yes')).toBe('1\r');
    expect(trustAnswerKeys(info, 'no')).toBe('2');
  });

  it('keeps the old screen keys', () => {
    const info = matchTrustPrompt(CODEX_SCREEN)!;
    expect(trustAnswerKeys(info, 'yes')).toBe('1');
    expect(trustAnswerKeys(info, 'no')).toBe('2');
  });
});

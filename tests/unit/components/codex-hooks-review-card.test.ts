import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import koTerminal from '@/../messages/ko/terminal.json';
import enTerminal from '@/../messages/en/terminal.json';
import type { ICodexHooksReviewInfo } from '@/lib/codex-screen';

import CodexHooksReviewCard from '@/components/features/workspace/codex-hooks-review-card';

const Provider = NextIntlClientProvider as React.ComponentType<{
  locale: string;
  timeZone: string;
  messages: Record<string, unknown>;
  children?: React.ReactNode;
}>;

const OPTIONS = ['1. Review hooks', '2. Trust all and continue', "3. Continue without trusting (hooks won't run)"];

const render = (
  info: Partial<ICodexHooksReviewInfo>,
  fingerprintTrusted: boolean,
  locale: 'ko' | 'en' = 'ko',
) => renderToStaticMarkup(React.createElement(Provider, {
  locale,
  timeZone: 'Asia/Seoul',
  messages: { terminal: locale === 'ko' ? koTerminal : enTerminal },
}, React.createElement(CodexHooksReviewCard, {
  info: { changedCount: 3, options: OPTIONS, selectedIndex: 0, trusting: false, ...info },
  hookCount: 3,
  fingerprintTrusted,
  onRespond: () => undefined,
})));

const buttons = (html: string): number => (html.match(/<button/g) ?? []).length;

describe('CodexHooksReviewCard', () => {
  it('shows trust and skip when the count matches and the hook is not trusted yet', () => {
    const html = render({}, false);

    expect(buttons(html)).toBe(2);
    expect(html).toContain('모두 trust하고 계속');
    expect(html).toContain('trust하지 않고 계속');
    expect(html).toContain('3개 hook이 새로 생겼거나 바뀌었습니다');
    expect(html).toContain('agentmux가 붙이는 hook 수와 같습니다');
  });

  it('hides trust and explains when the fingerprint is already trusted', () => {
    const html = render({}, true);

    expect(buttons(html)).toBe(1);
    expect(html).not.toContain('모두 trust하고 계속');
    expect(html).toContain('agentmux 밖의 hook이 포함돼 있을 수 있습니다');
  });

  it.each([1, null])('hides trust when the changed count is %s', (changedCount) => {
    expect(buttons(render({ changedCount }, false))).toBe(1);
  });

  it('hides trust when the trust option cannot be read', () => {
    expect(buttons(render({ options: [] }, false))).toBe(1);
  });

  it('shows only progress while trusting', () => {
    const html = render({ trusting: true }, false);

    expect(buttons(html)).toBe(0);
    expect(html).toContain('hook을 trust하는 중');
  });

  it('renders the English copy', () => {
    const html = render({}, false, 'en');

    expect(html).toContain('Trust all and continue');
    expect(html).toContain('Continue without trusting');
  });
});

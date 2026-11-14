import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import koTerminal from '@/../messages/ko/terminal.json';
import enTerminal from '@/../messages/en/terminal.json';
import type { ICodexUpdatePromptInfo, TCodexUpdateStatus } from '@/lib/codex-screen';

import CodexUpdateCard from '@/components/features/workspace/codex-update-card';

const Provider = NextIntlClientProvider as React.ComponentType<{
  locale: string;
  timeZone: string;
  messages: Record<string, unknown>;
  children?: React.ReactNode;
}>;

const render = (status: TCodexUpdateStatus, locale: 'ko' | 'en' = 'ko') => renderToStaticMarkup(React.createElement(Provider, {
  locale,
  timeZone: 'Asia/Seoul',
  messages: { terminal: locale === 'ko' ? koTerminal : enTerminal },
}, React.createElement(CodexUpdateCard, {
  info: {
    status,
    currentVersion: '0.169.0',
    latestVersion: '0.170.0',
    updateCommand: 'npm install -g @openai/codex',
  } satisfies ICodexUpdatePromptInfo,
  onRespond: () => undefined,
  onRestart: () => undefined,
})));

const buttons = (html: string): number => (html.match(/<button/g) ?? []).length;

describe('CodexUpdateCard', () => {
  it('shows the versions, the command, and three buttons for the prompt', () => {
    const html = render('prompt');

    expect(buttons(html)).toBe(3);
    expect(html).toContain('Codex 업데이트: 0.169.0 → 0.170.0');
    expect(html).toContain('npm install -g @openai/codex');
    expect(html).toContain('Update now');
    expect(html).toContain('Skip until next version');
  });

  it('shows progress without buttons while updating', () => {
    const html = render('updating');

    expect(buttons(html)).toBe(0);
    expect(html).toContain('업데이트하는 중');
  });

  it('shows the restart button after a successful update', () => {
    const html = render('success');

    expect(buttons(html)).toBe(1);
    expect(html).toContain('업데이트됐습니다. Codex를 다시 시작하세요');
    expect(html).toContain('다시 시작');
  });

  it('shows the restart button after a failed update', () => {
    const html = render('failed');

    expect(buttons(html)).toBe(1);
    expect(html).toContain('업데이트에 실패했습니다. terminal에서 오류를 확인하세요');
  });

  it('renders the English copy', () => {
    expect(render('success', 'en')).toContain('Restart');
  });
});

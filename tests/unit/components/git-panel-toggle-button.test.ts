import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import koTerminal from '@/../messages/ko/terminal.json';
import enTerminal from '@/../messages/en/terminal.json';
import { TooltipProvider } from '@/components/ui/tooltip';
import GitPanelToggleButton from '@/components/features/workspace/git-panel-toggle-button';

const Provider = NextIntlClientProvider as React.ComponentType<{
  locale: string;
  timeZone: string;
  messages: Record<string, unknown>;
  children?: React.ReactNode;
}>;

const render = (open: boolean, locale: 'ko' | 'en' = 'ko') =>
  renderToStaticMarkup(
    React.createElement(
      Provider,
      {
        locale,
        timeZone: 'Asia/Seoul',
        messages: { terminal: locale === 'ko' ? koTerminal : enTerminal },
      },
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(GitPanelToggleButton, {
          open,
          onToggle: () => undefined,
        }),
      ),
    ),
  );

describe('GitPanelToggleButton', () => {
  it('sets aria-pressed and aria-label when closed and open in ko and en', () => {
    const closedKo = render(false, 'ko');
    expect(closedKo).toContain('aria-pressed="false"');
    expect(closedKo).toContain('aria-label="Git 패널 열기"');

    const openKo = render(true, 'ko');
    expect(openKo).toContain('aria-pressed="true"');
    expect(openKo).toContain('aria-label="Git 패널 닫기"');

    const closedEn = render(false, 'en');
    expect(closedEn).toContain('aria-label="Open Git panel"');

    const openEn = render(true, 'en');
    expect(openEn).toContain('aria-label="Close Git panel"');
  });
});

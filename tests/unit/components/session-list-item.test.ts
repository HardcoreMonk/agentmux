import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import SessionListItem from '@/components/features/workspace/session-list-item';
import enSession from '@/../messages/en/session.json';
import koSession from '@/../messages/ko/session.json';
import type { ISessionMeta } from '@/types/timeline';

const session = (providerId?: 'codex' | 'claude'): ISessionMeta => ({
  sessionId: 'session-1',
  startedAt: '2026-11-11T00:00:00.000Z',
  lastActivityAt: '2026-11-11T00:00:00.000Z',
  firstMessage: 'hello',
  turnCount: 2,
  providerId,
} as ISessionMeta);

const render = (item: ISessionMeta, locale: 'en' | 'ko' = 'en') =>
  renderToStaticMarkup(React.createElement(NextIntlClientProvider, {
    locale,
    messages: { session: locale === 'en' ? enSession : koSession },
    children: React.createElement(SessionListItem, {
      session: item,
      isResuming: false,
      isDisabled: false,
      onSelect: vi.fn(),
    }),
  } as React.ComponentProps<typeof NextIntlClientProvider>));

describe('SessionListItem provider badge', () => {
  it('shows the Claude icon and the Claude Code label', () => {
    const html = render(session('claude'));
    expect(html).toContain('Claude Code');
    expect(html).toContain('data-provider="claude"');
    expect(html).toContain('<svg');
  });

  it('shows the Codex label for a Codex item', () => {
    const html = render(session('codex'));
    expect(html).toContain('Codex');
    expect(html).toContain('data-provider="codex"');
  });

  it('shows no provider badge when the provider is unknown', () => {
    expect(render(session(undefined))).not.toContain('data-provider');
  });
});

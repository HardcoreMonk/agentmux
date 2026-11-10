import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import AgentBootView from '@/components/features/workspace/agent-boot-view';
import type { TAgentBootDisplay } from '@/lib/agent-boot-display';
import enTimeline from '@/../messages/en/timeline.json';
import koTimeline from '@/../messages/ko/timeline.json';
import type { TAgentPanelType } from '@/types/terminal';

const render = (panelType: TAgentPanelType, display: TAgentBootDisplay, locale: 'en' | 'ko' = 'en') =>
  renderToStaticMarkup(React.createElement(NextIntlClientProvider, {
    locale,
    messages: { timeline: locale === 'en' ? enTimeline : koTimeline },
    children: React.createElement(AgentBootView, { panelType, display, onCheckTerminal: vi.fn() }),
  } as React.ComponentProps<typeof NextIntlClientProvider>));

describe('AgentBootView', () => {
  it('names the provider while starting', () => {
    const html = render('claude', 'starting');
    expect(html).toContain('Claude Code');
    expect(html).toContain('data-provider="claude"');
  });

  it('names the provider while waiting for the session', () => {
    expect(render('codex', 'waiting-session')).toContain('Codex');
  });

  it('offers the terminal recovery action as a 44px target', () => {
    const html = render('claude', 'recover');
    expect(html).toContain('<button');
    expect(html).toContain('min-h-11');
  });

  it('renders nothing for trust, bypass and null', () => {
    expect(render('claude', 'trust')).toBe('');
    expect(render('claude', 'bypass')).toBe('');
    expect(render('claude', null)).toBe('');
  });

  it('localizes the starting copy in Korean', () => {
    expect(render('claude', 'starting', 'ko')).toContain('시작');
  });
});

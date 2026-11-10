import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SidebarRateLimits from '@/components/layout/sidebar-rate-limits';
import koSidebar from '@/../messages/ko/sidebar.json';
import type { IRateLimitsData } from '@/types/status';

const state = vi.hoisted(() => ({ byProvider: {} as Record<string, unknown> }));

// renderToStaticMarkup reads the zustand initial snapshot, so serve the state directly.
vi.mock('@/hooks/use-rate-limits-store', () => ({
  default: (selector: (value: typeof state) => unknown) => selector(state),
}));

const Provider = NextIntlClientProvider as React.ComponentType<{
  locale: string;
  timeZone: string;
  messages: Record<string, unknown>;
  children?: React.ReactNode;
}>;

const limits = (): IRateLimitsData => ({
  ts: Date.now(),
  five_hour: { used_percentage: 30, resets_at: Date.now() / 1000 + 3600, observed_at: Date.now() },
  seven_day: null,
});

const render = () => renderToStaticMarkup(React.createElement(Provider, {
  locale: 'ko',
  timeZone: 'Asia/Seoul',
  messages: { sidebar: koSidebar },
}, React.createElement(SidebarRateLimits)));

describe('SidebarRateLimits', () => {
  beforeEach(() => {
    state.byProvider = {};
  });

  it('renders nothing without data', () => {
    expect(render()).toBe('');
  });

  it('renders one labeled row per provider with data', () => {
    state.byProvider = { codex: limits() };
    let html = render();
    expect(html).toContain('Codex');
    expect(html).not.toContain('Claude Code');
    expect(html.match(/data-provider=/g)).toHaveLength(1);

    state.byProvider = { codex: limits(), claude: limits() };
    html = render();
    expect(html).toContain('Codex');
    expect(html).toContain('Claude Code');
    expect(html.match(/data-provider=/g)).toHaveLength(2);
  });
});

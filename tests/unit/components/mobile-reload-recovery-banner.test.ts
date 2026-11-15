import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import koConnection from '@/../messages/ko/connection.json';
import enConnection from '@/../messages/en/connection.json';

let mockIsMobile = true;
let mockVisible = true;

vi.mock('@/hooks/use-is-mobile-device', () => ({
  default: () => mockIsMobile,
}));

vi.mock('@/hooks/use-page-visible', () => ({
  default: () => mockVisible,
}));

import MobileReloadRecoveryBanner from '@/components/features/mobile/mobile-reload-recovery-banner';

const Provider = NextIntlClientProvider as React.ComponentType<{
  locale: string;
  timeZone: string;
  messages: Record<string, unknown>;
  children?: React.ReactNode;
}>;

const render = (failures: number, locale: 'ko' | 'en' = 'ko') =>
  renderToStaticMarkup(
    React.createElement(
      Provider,
      {
        locale,
        timeZone: 'Asia/Seoul',
        messages: { connection: locale === 'ko' ? koConnection : enConnection },
      },
      React.createElement(MobileReloadRecoveryBanner, { failures }),
    ),
  );

describe('MobileReloadRecoveryBanner', () => {
  beforeEach(() => {
    mockIsMobile = true;
    mockVisible = true;
  });

  it('renders the recovery message and reload button when mobile, visible, and failures >= 5', () => {
    const html = render(5, 'ko');

    expect(html).toContain('연결이 계속 실패합니다. 새로고침하면 복구될 수 있습니다.');
    expect(html).toContain('aria-label="새로고침"');
    expect(html).toContain('min-h-11');
    expect(html).toContain('[word-break:keep-all]');
  });

  it('renders the English copy when locale is en', () => {
    const html = render(6, 'en');

    expect(html).toContain('The connection keeps failing. Reloading may restore it.');
    expect(html).toContain('aria-label="Reload"');
  });

  it('renders nothing when failures are below threshold, not mobile, or hidden', () => {
    expect(render(4)).toBe('');

    mockIsMobile = false;
    expect(render(5)).toBe('');

    mockIsMobile = true;
    mockVisible = false;
    expect(render(5)).toBe('');
  });
});

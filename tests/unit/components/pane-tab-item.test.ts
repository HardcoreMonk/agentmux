import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import type { ITab } from '@/types/terminal';
import koTerminal from '@/../messages/ko/terminal.json';
import enTerminal from '@/../messages/en/terminal.json';
import koWorkspace from '@/../messages/ko/workspace.json';
import enWorkspace from '@/../messages/en/workspace.json';

import PaneTabItem from '@/components/features/workspace/pane-tab-item';

const Provider = NextIntlClientProvider as React.ComponentType<{
  locale: string;
  timeZone: string;
  messages: Record<string, unknown>;
  children?: React.ReactNode;
}>;

const baseTab = { id: 'tab-a', sessionName: 'pt-ws-a-pane-a-tab-a', name: 'build', order: 0, panelType: 'terminal' } as ITab;

const render = (tab: ITab, locale: 'ko' | 'en' = 'en') => renderToStaticMarkup(React.createElement(Provider, {
  locale,
  timeZone: 'Asia/Seoul',
  messages: locale === 'ko'
    ? { terminal: koTerminal, workspace: koWorkspace }
    : { terminal: enTerminal, workspace: enWorkspace },
}, React.createElement(PaneTabItem, {
  tab,
  isActive: false,
  isDragging: false,
  dropSide: null,
  onSwitch: () => undefined,
  onDelete: () => undefined,
  onRename: () => undefined,
  onFocusPane: () => undefined,
  onDragStart: () => undefined,
  onDragEnd: () => undefined,
  onDragOver: () => undefined,
  onDragLeave: () => undefined,
})));

describe('PaneTabItem delegated marker', () => {
  it('draws no marker for a tab without a creator', () => {
    const html = render(baseTab);
    expect(html).not.toContain('Created by an agent');
    expect(html).not.toContain('data-slot="delegated-tab-marker"');
  });

  it('draws the icon and a screen reader label for a tab created by an agent', () => {
    const html = render({ ...baseTab, createdByTabId: 'tab-b' });
    expect(html).toContain('data-slot="delegated-tab-marker"');
    expect(html).toContain('title="Created by an agent"');
    expect(html).toContain('>Created by an agent</span>');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it('localizes the label in ko', () => {
    expect(render({ ...baseTab, createdByTabId: 'tab-b' }, 'ko')).toContain('>Agent가 만든 탭</span>');
  });
});

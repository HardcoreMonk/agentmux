import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ITabState } from '@/hooks/use-tab-store';
import type { IPaneNode, ITab, IWorkspace } from '@/types/terminal';
import koMobile from '@/../messages/ko/mobile.json';
import enMobile from '@/../messages/en/mobile.json';
import koWorkspace from '@/../messages/ko/workspace.json';
import enWorkspace from '@/../messages/en/workspace.json';

const state = vi.hoisted(() => ({
  tabs: {} as Record<string, ITabState>,
}));

vi.mock('@/hooks/use-tab-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/hooks/use-tab-store')>(),
  default: (selector: (value: typeof state) => unknown) => selector(state),
}));

import MobileWorkspaceTabBar from '@/components/features/mobile/mobile-workspace-tab-bar';

const Provider = NextIntlClientProvider as React.ComponentType<{
  locale: string;
  timeZone: string;
  messages: Record<string, unknown>;
  children?: React.ReactNode;
}>;

const WORKSPACES: IWorkspace[] = [{ id: 'ws-a', name: 'Alpha', directories: ['/repo/a'] }];

const makeTab = (id: string, order: number, extra: Partial<ITab> = {}): ITab => ({
  id,
  sessionName: `pt-ws-a-pane-a-${id}`,
  name: id,
  order,
  ...extra,
});

const PANE: IPaneNode = {
  type: 'pane',
  id: 'pane-a',
  tabs: [
    makeTab('tab-user', 0, { panelType: 'claude' }),
    makeTab('tab-delegated', 1, { panelType: 'codex', createdByTabId: 'tab-user' }),
  ],
  activeTabId: 'tab-user',
};

const renderBar = (selectedTabId: string, locale: 'ko' | 'en' = 'en') =>
  renderToStaticMarkup(React.createElement(Provider, {
    locale,
    timeZone: 'Asia/Seoul',
    messages: locale === 'ko'
      ? { mobile: koMobile, workspace: koWorkspace }
      : { mobile: enMobile, workspace: enWorkspace },
  }, React.createElement(MobileWorkspaceTabBar, {
    workspaces: WORKSPACES,
    activeWorkspaceId: 'ws-a',
    workspaceLayouts: { 'ws-a': [PANE] },
    selectedPaneId: 'pane-a',
    selectedTabId,
    onSelect: () => undefined,
  })));

const ariaLabels = (html: string): string[] =>
  [...html.matchAll(/<button[^>]*aria-label="([^"]*)"/g)].map((match) => match[1]);

describe('MobileWorkspaceTabBar agent-created marker', () => {
  beforeEach(() => {
    state.tabs = {};
  });

  it('adds the marker to the accessible name of a tab created by an agent', () => {
    expect(ariaLabels(renderBar('tab-user'))).toEqual([
      'Current tab: Alpha',
      'Switch to Alpha tab, Created by an agent',
    ]);
  });

  it('keeps the marker when the agent-created tab is the current tab', () => {
    expect(ariaLabels(renderBar('tab-delegated'))).toEqual([
      'Switch to Alpha tab',
      'Current tab: Alpha, Created by an agent',
    ]);
  });

  it('uses the localized marker in Korean', () => {
    expect(ariaLabels(renderBar('tab-user', 'ko'))).toEqual([
      '현재 탭: Alpha',
      'Alpha 탭으로 이동, Agent가 만든 탭',
    ]);
  });
});

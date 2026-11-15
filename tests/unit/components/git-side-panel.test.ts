import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import koDiff from '@/../messages/ko/diff.json';
import enDiff from '@/../messages/en/diff.json';
import type { IGitSidePanelTarget } from '@/lib/git-side-panel-target';
import type { TAgentPanelType } from '@/types/terminal';

const diffMock = vi.hoisted(() => ({
  lastProps: null as Record<string, unknown> | null,
}));

vi.mock('@/components/features/workspace/diff-panel', () => ({
  default: (props: Record<string, unknown>) => {
    diffMock.lastProps = props;
    return React.createElement('div', { 'data-slot': 'diff-panel-mock' });
  },
}));

import GitSidePanel from '@/components/features/workspace/git-side-panel';

const Provider = NextIntlClientProvider as React.ComponentType<{
  locale: string;
  timeZone: string;
  messages: Record<string, unknown>;
  children?: React.ReactNode;
}>;

const target: IGitSidePanelTarget = {
  paneId: 'pane-1',
  tabId: 'tab-1',
  sessionName: 'pt-ws-pane-1-tab-1',
  panelType: 'claude',
};

const render = (
  props: {
    target: IGitSidePanelTarget | null;
    canAsk: boolean;
    askAgentPanelType: TAgentPanelType;
    refreshKey: number;
  },
  locale: 'ko' | 'en' = 'ko',
) =>
  renderToStaticMarkup(
    React.createElement(
      Provider,
      {
        locale,
        timeZone: 'Asia/Seoul',
        messages: { diff: locale === 'ko' ? koDiff : enDiff },
      },
      React.createElement(GitSidePanel, {
        ...props,
        onClose: () => undefined,
        onSendToAgent: () => undefined,
      }),
    ),
  );

describe('GitSidePanel', () => {
  beforeEach(() => {
    diffMock.lastProps = null;
  });

  it('shows the empty prompt and close button when target is null', () => {
    const html = render({
      target: null,
      canAsk: false,
      askAgentPanelType: 'codex',
      refreshKey: 0,
    });

    expect(html).toContain('terminal이나 agent 탭을 먼저 여세요');
    expect(html).toContain('aria-label="Git 패널 닫기"');
    expect(html).not.toContain('data-slot="diff-panel-mock"');
    expect(diffMock.lastProps).toBeNull();
  });

  it('renders DiffPanel with sessionName, askAgentPanelType, refreshKey, and compact: true when target is present', () => {
    const html = render({
      target,
      canAsk: true,
      askAgentPanelType: 'claude',
      refreshKey: 3,
    });

    expect(html).toContain('data-slot="diff-panel-mock"');
    expect(html).toContain('aria-label="Git 패널 닫기"');
    expect(diffMock.lastProps).toMatchObject({
      sessionName: 'pt-ws-pane-1-tab-1',
      askAgentPanelType: 'claude',
      refreshKey: 3,
      compact: true,
    });
    expect(diffMock.lastProps?.onSendToAgent).toBeTypeOf('function');
  });

  it('passes undefined onSendToAgent to DiffPanel when canAsk is false', () => {
    render({
      target,
      canAsk: false,
      askAgentPanelType: 'claude',
      refreshKey: 1,
    });

    expect(diffMock.lastProps?.compact).toBe(true);
    expect(diffMock.lastProps?.onSendToAgent).toBeUndefined();
  });
});

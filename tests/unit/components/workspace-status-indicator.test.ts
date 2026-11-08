import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ITabState } from '@/hooks/use-tab-store';
import type { ITab } from '@/types/terminal';
import WorkspaceStatusIndicator from '@/components/features/workspace/workspace-status-indicator';
import koWorkspace from '@/../messages/ko/workspace.json';
import enWorkspace from '@/../messages/en/workspace.json';
import koTerminal from '@/../messages/ko/terminal.json';
import enTerminal from '@/../messages/en/terminal.json';

const state = vi.hoisted(() => ({
  tabs: {} as Record<string, ITabState>,
  tabOrders: {} as Record<string, string[]>,
  statusWsConnected: true,
  statusSynced: true,
}));

vi.mock('@/hooks/use-tab-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/hooks/use-tab-store')>(),
  default: (selector: (value: typeof state) => unknown) => selector(state),
}));

const Provider = NextIntlClientProvider as React.ComponentType<{
  locale: string;
  timeZone: string;
  messages: Record<string, unknown>;
  children?: React.ReactNode;
}>;

const renderIndicator = (locale: 'ko' | 'en' = 'ko', tabs?: ITab[]) =>
  renderToStaticMarkup(React.createElement(Provider, {
    locale,
    timeZone: 'Asia/Seoul',
    messages: {
      workspace: locale === 'ko' ? koWorkspace : enWorkspace,
      terminal: locale === 'ko' ? koTerminal : enTerminal,
    },
  }, React.createElement(WorkspaceStatusIndicator, { workspaceId: 'ws', tabs })));

const addTab = (id: string, overrides: Partial<ITabState> = {}) => {
  state.tabs[id] = {
    terminalConnected: false, agentProcess: null, agentProcessCheckedAt: 0,
    agentInstalled: true, sessionView: 'timeline', cliState: 'inactive',
    isTimelineLoading: false, workspaceId: 'ws', panelType: 'codex', ...overrides,
  };
};

describe('WorkspaceStatusIndicator', () => {
  beforeEach(() => {
    state.tabs = {};
    state.tabOrders = {};
    state.statusWsConnected = true;
    state.statusSynced = true;
  });

  it('labels synced empty workspaces in Korean and English', () => {
    expect(renderIndicator()).toContain('작업 없음');
    expect(renderIndicator('en')).toContain('No active tasks');
  });

  it.each([
    ['busy', '작업 중', 'Working'],
    ['needs-input', '입력 대기', 'Input needed'],
    ['ready-for-review', '확인 필요', 'Review needed'],
    ['unknown', '상태 미확인', 'Status unknown'],
    ['idle', '작업 없음', 'No active tasks'],
    ['inactive', '작업 없음', 'No active tasks'],
  ] as const)('labels %s tabs in both locales', (cliState, ko, en) => {
    addTab('agent', { cliState });
    expect(renderIndicator()).toContain(ko);
    expect(renderIndicator('en')).toContain(en);
  });

  it('does not count other workspaces or a terminal server as agent work', () => {
    addTab('other', { workspaceId: 'other-ws', cliState: 'needs-input' });
    addTab('server', { panelType: 'terminal', terminalStatus: 'server', cliState: 'busy' });
    const markup = renderIndicator();
    expect(markup).toContain('작업 없음');
    expect(markup).toContain('text-ui-green');
    expect(markup).not.toContain('bg-ui-amber');
  });

  it('keeps the individual busy and review indicators when input takes priority', () => {
    addTab('busy', { cliState: 'busy' });
    addTab('input', { cliState: 'needs-input' });
    addTab('review', { cliState: 'ready-for-review' });
    const markup = renderIndicator();
    expect(markup).toContain('입력 대기');
    expect(markup).toContain('animate-spin');
    expect(markup).toContain('bg-agent-active');
    expect(markup).toContain('bg-ui-amber');
  });

  it('does not mistake missing layout tab status for idle or use another workspace', () => {
    const tabs: ITab[] = [{ id: 'missing', sessionName: 'session', name: '', order: 0, panelType: 'codex' }];
    expect(renderIndicator('ko', tabs)).toContain('상태 미확인');
    addTab('missing', { workspaceId: 'other-ws', cliState: 'busy' });
    expect(renderIndicator('ko', tabs)).toContain('상태 미확인');
  });

  it('waits for full sync on initial connection and while disconnected', () => {
    addTab('cached', { cliState: 'idle' });
    state.statusSynced = false;
    expect(renderIndicator()).toContain('상태 확인 중');
    expect(renderIndicator('en')).toContain('Checking status');
    expect(renderIndicator()).not.toContain('작업 없음');
    state.statusSynced = true;
    state.statusWsConnected = false;
    expect(renderIndicator()).toContain('상태 확인 중');
  });
});

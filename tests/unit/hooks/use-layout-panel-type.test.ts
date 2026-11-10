import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import useTabStore from '@/hooks/use-tab-store';
import { useLayoutStore } from '@/hooks/use-layout';
import type { ILayoutData } from '@/types/terminal';

vi.mock('next/router', () => ({
  default: {
    pathname: '/',
    push: vi.fn(),
  },
}));

const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({
  toast: {
    error: toastError,
    info: vi.fn(),
  },
}));

vi.mock('@/lib/i18n', async () => {
  const messages = (await import('../../../messages/en/terminal.json')).default as Record<string, string>;
  return { t: (_namespace: string, key: string) => messages[key] ?? key };
});

vi.mock('@/hooks/use-web-input', () => ({
  clearInputDraft: vi.fn(),
}));

vi.mock('@/hooks/use-workspace-store', () => ({
  default: {
    getState: () => ({
      activeWorkspaceId: 'ws-test',
      switchWorkspace: vi.fn(),
    }),
  },
}));

vi.mock('@/hooks/use-tab-metadata-store', () => ({
  default: {
    getState: () => ({
      metadata: {},
      reset: vi.fn(),
    }),
  },
}));

const createLayout = (panelType: 'terminal' | 'codex', runtimeVersion?: 1 | 2): ILayoutData => ({
  root: {
    type: 'pane',
    id: 'pane-test',
    activeTabId: 'tab-agent',
    tabs: [{
      id: 'tab-agent',
      sessionName: 'pt-ws-test-pane-test-tab-agent',
      name: '',
      order: 0,
      panelType,
      ...(runtimeVersion ? { runtimeVersion } : {}),
      agentSessionId: 'agent-session',
      agentJsonlPath: '/home/test/.codex/sessions/agent-session.jsonl',
    }],
  },
  activePaneId: 'pane-test',
  updatedAt: new Date(0).toISOString(),
});

const createSplitLayout = (): ILayoutData => ({
  root: {
    type: 'split',
    orientation: 'horizontal',
    ratio: 0.5,
    children: [
      {
        type: 'pane',
        id: 'pane-left',
        activeTabId: 'tab-left',
        tabs: [{
          id: 'tab-left',
          sessionName: 'pt-ws-test-pane-left-tab-left',
          name: '',
          order: 0,
        }],
      },
      {
        type: 'pane',
        id: 'pane-right',
        activeTabId: 'tab-right-active',
        tabs: [
          {
            id: 'tab-right-server',
            sessionName: 'pt-ws-test-pane-right-tab-server',
            name: '',
            order: 0,
          },
          {
            id: 'tab-right-active',
            sessionName: 'pt-ws-test-pane-right-tab-active',
            name: '',
            order: 1,
          },
        ],
      },
    ],
  },
  activePaneId: 'pane-right',
  updatedAt: new Date(0).toISOString(),
});

describe('useLayoutStore panel type switching', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
    })));
    useTabStore.setState({
      tabs: {},
      tabOrders: {},
      statusWsConnected: false,
    });
    useLayoutStore.setState({
      layout: null,
      isLoading: false,
      error: null,
      workspaceId: 'ws-test',
      pendingFocusTabId: null,
    });
  });

  it('keeps agent metadata when switching a Codex tab to terminal mode', () => {
    useLayoutStore.setState({ layout: createLayout('codex') });
    useTabStore.getState().initTab('tab-agent', {
      workspaceId: 'ws-test',
      panelType: 'codex',
      sessionView: 'timeline',
    });

    useLayoutStore.getState().updateTabPanelType('pane-test', 'tab-agent', 'terminal');

    const pane = useLayoutStore.getState().layout?.root;
    expect(pane?.type).toBe('pane');
    if (pane?.type !== 'pane') return;
    expect(pane.tabs[0]).toMatchObject({
      panelType: 'terminal',
      agentSessionId: 'agent-session',
      agentJsonlPath: '/home/test/.codex/sessions/agent-session.jsonl',
    });
  });

  it('returns to the timeline when switching a tab with a stored agent session into Codex mode', () => {
    useLayoutStore.setState({ layout: createLayout('terminal') });
    useTabStore.getState().initTab('tab-agent', {
      workspaceId: 'ws-test',
      panelType: 'terminal',
      agentProcess: null,
      sessionView: 'timeline',
    });

    useLayoutStore.getState().updateTabPanelType('pane-test', 'tab-agent', 'codex');

    expect(useTabStore.getState().tabs['tab-agent']).toMatchObject({
      panelType: 'codex',
      sessionView: 'timeline',
    });
  });

  it('refuses to switch a runtime v2 tab to an agent panel and offers a new agent tab', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    toastError.mockClear();
    useLayoutStore.setState({ layout: createLayout('terminal', 2) });
    const createTab = vi.fn();
    useLayoutStore.setState({ createTabInPane: createTab });

    useLayoutStore.getState().updateTabPanelType('pane-test', 'tab-agent', 'codex');

    const pane = useLayoutStore.getState().layout?.root;
    if (pane?.type !== 'pane') throw new Error('pane fixture missing');
    expect(pane.tabs[0].panelType).toBe('terminal');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
    const options = toastError.mock.calls[0][1] as { action: { onClick: () => void } };
    options.action.onClick();
    expect(createTab).toHaveBeenCalledWith('pane-test', 'codex', undefined, true);
  });

  it('names Claude Code in the refusal toast when a runtime v2 tab switches to CLAUDE', () => {
    toastError.mockClear();
    useLayoutStore.setState({ layout: createLayout('terminal', 2) });
    const createTab = vi.fn();
    useLayoutStore.setState({ createTabInPane: createTab });

    useLayoutStore.getState().updateTabPanelType('pane-test', 'tab-agent', 'claude');

    const pane = useLayoutStore.getState().layout?.root;
    if (pane?.type !== 'pane') throw new Error('pane fixture missing');
    expect(pane.tabs[0].panelType).toBe('terminal');
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toContain('Claude Code');
    expect(toastError.mock.calls[0][0]).not.toContain('{agent}');
    const options = toastError.mock.calls[0][1] as { action: { label: string; onClick: () => void } };
    expect(options.action.label).toContain('Claude Code');
    options.action.onClick();
    expect(createTab).toHaveBeenCalledWith('pane-test', 'claude', undefined, true);
  });

  it('still switches a runtime v1 tab to an agent panel', () => {
    toastError.mockClear();
    useLayoutStore.setState({ layout: createLayout('terminal', 1) });

    useLayoutStore.getState().updateTabPanelType('pane-test', 'tab-agent', 'codex');

    const pane = useLayoutStore.getState().layout?.root;
    if (pane?.type !== 'pane') throw new Error('pane fixture missing');
    expect(pane.tabs[0].panelType).toBe('codex');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('preserves the surviving local pane and tab focus after closing another pane', async () => {
    const layout = createSplitLayout();
    const rightPane = layout.root.type === 'split' ? layout.root.children[1] : null;
    if (!rightPane || rightPane.type !== 'pane') throw new Error('right pane fixture missing');

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        root: {
          ...rightPane,
          activeTabId: 'tab-right-server',
        },
        activePaneId: 'pane-right',
        updatedAt: new Date(1).toISOString(),
      }),
    })));
    useLayoutStore.setState({ layout });

    await useLayoutStore.getState().closePane('pane-left');

    const result = useLayoutStore.getState().layout;
    expect(result?.activePaneId).toBe('pane-right');
    expect(result?.root.type).toBe('pane');
    if (result?.root.type !== 'pane') return;
    expect(result.root.activeTabId).toBe('tab-right-active');
  });
});

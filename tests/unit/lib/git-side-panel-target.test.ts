import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_PANEL_TYPE } from '@/lib/panel-type';
import {
  canAskAgentFromSidePanel,
  isAgentTurnEnd,
  resolveGitSidePanelTarget,
  sidePanelAskAgentType,
  type IGitSidePanelTarget,
} from '@/lib/git-side-panel-target';
import type { IPaneNode, ITab, TLayoutNode } from '@/types/terminal';

const makeTab = (overrides: Partial<ITab> & Pick<ITab, 'id' | 'sessionName'>): ITab => ({
  name: overrides.id,
  order: 0,
  ...overrides,
});

const makePane = (id: string, tabs: ITab[], activeTabId: string | null = tabs[0]?.id ?? null): IPaneNode => ({
  type: 'pane',
  id,
  tabs,
  activeTabId,
});

describe('resolveGitSidePanelTarget', () => {
  it('selects the focused codex tab as target', () => {
    const root: TLayoutNode = makePane('pane-1', [
      makeTab({ id: 'tab-1', sessionName: 'pt-ws-pane-1-tab-1', panelType: 'codex' }),
    ]);

    expect(
      resolveGitSidePanelTarget({ root, activePaneId: 'pane-1', previous: null }),
    ).toEqual({
      paneId: 'pane-1',
      tabId: 'tab-1',
      sessionName: 'pt-ws-pane-1-tab-1',
      panelType: 'codex',
    });
  });

  it('normalizes a legacy tab without panelType to terminal', () => {
    const root: TLayoutNode = makePane('pane-1', [
      makeTab({ id: 'tab-legacy', sessionName: 'pt-ws-pane-1-tab-legacy' }),
    ]);

    expect(
      resolveGitSidePanelTarget({ root, activePaneId: 'pane-1', previous: null }),
    ).toEqual({
      paneId: 'pane-1',
      tabId: 'tab-legacy',
      sessionName: 'pt-ws-pane-1-tab-legacy',
      panelType: 'terminal',
    });
  });

  it('keeps the previous target when focus moves to a web-browser tab', () => {
    const previous: IGitSidePanelTarget = {
      paneId: 'pane-1',
      tabId: 'tab-codex',
      sessionName: 'pt-ws-pane-1-tab-codex',
      panelType: 'codex',
    };
    const root: TLayoutNode = makePane(
      'pane-1',
      [
        makeTab({ id: 'tab-codex', sessionName: 'pt-ws-pane-1-tab-codex', panelType: 'codex' }),
        makeTab({ id: 'tab-web', sessionName: '', panelType: 'web-browser' }),
      ],
      'tab-web',
    );

    expect(
      resolveGitSidePanelTarget({ root, activePaneId: 'pane-1', previous }),
    ).toEqual(previous);
  });

  it('returns null when the previous target tab was closed and no valid active tab exists', () => {
    const previous: IGitSidePanelTarget = {
      paneId: 'pane-1',
      tabId: 'tab-closed',
      sessionName: 'pt-ws-pane-1-tab-closed',
      panelType: 'codex',
    };
    const root: TLayoutNode = makePane(
      'pane-1',
      [makeTab({ id: 'tab-web', sessionName: '', panelType: 'web-browser' })],
      'tab-web',
    );

    expect(
      resolveGitSidePanelTarget({ root, activePaneId: 'pane-1', previous }),
    ).toBeNull();
  });

  it('updates paneId and panelType when the previous target tab moved to another pane', () => {
    const previous: IGitSidePanelTarget = {
      paneId: 'pane-1',
      tabId: 'tab-moved',
      sessionName: 'pt-ws-pane-1-tab-moved',
      panelType: 'terminal',
    };
    const root: TLayoutNode = {
      type: 'split',
      orientation: 'horizontal',
      ratio: 50,
      children: [
        makePane('pane-1', [makeTab({ id: 'tab-web', sessionName: '', panelType: 'web-browser' })], 'tab-web'),
        makePane('pane-2', [makeTab({ id: 'tab-moved', sessionName: 'pt-ws-pane-1-tab-moved', panelType: 'claude' })], 'tab-moved'),
      ],
    };

    expect(
      resolveGitSidePanelTarget({ root, activePaneId: 'pane-1', previous }),
    ).toEqual({
      paneId: 'pane-2',
      tabId: 'tab-moved',
      sessionName: 'pt-ws-pane-1-tab-moved',
      panelType: 'claude',
    });
  });

  it('returns null when activePaneId is null and previous is null', () => {
    const root: TLayoutNode = makePane('pane-1', [
      makeTab({ id: 'tab-1', sessionName: 'pt-ws-pane-1-tab-1', panelType: 'codex' }),
    ]);

    expect(resolveGitSidePanelTarget({ root, activePaneId: null, previous: null })).toBeNull();
  });
});

describe('canAskAgentFromSidePanel & sidePanelAskAgentType', () => {
  it("allows asking only when the target is its pane's active tab and not diff or web-browser", () => {
    const target: IGitSidePanelTarget = {
      paneId: 'pane-1',
      tabId: 'tab-codex',
      sessionName: 'pt-ws-pane-1-tab-codex',
      panelType: 'codex',
    };
    const activeRoot: TLayoutNode = makePane(
      'pane-1',
      [
        makeTab({ id: 'tab-codex', sessionName: 'pt-ws-pane-1-tab-codex', panelType: 'codex' }),
        makeTab({ id: 'tab-web', sessionName: '', panelType: 'web-browser' }),
      ],
      'tab-codex',
    );
    expect(canAskAgentFromSidePanel({ root: activeRoot, target })).toBe(true);

    const switchedToWebRoot: TLayoutNode = makePane(
      'pane-1',
      [
        makeTab({ id: 'tab-codex', sessionName: 'pt-ws-pane-1-tab-codex', panelType: 'codex' }),
        makeTab({ id: 'tab-web', sessionName: '', panelType: 'web-browser' }),
      ],
      'tab-web',
    );
    expect(canAskAgentFromSidePanel({ root: switchedToWebRoot, target })).toBe(false);

    const diffTarget: IGitSidePanelTarget = { ...target, panelType: 'diff' };
    const diffRoot: TLayoutNode = makePane(
      'pane-1',
      [makeTab({ id: 'tab-codex', sessionName: 'pt-ws-pane-1-tab-codex', panelType: 'diff' })],
      'tab-codex',
    );
    expect(canAskAgentFromSidePanel({ root: diffRoot, target: diffTarget })).toBe(false);
    expect(canAskAgentFromSidePanel({ root: activeRoot, target: null })).toBe(false);
  });

  it('resolves the ask agent panel type from target', () => {
    const base: IGitSidePanelTarget = {
      paneId: 'pane-1',
      tabId: 'tab-1',
      sessionName: 'pt-1',
      panelType: 'codex',
    };
    expect(sidePanelAskAgentType({ ...base, panelType: 'codex' })).toBe('codex');
    expect(sidePanelAskAgentType({ ...base, panelType: 'claude' })).toBe('claude');
    expect(sidePanelAskAgentType({ ...base, panelType: 'terminal' })).toBe(DEFAULT_AGENT_PANEL_TYPE);
  });
});

describe('isAgentTurnEnd', () => {
  it('returns true only when transitioning from busy to ready-for-review or idle', () => {
    expect(isAgentTurnEnd('busy', 'ready-for-review')).toBe(true);
    expect(isAgentTurnEnd('busy', 'idle')).toBe(true);
    expect(isAgentTurnEnd('idle', 'busy')).toBe(false);
    expect(isAgentTurnEnd(undefined, 'idle')).toBe(false);
    expect(isAgentTurnEnd('needs-input', 'idle')).toBe(false);
    expect(isAgentTurnEnd('busy', 'busy')).toBe(false);
  });
});

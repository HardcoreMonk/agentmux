import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILayoutData, IPaneNode, ITab } from '@/types/terminal';

const mocks = vi.hoisted(() => ({
  readRuntimeStorageLayout: vi.fn(),
  mirrorLegacyStorageToRuntimeV2BestEffort: vi.fn(),
  supervisor: {
    ensureStarted: vi.fn(),
    restartTerminalTab: vi.fn(),
  },
}));

vi.mock('@/lib/tmux', () => ({
  createSession: vi.fn(),
  hasSession: vi.fn(async () => true),
  killSession: vi.fn(),
  resolveExistingDir: vi.fn(async (cwd?: string) => cwd ?? '/home/test'),
  sendKeys: vi.fn(),
  workspaceSessionName: (wsId: string, paneId: string, tabId: string) => `pt-${wsId}-${paneId}-${tabId}`,
}));
vi.mock('@/lib/runtime/supervisor', () => ({ getRuntimeSupervisor: () => mocks.supervisor }));
vi.mock('@/lib/runtime/storage-read-owner', () => ({
  readRuntimeStorageLayout: mocks.readRuntimeStorageLayout,
}));
vi.mock('@/lib/runtime/storage-mirror', () => ({
  mirrorLegacyStorageToRuntimeV2BestEffort: mocks.mirrorLegacyStorageToRuntimeV2BestEffort,
}));
vi.mock('@/lib/sync-server', () => ({ broadcastSync: vi.fn() }));
vi.mock('@/lib/workspace-store', () => ({ updateWorkspaceDirectories: vi.fn(async () => {}) }));

const wsId = 'ws-add-tab';
const paneId = 'pane-a';
let dataDir: string;

const terminalTab = (id: string, order: number, overrides: Partial<ITab> = {}): ITab => ({
  id,
  sessionName: `pt-${wsId}-${paneId}-${id}`,
  name: '',
  order,
  runtimeVersion: 1,
  ...overrides,
});

const paneLayout = (tabs: ITab[], activeTabId: string | null): ILayoutData => ({
  root: { type: 'pane', id: paneId, tabs, activeTabId },
  activePaneId: paneId,
  updatedAt: '2026-11-11T00:00:00.000Z',
});

const loadStore = async () => {
  const store = await import('@/lib/layout-store');
  expect(store.resolveLayoutFile(wsId).startsWith(dataDir)).toBe(true);
  return store;
};

const seedLayoutFile = async (filePath: string, layout: ILayoutData): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(layout));
};

const readLayoutJson = async (filePath: string): Promise<ILayoutData> =>
  JSON.parse(await fs.readFile(filePath, 'utf-8')) as ILayoutData;

describe('layout store tab add options', () => {
  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmux-layout-add-tab-'));
    vi.stubEnv('AGENTMUX_DATA_DIR', dataDir);
    vi.stubEnv('AGENTMUX_RUNTIME_V2', undefined);
    vi.resetModules();
    mocks.readRuntimeStorageLayout.mockReset().mockReturnValue(null);
    mocks.mirrorLegacyStorageToRuntimeV2BestEffort.mockReset().mockResolvedValue(null);
    mocks.supervisor.ensureStarted.mockReset();
    mocks.supervisor.restartTerminalTab.mockReset();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('adds a delegated tab without changing the active tab and records its creator', async () => {
    const store = await loadStore();
    const filePath = store.resolveLayoutFile(wsId);
    await seedLayoutFile(filePath, paneLayout([terminalTab('tab-a', 0)], 'tab-a'));

    const tab = await store.addTabToPane(wsId, paneId, 'worker', '/project', 'terminal', undefined, {
      activate: false,
      createdByTabId: 'tab-a',
    });

    const layout = await readLayoutJson(filePath);
    const pane = layout.root as IPaneNode;
    expect(tab?.createdByTabId).toBe('tab-a');
    expect(pane.activeTabId).toBe('tab-a');
    expect(layout.activePaneId).toBe(paneId);
    expect(pane.tabs.find((t) => t.id === tab?.id)?.createdByTabId).toBe('tab-a');
  });

  it('makes the new tab active when no options are given', async () => {
    const store = await loadStore();
    const filePath = store.resolveLayoutFile(wsId);
    await seedLayoutFile(filePath, paneLayout([terminalTab('tab-a', 0)], 'tab-a'));

    const tab = await store.addTabToPane(wsId, paneId, 'worker', '/project', 'terminal');

    const pane = (await readLayoutJson(filePath)).root as IPaneNode;
    expect(pane.activeTabId).toBe(tab?.id);
    expect(pane.tabs.find((t) => t.id === tab?.id)).not.toHaveProperty('createdByTabId');
  });

  it('restores the previous active tab when runtime storage already holds the new v2 tab', async () => {
    const store = await loadStore();
    const filePath = store.resolveLayoutFile(wsId);
    const runtimeTab = terminalTab('tab-v2', 1, {
      sessionName: `rtv2-${wsId}-${paneId}-tab-v2`,
      cwd: '/project',
      panelType: 'terminal',
      runtimeVersion: 2,
    });
    mocks.readRuntimeStorageLayout.mockReturnValue(paneLayout([terminalTab('old', 0), runtimeTab], 'tab-v2'));

    const added = await store.addExistingTabToPane(wsId, paneId, { ...runtimeTab, name: ' worker ' }, {
      activate: false,
      restoreActiveTabId: 'old',
      createdByTabId: 'tab-a',
    });

    const pane = (await readLayoutJson(filePath)).root as IPaneNode;
    expect(pane.activeTabId).toBe('old');
    expect(pane.tabs.filter((t) => t.id === 'tab-v2')).toEqual([
      expect.objectContaining({ name: 'worker', order: 1, createdByTabId: 'tab-a' }),
    ]);
    expect(added).toEqual(expect.objectContaining({ id: 'tab-v2', createdByTabId: 'tab-a' }));
  });

  it('makes a delegated tab active when it is added to a pane without an active tab', async () => {
    const store = await loadStore();
    const filePath = store.resolveLayoutFile(wsId);
    await seedLayoutFile(filePath, paneLayout([], null));

    const tab = await store.addTabToPane(wsId, paneId, 'worker', '/project', 'terminal', undefined, {
      activate: false,
      createdByTabId: 'tab-a',
    });

    const layout = await readLayoutJson(filePath);
    expect((layout.root as IPaneNode).activeTabId).toBe(tab?.id);
    expect(layout.activePaneId).toBe(paneId);
  });

  it('ignores a restore target that is not in the pane', async () => {
    const store = await loadStore();
    const filePath = store.resolveLayoutFile(wsId);
    await seedLayoutFile(filePath, paneLayout([terminalTab('tab-a', 0)], 'tab-a'));

    await store.addExistingTabToPane(wsId, paneId, terminalTab('tab-new', 0), {
      activate: false,
      restoreActiveTabId: 'tab-missing',
    });

    const pane = (await readLayoutJson(filePath)).root as IPaneNode;
    expect(pane.activeTabId).toBe('tab-a');
    expect(pane.tabs.map((t) => t.id)).toEqual(['tab-a', 'tab-new']);
  });

  it('keeps the creator of a v2 tab after the runtime recreates its storage row on restart', async () => {
    const store = await loadStore();
    const filePath = store.resolveLayoutFile(wsId);
    const tab = terminalTab('tab-v2', 1, {
      sessionName: `rtv2-${wsId}-${paneId}-tab-v2`,
      cwd: '/project',
      panelType: 'terminal',
      runtimeVersion: 2,
      createdByTabId: 'tab-a',
    });
    const initial = paneLayout([terminalTab('tab-a', 0), tab], 'tab-a');
    await seedLayoutFile(filePath, initial);
    let runtimeLayout = structuredClone(initial);
    mocks.readRuntimeStorageLayout.mockImplementation(() => structuredClone(runtimeLayout));
    mocks.mirrorLegacyStorageToRuntimeV2BestEffort.mockImplementation(async () => {
      runtimeLayout = await readLayoutJson(filePath);
      return null;
    });
    mocks.supervisor.restartTerminalTab.mockImplementation(async () => {
      const pane = runtimeLayout.root as IPaneNode;
      const others = pane.tabs.filter((t) => t.id !== 'tab-v2');
      const { createdByTabId: _dropped, ...recreated } = pane.tabs.find((t) => t.id === 'tab-v2')!;
      pane.tabs = [...others, { ...recreated, name: '', order: Math.max(...others.map((t) => t.order)) + 1 }];
      pane.activeTabId = 'tab-v2';
    });
    await store.patchPane(wsId, paneId, { activeTabId: 'tab-v2' });
    const mirrorCallsBeforeRestart = mocks.mirrorLegacyStorageToRuntimeV2BestEffort.mock.calls.length;

    await expect(store.restartTabSession(wsId, paneId, 'tab-v2')).resolves.toBe(true);

    expect(mocks.supervisor.restartTerminalTab).toHaveBeenCalledWith(expect.objectContaining({ tabId: 'tab-v2' }));
    expect(mocks.mirrorLegacyStorageToRuntimeV2BestEffort.mock.calls.length).toBeGreaterThan(mirrorCallsBeforeRestart);
    const layout = await store.readLayoutFile(filePath);
    const restarted = (layout?.root as IPaneNode).tabs.find((t) => t.id === 'tab-v2');
    expect(restarted?.createdByTabId).toBe('tab-a');
  });
});

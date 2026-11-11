import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importLegacyStorageSnapshot } from '@/lib/runtime/storage-import';
import { createStorageRepository } from '@/lib/runtime/storage/repository';
import { openRuntimeDatabase } from '@/lib/runtime/storage/schema';
import type { TRuntimeDatabase } from '@/lib/runtime/storage/schema';
import type { ILayoutData, IWorkspacesData } from '@/types/terminal';

describe('runtime v2 storage import', () => {
  let dir: string;
  const dbs: TRuntimeDatabase[] = [];

  const openTestDatabase = (...args: Parameters<typeof openRuntimeDatabase>): TRuntimeDatabase => {
    const db = openRuntimeDatabase(...args);
    dbs.push(db);
    return db;
  };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-storage-import-'));
  });

  afterEach(async () => {
    for (const db of dbs.splice(0)) {
      try {
        db.close();
      } catch {}
    }
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('imports grouped workspaces, split panes, legacy tabs, non-terminal tabs, and status metadata idempotently', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const workspacesData: IWorkspacesData = {
      groups: [{ id: 'group-a', name: 'Secret Group', collapsed: true }],
      activeWorkspaceId: 'ws-a',
      sidebarCollapsed: true,
      sidebarWidth: 320,
      updatedAt: '2026-05-04T00:00:00.000Z',
      workspaces: [
        {
          id: 'ws-a',
          name: 'Secret Workspace',
          directories: ['/secret/project-a'],
          groupId: 'group-a',
        },
      ],
    };
    const layout: ILayoutData = {
      root: {
        type: 'split',
        orientation: 'horizontal',
        ratio: 55,
        children: [
          {
            type: 'pane',
            id: 'pane-a',
            activeTabId: 'tab-v1',
            tabs: [
              {
                id: 'tab-v1',
                sessionName: 'pt-ws-a-pane-a-tab-v1',
                name: 'Legacy terminal',
                order: 7,
                title: 'Secret title',
                cwd: '/secret/project-a',
                panelType: 'terminal',
                runtimeVersion: 1,
                cliState: 'needs-input',
                agentSessionId: 'agent-secret',
                agentJsonlPath: '/secret/codex/session.jsonl',
                agentSummary: 'secret summary',
                lastUserMessage: 'secret prompt',
                lastCommand: 'codex',
                dismissedAt: 123,
              },
              {
                id: 'tab-v2',
                sessionName: 'rtv2-ws-a-pane-a-tab-v2',
                name: 'Runtime terminal',
                order: 8,
                cwd: '/secret/project-a',
                panelType: 'terminal',
                runtimeVersion: 2,
              },
            ],
          },
          {
            type: 'pane',
            id: 'pane-b',
            activeTabId: 'tab-web',
            tabs: [
              {
                id: 'tab-web',
                sessionName: 'web-ws-a-pane-b-tab-web',
                name: 'Docs',
                order: 0,
                panelType: 'web-browser',
                webUrl: 'https://example.test/docs',
              },
            ],
          },
        ],
      },
      activePaneId: 'pane-b',
      updatedAt: '2026-05-04T00:00:00.000Z',
    };

    const first = importLegacyStorageSnapshot(db, {
      workspacesData,
      layoutsByWorkspaceId: { 'ws-a': layout },
      importedAt: '2026-05-04T00:00:00.000Z',
    });
    const second = importLegacyStorageSnapshot(db, {
      workspacesData,
      layoutsByWorkspaceId: { 'ws-a': layout },
      importedAt: '2026-05-04T00:01:00.000Z',
    });
    const repo = createStorageRepository(db);
    const importedLayout = repo.getWorkspaceLayout('ws-a');

    expect(first).toMatchObject({
      importedWorkspaceCount: 1,
      importedGroupCount: 1,
      importedPaneCount: 2,
      importedSplitPaneCount: 1,
      importedTabCount: 3,
      importedRuntimeV1TabCount: 1,
      importedRuntimeV2TabCount: 1,
      importedNonTerminalTabCount: 1,
      importedStatusMetadataCount: 1,
    });
    expect(second).toEqual(first);
    expect(repo.listWorkspaces()).toEqual([
      expect.objectContaining({
        id: 'ws-a',
        groupId: 'group-a',
        active: 1,
        defaultCwd: '/secret/project-a',
      }),
    ]);
    expect(importedLayout?.activePaneId).toBe('pane-b');
    expect(importedLayout?.root).toEqual({
      type: 'split',
      orientation: 'horizontal',
      ratio: 55,
      children: [
        {
          type: 'pane',
          id: 'pane-a',
          activeTabId: 'tab-v1',
          tabs: [
            expect.objectContaining({
              id: 'tab-v1',
              sessionName: 'pt-ws-a-pane-a-tab-v1',
              runtimeVersion: 1,
              panelType: 'terminal',
              cliState: 'needs-input',
              agentSessionId: 'agent-secret',
              agentJsonlPath: '/secret/codex/session.jsonl',
              agentSummary: 'secret summary',
              lastUserMessage: 'secret prompt',
              lastCommand: 'codex',
              dismissedAt: 123,
            }),
            expect.objectContaining({
              id: 'tab-v2',
              sessionName: 'rtv2-ws-a-pane-a-tab-v2',
              runtimeVersion: 2,
              panelType: 'terminal',
            }),
          ],
        },
        {
          type: 'pane',
          id: 'pane-b',
          activeTabId: 'tab-web',
          tabs: [
            expect.objectContaining({
              id: 'tab-web',
              panelType: 'web-browser',
              webUrl: 'https://example.test/docs',
              runtimeVersion: 1,
            }),
          ],
        },
      ],
    });
    expect(repo.listReadyTerminalTabs()).toEqual([
      expect.objectContaining({ id: 'tab-v2', sessionName: 'rtv2-ws-a-pane-a-tab-v2', runtimeVersion: 2 }),
    ]);
    expect(repo.getReadyTerminalTabBySession('pt-ws-a-pane-a-tab-v1')).toBeNull();
    expect(repo.deleteWorkspace({ workspaceId: 'ws-a' })).toEqual({
      deleted: true,
      sessions: [{ sessionName: 'rtv2-ws-a-pane-a-tab-v2' }],
    });
  });

  it('stores the agent panel type as the agent session provider', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const workspacesData: IWorkspacesData = {
      groups: [],
      activeWorkspaceId: 'ws-a',
      sidebarCollapsed: false,
      sidebarWidth: 280,
      updatedAt: '2026-05-04T00:00:00.000Z',
      workspaces: [{ id: 'ws-a', name: 'Workspace A', directories: ['/project/a'] }],
    };
    const layout: ILayoutData = {
      root: {
        type: 'pane',
        id: 'pane-a',
        activeTabId: 'tab-claude',
        tabs: [
          { id: 'tab-claude', sessionName: 'pt-ws-a-pane-a-tab-claude', name: '', order: 0, panelType: 'claude', agentSessionId: 'claude-session-1' },
          { id: 'tab-codex', sessionName: 'pt-ws-a-pane-a-tab-codex', name: '', order: 1, panelType: 'codex', agentSessionId: 'codex-session-1' },
          { id: 'tab-legacy', sessionName: 'pt-ws-a-pane-a-tab-legacy', name: '', order: 2, agentSessionId: 'legacy-session-1' },
        ],
      },
      activePaneId: 'pane-a',
      updatedAt: '2026-05-04T00:00:00.000Z',
    };

    importLegacyStorageSnapshot(db, {
      workspacesData,
      layoutsByWorkspaceId: { 'ws-a': layout },
      importedAt: '2026-05-04T00:00:00.000Z',
    });

    const rows = db.prepare('select id, provider from agent_sessions order by id').all();
    expect(rows).toEqual([
      { id: 'claude-session-1', provider: 'claude' },
      { id: 'codex-session-1', provider: 'codex' },
      { id: 'legacy-session-1', provider: 'codex' },
    ]);
  });

  it('stores the creator tab id and updates it when a later import changes it', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const workspacesData: IWorkspacesData = {
      groups: [],
      activeWorkspaceId: 'ws-a',
      sidebarCollapsed: false,
      sidebarWidth: 280,
      updatedAt: '2026-05-04T00:00:00.000Z',
      workspaces: [{ id: 'ws-a', name: 'Workspace A', directories: ['/project/a'] }],
    };
    const layoutWithCreator = (createdByTabId: string): ILayoutData => ({
      root: {
        type: 'pane',
        id: 'pane-a',
        activeTabId: 'tab-creator',
        tabs: [
          { id: 'tab-creator', sessionName: 'pt-ws-a-pane-a-tab-creator', name: '', order: 0 },
          { id: 'tab-created', sessionName: 'pt-ws-a-pane-a-tab-created', name: '', order: 1, createdByTabId },
        ],
      },
      activePaneId: 'pane-a',
      updatedAt: '2026-05-04T00:00:00.000Z',
    });
    const readCreators = () => db.prepare('select id, created_by_tab_id as createdByTabId from tabs order by id').all();

    importLegacyStorageSnapshot(db, {
      workspacesData,
      layoutsByWorkspaceId: { 'ws-a': layoutWithCreator('tab-creator') },
      importedAt: '2026-05-04T00:00:00.000Z',
    });
    expect(readCreators()).toEqual([
      { id: 'tab-created', createdByTabId: 'tab-creator' },
      { id: 'tab-creator', createdByTabId: null },
    ]);

    importLegacyStorageSnapshot(db, {
      workspacesData,
      layoutsByWorkspaceId: { 'ws-a': layoutWithCreator('tab-other') },
      importedAt: '2026-05-04T00:01:00.000Z',
    });
    expect(readCreators()).toEqual([
      { id: 'tab-created', createdByTabId: 'tab-other' },
      { id: 'tab-creator', createdByTabId: null },
    ]);
  });

  it('imports workspace sidebar state and all workspace directories for default read hydration', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const workspacesData: IWorkspacesData = {
      groups: [{ id: 'group-a', name: 'Group A', collapsed: false }],
      activeWorkspaceId: 'ws-a',
      sidebarCollapsed: true,
      sidebarWidth: 312,
      updatedAt: '2026-05-04T00:00:00.000Z',
      workspaces: [
        {
          id: 'ws-a',
          name: 'Workspace A',
          directories: ['/project/a', '/project/a/sub'],
          groupId: 'group-a',
        },
      ],
    };
    const layout: ILayoutData = {
      root: {
        type: 'pane',
        id: 'pane-a',
        activeTabId: 'tab-a',
        tabs: [{ id: 'tab-a', sessionName: 'pt-ws-a-pane-a-tab-a', name: '', order: 0, runtimeVersion: 1 }],
      },
      activePaneId: 'pane-a',
      updatedAt: '2026-05-04T00:00:00.000Z',
    };

    importLegacyStorageSnapshot(db, {
      workspacesData,
      layoutsByWorkspaceId: { 'ws-a': layout },
      messageHistoryByWorkspaceId: {
        'ws-a': [
          { id: 'hist-a', message: 'secret history', sentAt: '2026-05-04T00:00:00.000Z' },
        ],
      },
      importedAt: '2026-05-04T00:00:00.000Z',
    });

    const snapshot = createStorageRepository(db).getWorkspaceSnapshot();
    const messageHistory = createStorageRepository(db).listMessageHistory('ws-a');

    expect(snapshot).toEqual({
      workspaces: [
        {
          id: 'ws-a',
          name: 'Workspace A',
          directories: ['/project/a', '/project/a/sub'],
          groupId: 'group-a',
        },
      ],
      groups: [{ id: 'group-a', name: 'Group A', collapsed: false }],
      activeWorkspaceId: 'ws-a',
      sidebarCollapsed: true,
      sidebarWidth: 312,
      updatedAt: '2026-05-04T00:00:00.000Z',
    });
    expect(messageHistory).toEqual([
      { id: 'hist-a', message: 'secret history', sentAt: '2026-05-04T00:00:00.000Z' },
    ]);
  });

  it('prunes sqlite rows that are absent from the legacy snapshot when requested', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const workspacesData: IWorkspacesData = {
      groups: [],
      activeWorkspaceId: 'ws-keep',
      sidebarCollapsed: false,
      sidebarWidth: 240,
      updatedAt: '2026-05-04T00:00:00.000Z',
      workspaces: [
        { id: 'ws-keep', name: 'Keep', directories: [dir] },
        { id: 'ws-drop', name: 'Drop', directories: [dir] },
      ],
    };
    const keepLayout: ILayoutData = {
      root: {
        type: 'pane',
        id: 'pane-keep',
        activeTabId: 'tab-keep',
        tabs: [
          { id: 'tab-keep', sessionName: 'pt-ws-keep-pane-keep-tab-keep', name: '', order: 0, runtimeVersion: 1 },
          { id: 'tab-drop', sessionName: 'pt-ws-keep-pane-keep-tab-drop', name: '', order: 1, runtimeVersion: 1 },
        ],
      },
      activePaneId: 'pane-keep',
      updatedAt: '2026-05-04T00:00:00.000Z',
    };
    const dropLayout: ILayoutData = {
      root: {
        type: 'pane',
        id: 'pane-drop',
        activeTabId: 'tab-other',
        tabs: [{ id: 'tab-other', sessionName: 'pt-ws-drop-pane-drop-tab-other', name: '', order: 0, runtimeVersion: 1 }],
      },
      activePaneId: 'pane-drop',
      updatedAt: '2026-05-04T00:00:00.000Z',
    };

    importLegacyStorageSnapshot(db, {
      workspacesData,
      layoutsByWorkspaceId: { 'ws-keep': keepLayout, 'ws-drop': dropLayout },
      importedAt: '2026-05-04T00:00:00.000Z',
    });

    const pruned = importLegacyStorageSnapshot(db, {
      workspacesData: {
        ...workspacesData,
        workspaces: [{ id: 'ws-keep', name: 'Keep', directories: [dir] }],
      },
      layoutsByWorkspaceId: {
        'ws-keep': {
          ...keepLayout,
          root: {
            type: 'pane',
            id: 'pane-keep',
            activeTabId: 'tab-keep',
            tabs: [{ id: 'tab-keep', sessionName: 'pt-ws-keep-pane-keep-tab-keep', name: '', order: 0, runtimeVersion: 1 }],
          },
        },
      },
      importedAt: '2026-05-04T00:01:00.000Z',
      pruneMissing: true,
    });
    const repo = createStorageRepository(db);
    const layout = repo.getWorkspaceLayout('ws-keep');

    expect(pruned).toMatchObject({
      prunedWorkspaceCount: 1,
      prunedTabCount: 1,
    });
    expect(repo.getWorkspaceLayout('ws-drop')).toBeNull();
    expect(layout?.root.type).toBe('pane');
    if (layout?.root.type === 'pane') {
      expect(layout.root.tabs.map((tab) => tab.id)).toEqual(['tab-keep']);
    }
  });
});

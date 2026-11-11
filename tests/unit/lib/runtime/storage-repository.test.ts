import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openRuntimeDatabase } from '@/lib/runtime/storage/schema';
import type { TRuntimeDatabase } from '@/lib/runtime/storage/schema';
import { createStorageRepository } from '@/lib/runtime/storage/repository';

describe('runtime storage repository', () => {
  let dir: string;
  const dbs: TRuntimeDatabase[] = [];

  const openTestDatabase = (...args: Parameters<typeof openRuntimeDatabase>): TRuntimeDatabase => {
    const db = openRuntimeDatabase(...args);
    dbs.push(db);
    return db;
  };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-runtime-db-'));
  });

  afterEach(async () => {
    for (const db of dbs.splice(0)) {
      try {
        db.close();
      } catch {}
    }
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('creates pending terminal tab intents, assigns stable order, finalizes active tab, and projects only ready tabs', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);

    const workspace = repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });
    const firstPending = repo.createPendingTerminalTab({
      id: 'tab-runtime-a',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-runtime-a`,
      cwd: dir,
    });
    const secondPending = repo.createPendingTerminalTab({
      id: 'tab-runtime-b',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-runtime-b`,
      cwd: dir,
    });

    const pendingLayout = repo.getWorkspaceLayout(workspace.id);
    if (pendingLayout?.root.type === 'pane') {
      expect(pendingLayout.root.tabs).toEqual([]);
    }

    const firstTab = repo.finalizeTerminalTab({ id: firstPending.id });
    const secondTab = repo.finalizeTerminalTab({ id: secondPending.id });
    const layout = repo.getWorkspaceLayout(workspace.id);

    expect(firstTab.order).toBe(0);
    expect(firstTab.runtimeVersion).toBe(2);
    expect(secondTab.order).toBe(1);
    expect(secondTab.runtimeVersion).toBe(2);
    expect(secondTab.lifecycleState).toBe('ready');
    expect(layout?.activePaneId).toBe(workspace.rootPaneId);
    expect(layout?.root.type).toBe('pane');
    if (layout?.root.type === 'pane') {
      expect(layout.root.activeTabId).toBe(secondTab.id);
      expect(layout.root.tabs.map((tab) => ({ id: tab.id, order: tab.order }))).toEqual([
        { id: firstTab.id, order: 0 },
        { id: secondTab.id, order: 1 },
      ]);
      expect(layout.root.tabs.every((tab) => tab.runtimeVersion === 2)).toBe(true);
      expect(layout.root.tabs[0].sessionName).toMatch(/^rtv2-ws-/);
    }

    expect(() => repo.finalizeTerminalTab({ id: 'tab-missing' })).toThrow(expect.objectContaining({
      code: 'runtime-v2-pending-tab-not-found',
      retryable: false,
    }));
    expect(() => repo.finalizeTerminalTab({ id: secondTab.id })).toThrow(expect.objectContaining({
      code: 'runtime-v2-pending-tab-not-found',
      retryable: false,
    }));
  });

  it('projects the creator tab id only for tabs that have one', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);
    const workspace = repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });
    for (const id of ['tab-creator', 'tab-created']) {
      repo.createPendingTerminalTab({
        id,
        workspaceId: workspace.id,
        paneId: workspace.rootPaneId,
        sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-${id}`,
        cwd: dir,
      });
      repo.finalizeTerminalTab({ id });
    }
    db.prepare(`update tabs set created_by_tab_id = ? where id = ?`).run('tab-creator', 'tab-created');

    const layout = repo.getWorkspaceLayout(workspace.id);

    expect(layout?.root.type).toBe('pane');
    if (layout?.root.type === 'pane') {
      const [creator, created] = layout.root.tabs;
      expect(created.createdByTabId).toBe('tab-creator');
      expect(creator).not.toHaveProperty('createdByTabId');
    }
  });

  it('rejects terminal tabs for panes outside the supplied workspace', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);

    const workspace = repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });
    const otherWorkspace = repo.createWorkspace({ name: 'Other', defaultCwd: dir });

    expect(() => repo.createPendingTerminalTab({
      id: 'tab-runtime',
      workspaceId: workspace.id,
      paneId: otherWorkspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${otherWorkspace.rootPaneId}-tab-runtime`,
      cwd: dir,
    })).toThrow(expect.objectContaining({
      code: 'runtime-v2-pane-workspace-mismatch',
      retryable: false,
    }));

    expect(repo.listPendingTerminalTabs()).toEqual([]);
  });

  it('ensures legacy workspace and pane ids before creating v2 terminal tabs', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);

    expect(repo.ensureWorkspacePane({
      workspaceId: 'ws-legacy',
      paneId: 'pane-legacy',
      name: 'Legacy',
      defaultCwd: dir,
    })).toEqual({ workspaceId: 'ws-legacy', paneId: 'pane-legacy' });

    const pending = repo.createPendingTerminalTab({
      id: 'tab-runtime',
      workspaceId: 'ws-legacy',
      paneId: 'pane-legacy',
      sessionName: 'rtv2-ws-legacy-pane-legacy-tab-runtime',
      cwd: dir,
    });
    const tab = repo.finalizeTerminalTab({ id: pending.id });
    const layout = repo.getWorkspaceLayout('ws-legacy');

    expect(tab).toMatchObject({ id: 'tab-runtime', runtimeVersion: 2 });
    expect(layout?.root.type).toBe('pane');
    if (layout?.root.type === 'pane') {
      expect(layout.root.id).toBe('pane-legacy');
      expect(layout.root.tabs).toEqual([expect.objectContaining({ id: 'tab-runtime', runtimeVersion: 2 })]);
    }
  });

  it('records mutation events', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);

    repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });

    expect(repo.listMutationEvents()).toEqual([
      expect.objectContaining({ entityType: 'workspace', eventType: 'workspace.created' }),
    ]);
  });

  it('lists persisted workspaces for reload smoke', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);

    const workspace = repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });

    expect(repo.listWorkspaces()).toEqual([
      expect.objectContaining({ id: workspace.id, name: 'Runtime', defaultCwd: dir }),
    ]);
  });

  it('marks pending terminal tabs failed for reconciliation', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);

    const workspace = repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });
    const pending = repo.createPendingTerminalTab({
      id: 'tab-runtime',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-runtime`,
      cwd: dir,
    });

    expect(repo.listPendingTerminalTabs()).toEqual([
      expect.objectContaining({ id: pending.id, lifecycleState: 'pending_terminal' }),
    ]);

    repo.failPendingTerminalTab({ id: pending.id, reason: 'terminal create failed' });

    expect(repo.listPendingTerminalTabs()).toEqual([]);

    expect(() => repo.failPendingTerminalTab({ id: 'tab-missing', reason: 'missing' })).toThrow(expect.objectContaining({
      code: 'runtime-v2-pending-tab-not-found',
      retryable: false,
    }));

    const finalized = repo.createPendingTerminalTab({
      id: 'tab-finalized',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-finalized`,
      cwd: dir,
    });
    repo.finalizeTerminalTab({ id: finalized.id });
    expect(() => repo.failPendingTerminalTab({ id: finalized.id, reason: 'already finalized' })).toThrow(expect.objectContaining({
      code: 'runtime-v2-pending-tab-not-found',
      retryable: false,
    }));
  });

  it('deletes a workspace and returns cleanup sessions from the delete transaction', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);

    const workspace = repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });
    const readyPending = repo.createPendingTerminalTab({
      id: 'tab-ready',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-ready`,
      cwd: dir,
    });
    const stillPending = repo.createPendingTerminalTab({
      id: 'tab-pending',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-pending`,
      cwd: dir,
    });
    const failedPending = repo.createPendingTerminalTab({
      id: 'tab-failed',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-failed`,
      cwd: dir,
    });
    repo.finalizeTerminalTab({ id: readyPending.id });
    repo.failPendingTerminalTab({ id: failedPending.id, reason: 'already reconciled' });

    expect(repo.deleteWorkspace({ workspaceId: workspace.id })).toEqual({
      deleted: true,
      sessions: [
        { sessionName: readyPending.sessionName },
        { sessionName: stillPending.sessionName },
      ],
    });
    expect(repo.listWorkspaces()).toEqual([]);
    expect(repo.getWorkspaceLayout(workspace.id)).toBeNull();
    expect(repo.listMutationEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'workspace', entityId: workspace.id, eventType: 'workspace.deleted' }),
    ]));

    const eventCount = repo.listMutationEvents().length;
    db.pragma('foreign_keys = OFF');
    db.prepare(`
      insert into tabs (id, workspace_id, pane_id, session_name, panel_type, name, lifecycle_state, order_index, created_at, updated_at)
      values (?, ?, ?, ?, 'terminal', '', 'ready', 0, ?, ?)
    `).run(
      'tab-orphan',
      'ws-missing',
      'pane-missing',
      'rtv2-ws-missing-pane-missing-tab-orphan',
      new Date().toISOString(),
      new Date().toISOString(),
    );
    db.pragma('foreign_keys = ON');
    expect(repo.deleteWorkspace({ workspaceId: 'ws-missing' })).toEqual({ deleted: false, sessions: [] });
    expect(repo.listMutationEvents()).toHaveLength(eventCount);
  });

  it('deletes terminal tabs, returns cleanup sessions, reorders tabs, and updates active tab', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);
    const workspace = repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });
    const firstPending = repo.createPendingTerminalTab({
      id: 'tab-first',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-first`,
      cwd: dir,
    });
    const secondPending = repo.createPendingTerminalTab({
      id: 'tab-second',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-second`,
      cwd: dir,
    });
    const thirdPending = repo.createPendingTerminalTab({
      id: 'tab-third',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-third`,
      cwd: dir,
    });
    repo.finalizeTerminalTab({ id: firstPending.id });
    repo.finalizeTerminalTab({ id: secondPending.id });
    repo.finalizeTerminalTab({ id: thirdPending.id });

    expect(repo.deleteTerminalTab({ id: secondPending.id })).toEqual({
      deleted: true,
      session: { sessionName: secondPending.sessionName },
    });

    const layout = repo.getWorkspaceLayout(workspace.id);
    expect(layout?.root.type).toBe('pane');
    if (layout?.root.type === 'pane') {
      expect(layout.root.activeTabId).toBe(firstPending.id);
      expect(layout.root.tabs.map((tab) => ({ id: tab.id, order: tab.order }))).toEqual([
        { id: firstPending.id, order: 0 },
        { id: thirdPending.id, order: 1 },
      ]);
    }
    expect(repo.getReadyTerminalTabBySession(secondPending.sessionName)).toBeNull();
    expect(repo.listMutationEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'tab', entityId: secondPending.id, eventType: 'tab.deleted' }),
    ]));
  });

  it('deletes failed or missing terminal tabs without cleanup sessions', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);
    const workspace = repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });
    const failedPending = repo.createPendingTerminalTab({
      id: 'tab-failed',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-failed`,
      cwd: dir,
    });
    repo.failPendingTerminalTab({ id: failedPending.id, reason: 'terminal create failed' });

    expect(repo.deleteTerminalTab({ id: failedPending.id })).toEqual({
      deleted: true,
      session: null,
    });
    expect(repo.deleteTerminalTab({ id: 'tab-missing' })).toEqual({
      deleted: false,
      session: null,
    });
  });

  it('finds only finalized ready terminal tabs by session name', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);
    const workspace = repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });
    const pending = repo.createPendingTerminalTab({
      id: 'tab-runtime',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-runtime`,
      cwd: dir,
    });

    expect(repo.getReadyTerminalTabBySession(pending.sessionName)).toBeNull();
    repo.finalizeTerminalTab({ id: pending.id });
    expect(repo.getReadyTerminalTabBySession(pending.sessionName)).toEqual(
      expect.objectContaining({ id: pending.id, lifecycleState: 'ready', runtimeVersion: 2 }),
    );
    expect(repo.getReadyTerminalTabBySession('rtv2-ws-missing-pane-missing-tab-missing')).toBeNull();
  });

  it('lists ready terminal tabs and marks stale ready terminal tabs failed', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);
    const workspace = repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });
    const readyPending = repo.createPendingTerminalTab({
      id: 'tab-ready',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-ready`,
      cwd: dir,
    });
    const stillPending = repo.createPendingTerminalTab({
      id: 'tab-pending',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-pending`,
      cwd: dir,
    });
    const failedPending = repo.createPendingTerminalTab({
      id: 'tab-failed',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-failed`,
      cwd: dir,
    });
    const ready = repo.finalizeTerminalTab({ id: readyPending.id });
    repo.failPendingTerminalTab({ id: failedPending.id, reason: 'terminal create failed' });

    expect(repo.listReadyTerminalTabs()).toEqual([
      expect.objectContaining({ id: ready.id, lifecycleState: 'ready', runtimeVersion: 2 }),
    ]);

    repo.failReadyTerminalTab({
      id: ready.id,
      reason: 'startup reconciliation: tmux session missing',
    });

    expect(repo.listReadyTerminalTabs()).toEqual([]);
    const layout = repo.getWorkspaceLayout(workspace.id);
    if (layout?.root.type === 'pane') {
      expect(layout.root.tabs).toEqual([]);
    }
    expect(repo.listMutationEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityType: 'tab',
        entityId: ready.id,
        eventType: 'tab.ready-reconciliation-failed',
      }),
    ]));

    for (const id of [ready.id, stillPending.id, failedPending.id, 'tab-missing']) {
      expect(() => repo.failReadyTerminalTab({ id, reason: 'not ready' })).toThrow(expect.objectContaining({
        code: 'runtime-v2-ready-tab-not-found',
        retryable: false,
      }));
    }
  });

  it('reports a clear error when optional better-sqlite3 is unavailable', () => {
    expect(() => openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'), {
      loadDatabase: () => {
        throw new Error('Cannot find module better-sqlite3');
      },
    })).toThrow(expect.objectContaining({
      code: 'runtime-v2-sqlite-unavailable',
    }));
  });

  it('records schema migration v1 and reopens idempotently', () => {
    const dbPath = path.join(dir, 'runtime-v2', 'state.db');
    const db = openTestDatabase(dbPath);

    expect(db.prepare(`select version from schema_migrations order by version`).all()).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
    ]);
    db.close();

    const reopened = openTestDatabase(dbPath);
    expect(reopened.prepare(`select version, count(*) as count from schema_migrations group by version`).all()).toEqual([
      { version: 1, count: 1 },
      { version: 2, count: 1 },
      { version: 3, count: 1 },
      { version: 4, count: 1 },
      { version: 5, count: 1 },
      { version: 6, count: 1 },
    ]);
  });

  it('registers approved roots and managed projects with canonical path uniqueness and audit', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);
    const approvedAt = '2026-08-21T10:00:00.000Z';

    const root = repo.registerApprovedProjectRoot({
      id: 'root-1', label: 'Projects', canonicalPath: '/srv/projects', approvedAt,
    });
    const project = repo.registerManagedProject({
      approvedRootId: root.id,
      title: 'Demo',
      relativePath: 'demo',
      canonicalPath: '/srv/projects/demo',
      source: 'manual',
    });

    expect(root).toEqual({ id: 'root-1', label: 'Projects', approvedAt });
    expect(project).toMatchObject({
      id: expect.stringMatching(/^project-/), approvedRootId: 'root-1', title: 'Demo',
      relativePath: 'demo', source: 'manual',
    });
    expect(repo.listManagedProjects()).toEqual([project]);
    expect(repo.listManagedProjectSnapshots()).toEqual([
      expect.objectContaining({ ...project, canonicalPath: '/srv/projects/demo' }),
    ]);
    expect(repo.listGovernanceAuditEvents({ limit: 10 })).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'managed-project.register', targetProjectId: project.id, status: 'succeeded' }),
    ]));
    expect(() => repo.registerManagedProject({
      approvedRootId: root.id,
      title: 'Duplicate',
      relativePath: 'duplicate',
      canonicalPath: '/srv/projects/demo',
      source: 'manual',
    })).toThrow(expect.objectContaining({ code: 'managed-project-path-conflict' }));
  });

  it('applies selected import fields transactionally without deleting missing source projects', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const repo = createStorageRepository(db);
    repo.registerApprovedProjectRoot({
      id: 'root-1', label: 'Projects', canonicalPath: '/srv/projects', approvedAt: '2026-08-21T10:00:00.000Z',
    });
    const imported = repo.registerManagedProject({
      approvedRootId: 'root-1', title: 'Old title', relativePath: 'demo', canonicalPath: '/srv/projects/demo',
      source: 'projects-yaml', externalId: 'demo', sourceFingerprint: 'sha256:aaaaaa',
    });
    const missingFromSource = repo.registerManagedProject({
      approvedRootId: 'root-1', title: 'Keep me', relativePath: 'missing', canonicalPath: '/srv/projects/missing',
      source: 'projects-yaml', externalId: 'missing', sourceFingerprint: 'sha256:aaaaaa',
    });

    const result = repo.applyManagedProjectImport({
      approvedRootId: 'root-1',
      digest: `sha256:${'b'.repeat(64)}`,
      sourceFingerprint: `sha256:${'c'.repeat(64)}`,
      actions: [
        {
          status: 'add', externalId: 'new', title: 'New', relativePath: 'new',
          canonicalPath: '/srv/projects/new', selectedFields: ['title'],
        },
        {
          status: 'update', projectId: imported.id, externalId: 'demo', title: 'Renamed',
          relativePath: 'unexpected-path', canonicalPath: '/srv/projects/unexpected-path', selectedFields: ['title'],
        },
        {
          status: 'conflict', externalId: 'conflict', title: 'Conflict', relativePath: 'demo',
          canonicalPath: '/srv/projects/demo', selectedFields: [],
        },
      ],
    });

    expect(result.counts).toEqual({ add: 1, update: 1, conflict: 1, unchanged: 0 });
    expect(repo.listManagedProjects()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: imported.id, title: 'Renamed', relativePath: 'demo' }),
      expect.objectContaining({ id: missingFromSource.id, title: 'Keep me' }),
      expect.objectContaining({ title: 'New', externalId: 'new' }),
    ]));
    expect(db.prepare(`select count(*) as count from managed_project_imports`).get()).toEqual({ count: 1 });
    expect(repo.listGovernanceAuditEvents({ limit: 10 })).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'managed-project.import', status: 'succeeded', summary: result.counts }),
    ]));
  });

  it('applies runtime sqlite pragmas', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));

    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(String(db.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal');
    expect(Number(db.pragma('synchronous', { simple: true }))).toBe(1);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('rejects databases from a newer runtime schema version', () => {
    const dbPath = path.join(dir, 'runtime-v2', 'state.db');
    const db = openTestDatabase(dbPath);
    db.prepare(`insert into schema_migrations(version, applied_at) values(?, ?)`).run(99, new Date().toISOString());
    db.close();

    expect(() => openTestDatabase(dbPath)).toThrow(expect.objectContaining({
      code: 'runtime-v2-schema-too-new',
      retryable: false,
    }));
  });

  it('creates the full foundation schema', () => {
    const db = openTestDatabase(path.join(dir, 'runtime-v2', 'state.db'));
    const tables = db.prepare(`
      select name from sqlite_master where type = 'table' order by name asc
    `).all() as Array<{ name: string }>;
    const indexes = db.prepare(`
      select name from sqlite_master where type = 'index' and name not like 'sqlite_autoindex_%' order by name asc
    `).all() as Array<{ name: string }>;

    expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining([
      'schema_migrations',
      'workspaces',
      'workspace_groups',
      'panes',
      'tabs',
      'tab_status',
      'agent_sessions',
      'remote_sources',
      'mutation_events',
      'status_events',
    ]));
    expect(indexes.map((i) => i.name)).toEqual(expect.arrayContaining([
      'idx_runtime_agent_sessions_provider_source',
      'idx_runtime_mutation_events_created_at',
      'idx_runtime_panes_workspace_parent_position',
      'idx_runtime_remote_sources_label_host',
      'idx_runtime_tabs_lifecycle_state_created_at',
      'idx_runtime_status_events_tab_created_at',
      'idx_runtime_tabs_workspace_pane_order',
      'idx_runtime_workspaces_group_order',
    ]));

    const workspaceFks = db.prepare(`pragma foreign_key_list(workspaces)`).all() as Array<{ table: string; from: string }>;
    const paneFks = db.prepare(`pragma foreign_key_list(panes)`).all() as Array<{ table: string; from: string }>;
    const tabStatusFks = db.prepare(`pragma foreign_key_list(tab_status)`).all() as Array<{ table: string; from: string }>;
    const statusEventFks = db.prepare(`pragma foreign_key_list(status_events)`).all() as Array<{ table: string; from: string }>;

    expect(workspaceFks).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'workspace_groups', from: 'group_id' }),
    ]));
    expect(paneFks).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'workspaces', from: 'workspace_id' }),
      expect.objectContaining({ table: 'panes', from: 'parent_id' }),
      expect.objectContaining({ table: 'tabs', from: 'active_tab_id' }),
    ]));
    expect(tabStatusFks).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'tabs', from: 'tab_id' }),
      expect.objectContaining({ table: 'agent_sessions', from: 'agent_session_id' }),
    ]));
    expect(statusEventFks).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'tabs', from: 'tab_id' }),
      expect.objectContaining({ table: 'agent_sessions', from: 'agent_session_id' }),
    ]));
  });
});

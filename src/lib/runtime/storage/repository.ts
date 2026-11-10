import type {
  IRuntimeCreateWorkspaceResult,
  IRuntimeDeleteTerminalTabStorageResult,
  IRuntimeDeleteWorkspaceStorageResult,
  IRuntimeEnsureWorkspacePaneResult,
  IRuntimePendingTerminalTab,
  IRuntimeSelectSessionAnnotationsInput,
  IRuntimeApplyManagedProjectImportInput,
  IRuntimeManagedProjectImportResult,
  IRuntimeRegisterManagedProjectInput,
  TRuntimeRegisterApprovedProjectRootInput,
  IRuntimeTerminalTab,
  IRuntimeWorkspace,
  IRuntimeWorkspaceTerminalSession,
  TRuntimeLayout,
  TRuntimeSessionAnnotationSelection,
} from '@/lib/runtime/contracts';
import { createRuntimeId } from '@/lib/runtime/session-name';
import { normalizePanelType } from '@/lib/panel-type';
import type { TRuntimeDatabase } from '@/lib/runtime/storage/schema';
import type { IHistoryEntry } from '@/types/message-history';
import {
  SESSION_ANNOTATION_SELECTION_MAX_IDS,
  savedSessionFilterSchema,
  sessionTagSchema,
  type ISavedSessionFilter,
  type ISessionAnnotation,
} from '@/lib/session-catalog/contracts';
import {
  applyManagedProjectImportSchema,
  managedProjectSchema,
  managedProjectSnapshotSchema,
  registerApprovedProjectRootSchema,
  registerManagedProjectSchema,
  type IApprovedProjectRoot,
  type IApprovedProjectRootSnapshot,
  type IGovernanceAuditEvent,
  type IManagedProject,
  type IManagedProjectSnapshot,
} from '@/lib/governance/contracts';
import type {
  ILayoutData,
  IPaneNode,
  ISplitNode,
  ITab,
  IWorkspace,
  IWorkspaceGroup,
  IWorkspacesData,
  TLayoutNode,
  TRuntimeVersion,
} from '@/types/terminal';

export interface ICreateWorkspaceInput {
  name: string;
  defaultCwd: string;
}

export interface IEnsureWorkspacePaneInput {
  workspaceId: string;
  paneId: string;
  name: string;
  defaultCwd: string;
}

export interface ICreateTerminalTabInput {
  id: string;
  workspaceId: string;
  paneId: string;
  sessionName: string;
  cwd: string;
}

export interface IFinalizeTerminalTabInput {
  id: string;
}

export interface IFailPendingTerminalTabInput {
  id: string;
  reason: string;
}

export interface IFailReadyTerminalTabInput {
  id: string;
  reason: string;
}

export interface IDeleteWorkspaceInput {
  workspaceId: string;
}

export interface IDeleteTerminalTabInput {
  id: string;
}

export interface IMutationEventRow {
  id: string;
  entityType: string;
  entityId: string;
  eventType: string;
}

export interface IUpdateSessionAnnotationInput {
  sessionId: string;
  pinned: boolean;
  tags: string[];
  expectedVersion: number;
  sessionExists: boolean;
  updatedAt?: string;
}

interface ITabRow {
  id: string;
  sessionName: string;
  name: string;
  order: number;
  title: string | null;
  cwd: string | null;
  panelType: string;
  runtimeVersion: TRuntimeVersion;
  lifecycleState: string;
  webUrl: string | null;
  lastCommand: string | null;
  terminalRatio: number | null;
  terminalCollapsed: number;
  cliState: ITab['cliState'] | null;
  agentSessionId: string | null;
  agentJsonlPath: string | null;
  agentSummary: string | null;
  lastUserMessage: string | null;
  dismissedAt: number | null;
}

interface IPaneRow {
  id: string;
  parentId: string | null;
  nodeKind: 'pane' | 'split';
  splitAxis: 'horizontal' | 'vertical' | null;
  ratio: number | null;
  position: number;
  activeTabId: string | null;
}

interface IWorkspaceUiState {
  activeWorkspaceId?: string | null;
  sidebarCollapsed?: boolean;
  sidebarWidth?: number;
  updatedAt?: string;
}

const nowIso = (): string => new Date().toISOString();
const wsId = (): string => createRuntimeId('ws');
const paneId = (): string => createRuntimeId('pane');
const eventId = (): string => createRuntimeId('evt');

const annotationError = (code: string, message: string, retryable = false): Error =>
  Object.assign(new Error(message), { code, retryable });

const governanceStorageError = (code: string, message: string): Error =>
  Object.assign(new Error(message), { code, retryable: false });

interface IManagedProjectRow {
  id: string;
  approvedRootId: string;
  title: string;
  relativePath: string;
  canonicalPath: string;
  source: 'manual' | 'projects-yaml';
  externalId: string | null;
  sourceFingerprint: string | null;
  createdAt: string;
  updatedAt: string;
}

const toManagedProjectSnapshot = (row: IManagedProjectRow): IManagedProjectSnapshot =>
  managedProjectSnapshotSchema.parse({
    id: row.id,
    approvedRootId: row.approvedRootId,
    title: row.title,
    relativePath: row.relativePath,
    canonicalPath: row.canonicalPath,
    source: row.source,
    ...(row.externalId ? { externalId: row.externalId } : {}),
    ...(row.sourceFingerprint ? { sourceFingerprint: row.sourceFingerprint } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

const toManagedProject = (row: IManagedProjectRow): IManagedProject => {
  const { canonicalPath: _canonicalPath, ...project } = toManagedProjectSnapshot(row);
  return managedProjectSchema.parse(project);
};

const pendingTabNotFoundError = (id: string): Error =>
  Object.assign(new Error(`pending terminal tab not found: ${id}`), {
    code: 'runtime-v2-pending-tab-not-found',
    retryable: false,
  });

const readyTabNotFoundError = (id: string): Error =>
  Object.assign(new Error(`ready terminal tab not found: ${id}`), {
    code: 'runtime-v2-ready-tab-not-found',
    retryable: false,
  });

export const createStorageRepository = (db: TRuntimeDatabase) => {
  const appendMutationEvent = db.prepare(`
    insert into mutation_events (id, command_id, actor, entity_type, entity_id, event_type, payload_json, created_at)
    values (@id, @commandId, @actor, @entityType, @entityId, @eventType, @payloadJson, @createdAt)
  `);

  const recordEvent = (entityType: string, entityId: string, eventType: string, payload: unknown): void => {
    appendMutationEvent.run({
      id: eventId(),
      commandId: null,
      actor: 'runtime-v2',
      entityType,
      entityId,
      eventType,
      payloadJson: JSON.stringify(payload),
      createdAt: nowIso(),
    });
  };

  const appendGovernanceAudit = db.prepare(`
    insert into governance_audit_events
      (id, action, target_project_id, status, duration_ms, summary_json, created_at)
    values (@id, @action, @targetProjectId, @status, @durationMs, @summaryJson, @createdAt)
  `);

  const recordGovernanceAudit = (
    action: string,
    targetProjectId: string | null,
    summary: Record<string, string | number | boolean | null>,
    durationMs = 0,
  ): void => {
    appendGovernanceAudit.run({
      id: createRuntimeId('audit'),
      action,
      targetProjectId,
      status: 'succeeded',
      durationMs,
      summaryJson: JSON.stringify(summary),
      createdAt: nowIso(),
    });
  };

  const setAppState = (key: string, value: unknown, updatedAt = nowIso()): void => {
    db.prepare(`
      insert into app_state (key, value_json, updated_at)
      values (?, ?, ?)
      on conflict(key) do update set
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value), updatedAt);
  };

  const readAppState = <T>(key: string): T | null => {
    const row = db.prepare(`select value_json as valueJson from app_state where key = ?`)
      .get(key) as { valueJson: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.valueJson) as T;
    } catch {
      return null;
    }
  };

  const replaceWorkspaceDirectories = (workspaceId: string, directories: readonly string[], ts = nowIso()): void => {
    db.prepare(`delete from workspace_directories where workspace_id = ?`).run(workspaceId);
    const uniqueDirectories = [...new Set(directories.filter(Boolean))];
    uniqueDirectories.forEach((directory, index) => {
      db.prepare(`
        insert into workspace_directories (workspace_id, path, order_index, created_at, updated_at)
        values (?, ?, ?, ?, ?)
      `).run(workspaceId, directory, index, ts, ts);
    });
  };

  const listMessageHistory = (workspaceId: string): IHistoryEntry[] =>
    db.prepare(`
      select id, message, sent_at as sentAt
      from message_history
      where workspace_id = ?
      order by order_index asc, created_at asc, id asc
    `).all(workspaceId) as IHistoryEntry[];

  const replaceMessageHistoryTx = db.transaction((
    workspaceId: string,
    entries: readonly IHistoryEntry[],
    ts = nowIso(),
  ): void => {
    db.prepare(`delete from message_history where workspace_id = ?`).run(workspaceId);
    entries.forEach((entry, index) => {
      if (!entry.id || !entry.message || !entry.sentAt) return;
      db.prepare(`
        insert into message_history (workspace_id, id, message, sent_at, order_index, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?)
        on conflict(workspace_id, id) do update set
          message = excluded.message,
          sent_at = excluded.sent_at,
          order_index = excluded.order_index,
          updated_at = excluded.updated_at
      `).run(workspaceId, entry.id, entry.message, entry.sentAt, index, ts, ts);
    });
  });

  const createWorkspaceTx = db.transaction((input: ICreateWorkspaceInput): IRuntimeCreateWorkspaceResult => {
    const workspaceId = wsId();
    const rootPaneId = paneId();
    const ts = nowIso();

    db.prepare(`
      insert into workspaces (id, name, default_cwd, active, order_index, active_pane_id, created_at, updated_at)
      values (?, ?, ?, 1, 0, ?, ?, ?)
    `).run(workspaceId, input.name, input.defaultCwd, rootPaneId, ts, ts);
    replaceWorkspaceDirectories(workspaceId, [input.defaultCwd], ts);

    db.prepare(`
      insert into panes (id, workspace_id, node_kind, position, created_at, updated_at)
      values (?, ?, 'pane', 0, ?, ?)
    `).run(rootPaneId, workspaceId, ts, ts);

    recordEvent('workspace', workspaceId, 'workspace.created', input);
    return { id: workspaceId, rootPaneId };
  });

  const ensureWorkspacePaneTx = db.transaction((input: IEnsureWorkspacePaneInput): IRuntimeEnsureWorkspacePaneResult => {
    const ts = nowIso();
    const workspace = db.prepare(`select id from workspaces where id = ?`)
      .get(input.workspaceId) as { id: string } | undefined;
    if (!workspace) {
      const nextOrder = (db.prepare(`
        select coalesce(max(order_index), -1) + 1 as nextOrder
        from workspaces
      `).get() as { nextOrder: number }).nextOrder;
      db.prepare(`
        insert into workspaces (id, name, default_cwd, active, order_index, active_pane_id, created_at, updated_at)
        values (?, ?, ?, 0, ?, ?, ?, ?)
      `).run(input.workspaceId, input.name, input.defaultCwd, nextOrder, input.paneId, ts, ts);
      replaceWorkspaceDirectories(input.workspaceId, [input.defaultCwd], ts);
    }

    const pane = db.prepare(`
      select workspace_id as workspaceId
      from panes
      where id = ?
    `).get(input.paneId) as { workspaceId: string } | undefined;
    if (pane && pane.workspaceId !== input.workspaceId) {
      throw Object.assign(new Error(`runtime v2 pane does not belong to workspace: ${input.paneId}`), {
        code: 'runtime-v2-pane-workspace-mismatch',
        retryable: false,
      });
    }
    if (!pane) {
      db.prepare(`
        insert into panes (id, workspace_id, node_kind, position, created_at, updated_at)
        values (?, ?, 'pane', 0, ?, ?)
      `).run(input.paneId, input.workspaceId, ts, ts);
    }

    recordEvent('workspace', input.workspaceId, 'workspace.ensure-pane', input);
    return { workspaceId: input.workspaceId, paneId: input.paneId };
  });

  const createPendingTerminalTabTx = db.transaction((input: ICreateTerminalTabInput): IRuntimePendingTerminalTab => {
    const ts = nowIso();
    const pane = db.prepare(`
      select workspace_id as workspaceId
      from panes
      where id = ?
    `).get(input.paneId) as { workspaceId: string } | undefined;
    if (!pane) {
      throw Object.assign(new Error(`runtime v2 pane not found: ${input.paneId}`), {
        code: 'runtime-v2-pane-not-found',
        retryable: false,
      });
    }
    if (pane.workspaceId !== input.workspaceId) {
      throw Object.assign(new Error(`runtime v2 pane does not belong to workspace: ${input.paneId}`), {
        code: 'runtime-v2-pane-workspace-mismatch',
        retryable: false,
      });
    }
    const nextOrder = (db.prepare(`
      select coalesce(max(order_index), -1) + 1 as nextOrder
      from tabs
      where pane_id = ?
    `).get(input.paneId) as { nextOrder: number }).nextOrder;

    db.prepare(`
      insert into tabs (id, workspace_id, pane_id, session_name, panel_type, name, cwd, lifecycle_state, order_index, created_at, updated_at)
      values (?, ?, ?, ?, 'terminal', '', ?, 'pending_terminal', ?, ?, ?)
    `).run(input.id, input.workspaceId, input.paneId, input.sessionName, input.cwd, nextOrder, ts, ts);

    recordEvent('tab', input.id, 'tab.create-pending', input);
    return {
      id: input.id,
      sessionName: input.sessionName,
      workspaceId: input.workspaceId,
      paneId: input.paneId,
      cwd: input.cwd,
      runtimeVersion: 2,
      lifecycleState: 'pending_terminal',
      createdAt: ts,
    };
  });

  const finalizeTerminalTabTx = db.transaction((input: IFinalizeTerminalTabInput): IRuntimeTerminalTab => {
    const ts = nowIso();
    const row = db.prepare(`
      select id, workspace_id as workspaceId, pane_id as paneId, session_name as sessionName, cwd, order_index as "order"
      from tabs
      where id = ? and lifecycle_state = 'pending_terminal'
    `).get(input.id) as { id: string; workspaceId: string; paneId: string; sessionName: string; cwd: string | null; order: number } | undefined;
    if (!row) throw pendingTabNotFoundError(input.id);

    db.prepare(`update tabs set lifecycle_state = 'ready', updated_at = ? where id = ?`)
      .run(ts, input.id);

    db.prepare(`update panes set active_tab_id = ?, updated_at = ? where id = ?`)
      .run(input.id, ts, row.paneId);

    db.prepare(`insert into tab_status (tab_id, cli_state, updated_at) values (?, 'inactive', ?)`)
      .run(input.id, ts);

    recordEvent('tab', input.id, 'tab.created', row);
    return {
      id: input.id,
      sessionName: row.sessionName,
      name: '',
      order: row.order,
      ...(row.cwd ? { cwd: row.cwd } : {}),
      panelType: 'terminal',
      runtimeVersion: 2,
      lifecycleState: 'ready',
    };
  });

  const failPendingTerminalTabTx = db.transaction((input: IFailPendingTerminalTabInput): void => {
    const ts = nowIso();
    const result = db.prepare(`
      update tabs
      set lifecycle_state = 'failed', failure_reason = ?, updated_at = ?
      where id = ? and lifecycle_state = 'pending_terminal'
    `).run(input.reason, ts, input.id);
    if (result.changes !== 1) throw pendingTabNotFoundError(input.id);
    recordEvent('tab', input.id, 'tab.create-failed', input);
  });

  const failReadyTerminalTabTx = db.transaction((input: IFailReadyTerminalTabInput): void => {
    const ts = nowIso();
    const result = db.prepare(`
      update tabs
      set lifecycle_state = 'failed', failure_reason = ?, updated_at = ?
      where id = ? and lifecycle_state = 'ready'
    `).run(input.reason, ts, input.id);
    if (result.changes !== 1) throw readyTabNotFoundError(input.id);
    recordEvent('tab', input.id, 'tab.ready-reconciliation-failed', input);
  });

  const deleteWorkspaceTx = db.transaction((input: IDeleteWorkspaceInput): IRuntimeDeleteWorkspaceStorageResult => {
    const workspace = db.prepare(`select 1 as present from workspaces where id = ?`)
      .get(input.workspaceId) as { present: number } | undefined;
    if (!workspace) return { deleted: false, sessions: [] };

    const sessions = db.prepare(`
      select session_name as sessionName
      from tabs
      where workspace_id = ? and session_name is not null
        and runtime_version = 2
        and lifecycle_state in ('pending_terminal', 'ready')
      order by created_at asc, order_index asc, id asc
    `).all(input.workspaceId) as IRuntimeWorkspaceTerminalSession[];
    const result = db.prepare(`delete from workspaces where id = ?`).run(input.workspaceId);
    if (result.changes === 0) return { deleted: false, sessions: [] };
    recordEvent('workspace', input.workspaceId, 'workspace.deleted', input);
    return { deleted: true, sessions };
  });

  const deleteTerminalTabTx = db.transaction((input: IDeleteTerminalTabInput): IRuntimeDeleteTerminalTabStorageResult => {
    const ts = nowIso();
    const row = db.prepare(`
      select id, pane_id as paneId, session_name as sessionName, panel_type as panelType,
        runtime_version as runtimeVersion, lifecycle_state as lifecycleState
      from tabs
      where id = ?
    `).get(input.id) as {
      id: string;
      paneId: string;
      sessionName: string;
      panelType: string;
      runtimeVersion: TRuntimeVersion;
      lifecycleState: string;
    } | undefined;
    if (!row) return { deleted: false, session: null };

    db.prepare(`delete from tabs where id = ?`).run(input.id);

    const remaining = db.prepare(`
      select id
      from tabs
      where pane_id = ?
      order by order_index asc, created_at asc, id asc
    `).all(row.paneId) as Array<{ id: string }>;
    remaining.forEach((tab, index) => {
      db.prepare(`update tabs set order_index = ?, updated_at = ? where id = ?`)
        .run(index, ts, tab.id);
    });

    const active = db.prepare(`
      select id
      from tabs
      where pane_id = ? and lifecycle_state = 'ready'
      order by order_index asc, created_at asc, id asc
      limit 1
    `).get(row.paneId) as { id: string } | undefined;
    db.prepare(`update panes set active_tab_id = ?, updated_at = ? where id = ?`)
      .run(active?.id ?? null, ts, row.paneId);

    recordEvent('tab', input.id, 'tab.deleted', {
      id: input.id,
      sessionName: row.sessionName,
      lifecycleState: row.lifecycleState,
    });

    const shouldKill = row.panelType === 'terminal'
      && row.runtimeVersion === 2
      && ['pending_terminal', 'ready'].includes(row.lifecycleState);
    return {
      deleted: true,
      session: shouldKill ? { sessionName: row.sessionName } : null,
    };
  });

  return {
    createWorkspace: createWorkspaceTx,
    ensureWorkspacePane: ensureWorkspacePaneTx,
    createPendingTerminalTab: createPendingTerminalTabTx,
    finalizeTerminalTab: finalizeTerminalTabTx,
    failPendingTerminalTab: failPendingTerminalTabTx,
    failReadyTerminalTab: failReadyTerminalTabTx,
    deleteWorkspace: deleteWorkspaceTx,
    deleteTerminalTab: deleteTerminalTabTx,

    listPendingTerminalTabs(): IRuntimePendingTerminalTab[] {
      return db.prepare(`
        select id, session_name as sessionName, workspace_id as workspaceId, pane_id as paneId, cwd, lifecycle_state as lifecycleState, created_at as createdAt
        from tabs
        where lifecycle_state = 'pending_terminal'
        order by created_at asc, order_index asc, id asc
      `).all() as IRuntimePendingTerminalTab[];
    },

    listReadyTerminalTabs(): IRuntimeTerminalTab[] {
      const rows = db.prepare(`
        select id, session_name as sessionName, name, title, order_index as "order", cwd,
          panel_type as panelType, runtime_version as runtimeVersion, lifecycle_state as lifecycleState,
          web_url as webUrl, last_command as lastCommand, terminal_ratio as terminalRatio,
          terminal_collapsed as terminalCollapsed,
          null as cliState, null as agentSessionId, null as agentJsonlPath, null as agentSummary,
          null as lastUserMessage, null as dismissedAt
        from tabs
        where panel_type = 'terminal' and lifecycle_state = 'ready' and runtime_version = 2
        order by created_at asc, order_index asc, id asc
      `).all() as ITabRow[];
      return rows.map((row) => ({
        id: row.id,
        sessionName: row.sessionName,
        name: row.name,
        order: row.order,
        ...(row.cwd ? { cwd: row.cwd } : {}),
        panelType: 'terminal',
        runtimeVersion: 2,
        lifecycleState: 'ready',
      }));
    },

    getReadyTerminalTabBySession(sessionName: string): IRuntimeTerminalTab | null {
      const row = db.prepare(`
        select id, session_name as sessionName, name, title, order_index as "order", cwd,
          panel_type as panelType, runtime_version as runtimeVersion, lifecycle_state as lifecycleState,
          web_url as webUrl, last_command as lastCommand, terminal_ratio as terminalRatio,
          terminal_collapsed as terminalCollapsed,
          null as cliState, null as agentSessionId, null as agentJsonlPath, null as agentSummary,
          null as lastUserMessage, null as dismissedAt
        from tabs
        where session_name = ? and panel_type = 'terminal' and lifecycle_state = 'ready' and runtime_version = 2
      `).get(sessionName) as ITabRow | undefined;
      if (!row) return null;
      return {
        id: row.id,
        sessionName: row.sessionName,
        name: row.name,
        order: row.order,
        ...(row.cwd ? { cwd: row.cwd } : {}),
        panelType: 'terminal',
        runtimeVersion: 2,
        lifecycleState: 'ready',
      };
    },

    getWorkspaceLayout(workspaceId: string): TRuntimeLayout {
      const workspace = db.prepare(`
        select active_pane_id as activePaneId, updated_at as updatedAt
        from workspaces
        where id = ?
      `).get(workspaceId) as { activePaneId: string | null; updatedAt: string } | undefined;
      if (!workspace) return null;

      const panes = db.prepare(`
        select id, parent_id as parentId, node_kind as nodeKind, split_axis as splitAxis,
          ratio, position, active_tab_id as activeTabId
        from panes
        where workspace_id = ?
        order by parent_id asc, position asc, created_at asc, id asc
      `).all(workspaceId) as IPaneRow[];
      const rootPane = panes.find((pane) => pane.parentId === null);
      if (!rootPane) return null;

      const tabsByPaneId = new Map<string, ITab[]>();
      const tabRows = db.prepare(`
        select
          t.id,
          t.session_name as sessionName,
          t.name,
          t.title,
          t.order_index as "order",
          t.cwd,
          t.panel_type as panelType,
          t.runtime_version as runtimeVersion,
          t.lifecycle_state as lifecycleState,
          t.web_url as webUrl,
          t.last_command as lastCommand,
          t.terminal_ratio as terminalRatio,
          t.terminal_collapsed as terminalCollapsed,
          s.cli_state as cliState,
          s.agent_session_id as agentSessionId,
          s.agent_jsonl_ref as agentJsonlPath,
          s.agent_summary as agentSummary,
          s.last_user_message as lastUserMessage,
          s.dismissed_at as dismissedAt,
          t.pane_id as paneId
        from tabs t
        left join tab_status s on s.tab_id = t.id
        where t.workspace_id = ? and t.lifecycle_state = 'ready'
        order by t.pane_id asc, t.order_index asc, t.created_at asc, t.id asc
      `).all(workspaceId) as Array<ITabRow & { paneId: string }>;
      for (const row of tabRows) {
        const tab: ITab = {
          id: row.id,
          sessionName: row.sessionName,
          name: row.name,
          order: row.order,
          runtimeVersion: row.runtimeVersion,
          ...(row.title ? { title: row.title } : {}),
          ...(row.cwd ? { cwd: row.cwd } : {}),
          ...(normalizePanelType(row.panelType) ? { panelType: normalizePanelType(row.panelType) } : {}),
          ...(row.webUrl ? { webUrl: row.webUrl } : {}),
          ...(row.lastCommand ? { lastCommand: row.lastCommand } : {}),
          ...(row.terminalRatio !== null ? { terminalRatio: row.terminalRatio } : {}),
          ...(row.terminalCollapsed ? { terminalCollapsed: Boolean(row.terminalCollapsed) } : {}),
          ...(row.cliState ? { cliState: row.cliState } : {}),
          ...(row.agentSessionId ? { agentSessionId: row.agentSessionId } : {}),
          ...(row.agentJsonlPath ? { agentJsonlPath: row.agentJsonlPath } : {}),
          ...(row.agentSummary ? { agentSummary: row.agentSummary } : {}),
          ...(row.lastUserMessage ? { lastUserMessage: row.lastUserMessage } : {}),
          ...(row.dismissedAt !== null ? { dismissedAt: row.dismissedAt } : {}),
        };
        tabsByPaneId.set(row.paneId, [...(tabsByPaneId.get(row.paneId) ?? []), tab]);
      }

      const childrenByParentId = new Map<string, IPaneRow[]>();
      for (const pane of panes) {
        if (!pane.parentId) continue;
        childrenByParentId.set(pane.parentId, [...(childrenByParentId.get(pane.parentId) ?? []), pane]);
      }

      const buildNode = (row: IPaneRow): TLayoutNode => {
        if (row.nodeKind === 'pane') {
          return {
            type: 'pane',
            id: row.id,
            activeTabId: row.activeTabId,
            tabs: tabsByPaneId.get(row.id) ?? [],
          };
        }

        const children = (childrenByParentId.get(row.id) ?? []).sort((a, b) => a.position - b.position);
        const fallbackPane = (): IPaneNode => ({ type: 'pane', id: `${row.id}-missing`, activeTabId: null, tabs: [] });
        const left = children[0] ? buildNode(children[0]) : fallbackPane();
        const right = children[1] ? buildNode(children[1]) : fallbackPane();
        const split: ISplitNode = {
          type: 'split',
          orientation: row.splitAxis ?? 'horizontal',
          ratio: row.ratio ?? 50,
          children: [left, right],
        };
        return split;
      };

      const root = buildNode(rootPane);
      const layout: ILayoutData = {
        root,
        activePaneId: workspace.activePaneId,
        updatedAt: workspace.updatedAt,
      };
      return layout;
    },

    setWorkspaceUiState(input: IWorkspaceUiState): void {
      const previous = readAppState<IWorkspaceUiState>('workspace-ui') ?? {};
      setAppState('workspace-ui', { ...previous, ...input, updatedAt: input.updatedAt ?? nowIso() }, input.updatedAt ?? nowIso());
    },

    replaceWorkspaceDirectories,
    listMessageHistory,
    replaceMessageHistory: replaceMessageHistoryTx,

    getWorkspaceSnapshot(): IWorkspacesData {
      const groupRows = db.prepare(`
        select id, name, collapsed
        from workspace_groups
        order by order_index asc, created_at asc, id asc
      `).all() as Array<{ id: string; name: string; collapsed: number }>;
      const groups: IWorkspaceGroup[] = groupRows.map((group) => ({
        id: group.id,
        name: group.name,
        collapsed: Boolean(group.collapsed),
      }));

      const workspaceRows = db.prepare(`
        select id, name, default_cwd as defaultCwd, active, group_id as groupId, updated_at as updatedAt
        from workspaces
        order by order_index asc, created_at asc, id asc
      `).all() as Array<{
        id: string;
        name: string;
        defaultCwd: string;
        active: number;
        groupId: string | null;
        updatedAt: string;
      }>;
      const directoriesByWorkspaceId = new Map<string, string[]>();
      const directoryRows = db.prepare(`
        select workspace_id as workspaceId, path
        from workspace_directories
        order by workspace_id asc, order_index asc
      `).all() as Array<{ workspaceId: string; path: string }>;
      for (const row of directoryRows) {
        directoriesByWorkspaceId.set(row.workspaceId, [...(directoriesByWorkspaceId.get(row.workspaceId) ?? []), row.path]);
      }

      const workspaces: IWorkspace[] = workspaceRows.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        directories: directoriesByWorkspaceId.get(workspace.id) ?? [workspace.defaultCwd],
        ...(workspace.groupId ? { groupId: workspace.groupId } : {}),
      }));
      const validWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id));
      const uiState = readAppState<IWorkspaceUiState>('workspace-ui') ?? {};
      const activeWorkspaceId = uiState.activeWorkspaceId && validWorkspaceIds.has(uiState.activeWorkspaceId)
        ? uiState.activeWorkspaceId
        : workspaceRows.find((workspace) => workspace.active)?.id ?? workspaces[0]?.id;
      const updatedAt = uiState.updatedAt
        ?? workspaceRows.reduce<string | null>((latest, workspace) => (
          !latest || workspace.updatedAt > latest ? workspace.updatedAt : latest
        ), null)
        ?? nowIso();

      return {
        workspaces,
        groups,
        ...(activeWorkspaceId ? { activeWorkspaceId } : {}),
        sidebarCollapsed: Boolean(uiState.sidebarCollapsed),
        sidebarWidth: typeof uiState.sidebarWidth === 'number' ? uiState.sidebarWidth : 240,
        updatedAt,
      };
    },

    listMutationEvents(): IMutationEventRow[] {
      return db.prepare(`
        select id, entity_type as entityType, entity_id as entityId, event_type as eventType
        from mutation_events
        order by created_at asc, id asc
      `).all() as IMutationEventRow[];
    },

    listWorkspaces(): IRuntimeWorkspace[] {
      return db.prepare(`
        select id, name, default_cwd as defaultCwd, active, group_id as groupId, order_index as orderIndex, created_at as createdAt, updated_at as updatedAt
        from workspaces
        order by order_index asc, created_at asc, id asc
      `).all() as IRuntimeWorkspace[];
    },

    registerApprovedProjectRoot: db.transaction((input: TRuntimeRegisterApprovedProjectRootInput): IApprovedProjectRoot => {
      const parsed = registerApprovedProjectRootSchema.parse(input);
      try {
        db.prepare(`
          insert into approved_project_roots(id, label, canonical_path, approved_at)
          values (@id, @label, @canonicalPath, @approvedAt)
          on conflict(id) do update set
            label = excluded.label,
            canonical_path = excluded.canonical_path,
            approved_at = excluded.approved_at
        `).run(parsed);
      } catch (cause) {
        if ((cause as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw governanceStorageError('approved-project-root-path-conflict', 'Approved Project Root path is already registered.');
        }
        throw cause;
      }
      recordGovernanceAudit('approved-project-root.register', null, { rootId: parsed.id });
      return { id: parsed.id, label: parsed.label, approvedAt: parsed.approvedAt };
    }),

    listApprovedProjectRoots(): IApprovedProjectRoot[] {
      return db.prepare(`
        select id, label, approved_at as approvedAt
        from approved_project_roots order by approved_at asc, id asc
      `).all() as IApprovedProjectRoot[];
    },

    listApprovedProjectRootSnapshots(): IApprovedProjectRootSnapshot[] {
      return db.prepare(`
        select id, label, canonical_path as canonicalPath, approved_at as approvedAt
        from approved_project_roots order by approved_at asc, id asc
      `).all() as IApprovedProjectRootSnapshot[];
    },

    registerManagedProject: db.transaction((input: IRuntimeRegisterManagedProjectInput): IManagedProject => {
      const parsed = registerManagedProjectSchema.parse(input);
      const root = db.prepare(`select 1 as present from approved_project_roots where id = ?`)
        .get(parsed.approvedRootId) as { present: number } | undefined;
      if (!root) throw governanceStorageError('approved-project-root-not-found', 'Approved Project Root was not found.');
      const createdAt = nowIso();
      const id = createRuntimeId('project');
      try {
        db.prepare(`
          insert into managed_projects(
            id, approved_root_id, title, relative_path, canonical_path, source,
            external_id, source_fingerprint, created_at, updated_at
          ) values (
            @id, @approvedRootId, @title, @relativePath, @canonicalPath, @source,
            @externalId, @sourceFingerprint, @createdAt, @updatedAt
          )
        `).run({
          ...parsed,
          id,
          externalId: parsed.externalId ?? null,
          sourceFingerprint: parsed.sourceFingerprint ?? null,
          createdAt,
          updatedAt: createdAt,
        });
      } catch (cause) {
        if ((cause as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw governanceStorageError('managed-project-path-conflict', 'Managed Project path is already registered.');
        }
        throw cause;
      }
      recordGovernanceAudit('managed-project.register', id, { source: parsed.source });
      const row = db.prepare(`
        select id, approved_root_id as approvedRootId, title, relative_path as relativePath,
          canonical_path as canonicalPath, source, external_id as externalId,
          source_fingerprint as sourceFingerprint, created_at as createdAt, updated_at as updatedAt
        from managed_projects where id = ?
      `).get(id) as IManagedProjectRow;
      return toManagedProject(row);
    }),

    listManagedProjects(): IManagedProject[] {
      const rows = db.prepare(`
        select id, approved_root_id as approvedRootId, title, relative_path as relativePath,
          canonical_path as canonicalPath, source, external_id as externalId,
          source_fingerprint as sourceFingerprint, created_at as createdAt, updated_at as updatedAt
        from managed_projects order by created_at asc, id asc
      `).all() as IManagedProjectRow[];
      return rows.map(toManagedProject);
    },

    listManagedProjectSnapshots(): IManagedProjectSnapshot[] {
      const rows = db.prepare(`
        select id, approved_root_id as approvedRootId, title, relative_path as relativePath,
          canonical_path as canonicalPath, source, external_id as externalId,
          source_fingerprint as sourceFingerprint, created_at as createdAt, updated_at as updatedAt
        from managed_projects order by created_at asc, id asc
      `).all() as IManagedProjectRow[];
      return rows.map(toManagedProjectSnapshot);
    },

    applyManagedProjectImport: db.transaction((input: IRuntimeApplyManagedProjectImportInput): IRuntimeManagedProjectImportResult => {
      const parsed = applyManagedProjectImportSchema.parse(input);
      const root = db.prepare(`select 1 as present from approved_project_roots where id = ?`)
        .get(parsed.approvedRootId) as { present: number } | undefined;
      if (!root) throw governanceStorageError('approved-project-root-not-found', 'Approved Project Root was not found.');
      const counts = {
        add: parsed.actions.filter((action) => action.status === 'add').length,
        update: parsed.actions.filter((action) => action.status === 'update').length,
        conflict: parsed.actions.filter((action) => action.status === 'conflict').length,
        unchanged: parsed.actions.filter((action) => action.status === 'unchanged').length,
      };
      const timestamp = nowIso();
      for (const action of parsed.actions) {
        if (action.status === 'add') {
          db.prepare(`
            insert into managed_projects(
              id, approved_root_id, title, relative_path, canonical_path, source,
              external_id, source_fingerprint, created_at, updated_at
            ) values (?, ?, ?, ?, ?, 'projects-yaml', ?, ?, ?, ?)
          `).run(
            createRuntimeId('project'),
            parsed.approvedRootId,
            action.title,
            action.relativePath,
            action.canonicalPath,
            action.externalId,
            parsed.sourceFingerprint,
            timestamp,
            timestamp,
          );
          continue;
        }
        if (action.status === 'update') {
          if (!action.projectId) {
            throw governanceStorageError('managed-project-import-stale', 'Managed Project import target is missing.');
          }
          const current = db.prepare(`
            select id, approved_root_id as approvedRootId, external_id as externalId
            from managed_projects where id = ?
          `).get(action.projectId) as { id: string; approvedRootId: string; externalId: string | null } | undefined;
          if (!current || current.approvedRootId !== parsed.approvedRootId || current.externalId !== action.externalId) {
            throw governanceStorageError('managed-project-import-stale', 'Managed Project import preview is stale.');
          }
          const selected = new Set(action.selectedFields);
          db.prepare(`
            update managed_projects set
              title = case when @updateTitle = 1 then @title else title end,
              relative_path = case when @updatePath = 1 then @relativePath else relative_path end,
              canonical_path = case when @updatePath = 1 then @canonicalPath else canonical_path end,
              source_fingerprint = @sourceFingerprint,
              updated_at = @updatedAt
            where id = @id
          `).run({
            id: action.projectId,
            updateTitle: selected.has('title') ? 1 : 0,
            updatePath: selected.has('relativePath') ? 1 : 0,
            title: action.title,
            relativePath: action.relativePath,
            canonicalPath: action.canonicalPath,
            sourceFingerprint: parsed.sourceFingerprint,
            updatedAt: timestamp,
          });
        }
      }
      db.prepare(`
        insert into managed_project_imports(id, approved_root_id, digest, source_fingerprint, counts_json, imported_at)
        values (?, ?, ?, ?, ?, ?)
      `).run(
        createRuntimeId('import'),
        parsed.approvedRootId,
        parsed.digest,
        parsed.sourceFingerprint,
        JSON.stringify(counts),
        timestamp,
      );
      recordGovernanceAudit('managed-project.import', null, counts);
      return { counts };
    }),

    listGovernanceAuditEvents({
      projectId,
      limit,
    }: {
      projectId?: string;
      limit: number;
    }): IGovernanceAuditEvent[] {
      const rows = (projectId
        ? db.prepare(`
            select id, action, target_project_id as targetProjectId, status,
              duration_ms as durationMs, summary_json as summaryJson, created_at as createdAt
            from governance_audit_events where target_project_id = ?
            order by created_at desc, id desc limit ?
          `).all(projectId, limit)
        : db.prepare(`
            select id, action, target_project_id as targetProjectId, status,
              duration_ms as durationMs, summary_json as summaryJson, created_at as createdAt
            from governance_audit_events order by created_at desc, id desc limit ?
          `).all(limit)) as Array<Omit<IGovernanceAuditEvent, 'summary'> & { summaryJson: string }>;
      return rows.map(({ summaryJson, ...row }) => ({
        ...row,
        summary: JSON.parse(summaryJson) as IGovernanceAuditEvent['summary'],
      }));
    },

    hasWorkspace(workspaceId: string): boolean {
      const row = db.prepare(`select 1 as present from workspaces where id = ?`)
        .get(workspaceId) as { present: number } | undefined;
      return Boolean(row);
    },

    getSessionAnnotation(sessionId: string): ISessionAnnotation | null {
      const row = db.prepare(`
        select session_id as sessionId, pinned, tags_json as tagsJson, version, updated_at as updatedAt
        from session_annotations where session_id = ?
      `).get(sessionId) as {
        sessionId: string;
        pinned: number;
        tagsJson: string;
        version: number;
        updatedAt: string;
      } | undefined;
      if (!row) return null;
      try {
        const tags = JSON.parse(row.tagsJson) as unknown;
        if (!Array.isArray(tags) || !tags.every((tag) => sessionTagSchema.safeParse(tag).success)) throw new Error('invalid');
        return {
          sessionId: row.sessionId,
          pinned: Boolean(row.pinned),
          tags: tags as string[],
          version: row.version,
          updatedAt: row.updatedAt,
        };
      } catch {
        throw annotationError('session-annotation-corrupt', 'Stored session annotation is corrupt.');
      }
    },

    listSessionAnnotations(sessionIds: readonly string[]): ISessionAnnotation[] {
      return sessionIds
        .map((sessionId) => this.getSessionAnnotation(sessionId))
        .filter((annotation): annotation is ISessionAnnotation => annotation !== null);
    },

    selectSessionAnnotations(input: IRuntimeSelectSessionAnnotationsInput): TRuntimeSessionAnnotationSelection {
      const tags = [...new Set(input.tags ?? [])];
      const excludePinned = input.pinned === false && tags.length === 0;
      const conditions: string[] = [];
      const params: Record<string, unknown> = {
        limit: SESSION_ANNOTATION_SELECTION_MAX_IDS + 1,
      };
      if (excludePinned) {
        conditions.push('a.pinned = 1');
      } else if (input.pinned !== undefined) {
        conditions.push('a.pinned = @pinned');
        params.pinned = input.pinned ? 1 : 0;
      }
      if (tags.length > 0) {
        conditions.push(`not exists (
          select 1 from json_each(@tagsJson) requested
          where not exists (
            select 1 from json_each(a.tags_json) actual where actual.value = requested.value
          )
        )`);
        params.tagsJson = JSON.stringify(tags);
      }
      const rows = db.prepare(`
        select a.session_id as sessionId
        from session_annotations a
        ${conditions.length ? `where ${conditions.join(' and ')}` : ''}
        order by a.session_id asc
        limit @limit
      `).all(params) as Array<{ sessionId: string }>;
      if (rows.length > SESSION_ANNOTATION_SELECTION_MAX_IDS) {
        throw annotationError(
          'session-annotation-selection-too-large',
          'Session annotation selection exceeds the supported limit.',
          true,
        );
      }
      return {
        mode: excludePinned ? 'exclude' : 'include',
        sessionIds: rows.map((row) => row.sessionId),
      };
    },

    updateSessionAnnotation: db.transaction((input: IUpdateSessionAnnotationInput): ISessionAnnotation => {
      if (!input.sessionExists) {
        throw annotationError('session-annotation-session-not-found', 'Session annotation target was not found.');
      }
      const current = db.prepare(`select version from session_annotations where session_id = ?`)
        .get(input.sessionId) as { version: number } | undefined;
      const currentVersion = current?.version ?? 0;
      if (currentVersion !== input.expectedVersion) {
        throw annotationError('session-annotation-version-conflict', 'Session annotation version conflict.');
      }
      const tags = [...new Set(input.tags.map((tag) => sessionTagSchema.parse(tag.trim().toLocaleLowerCase('en-US'))))];
      const annotation: ISessionAnnotation = {
        sessionId: input.sessionId,
        pinned: input.pinned,
        tags,
        version: currentVersion + 1,
        updatedAt: input.updatedAt ?? nowIso(),
      };
      db.prepare(`
        insert into session_annotations(session_id, pinned, tags_json, version, updated_at)
        values (@sessionId, @pinned, @tagsJson, @version, @updatedAt)
        on conflict(session_id) do update set
          pinned = excluded.pinned,
          tags_json = excluded.tags_json,
          version = excluded.version,
          updated_at = excluded.updated_at
      `).run({
        ...annotation,
        pinned: annotation.pinned ? 1 : 0,
        tagsJson: JSON.stringify(annotation.tags),
      });
      recordEvent('session-annotation', annotation.sessionId, 'session-annotation.updated', {
        pinned: annotation.pinned,
        tagCount: annotation.tags.length,
        version: annotation.version,
      });
      return annotation;
    }),

    listSavedSessionFilters(): ISavedSessionFilter[] {
      const rows = db.prepare(`
        select id, name, query_json as queryJson, created_at as createdAt, updated_at as updatedAt
        from session_saved_filters order by updated_at desc, id asc
      `).all() as Array<{ id: string; name: string; queryJson: string; createdAt: string; updatedAt: string }>;
      return rows.map((row) => {
        try {
          return savedSessionFilterSchema.parse({
            id: row.id,
            name: row.name,
            query: JSON.parse(row.queryJson) as unknown,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          });
        } catch {
          throw annotationError('session-saved-filter-corrupt', 'Stored session filter is corrupt.');
        }
      });
    },

    upsertSavedSessionFilter(filter: ISavedSessionFilter): ISavedSessionFilter {
      const parsed = savedSessionFilterSchema.parse(filter);
      db.prepare(`
        insert into session_saved_filters(id, name, query_json, created_at, updated_at)
        values (@id, @name, @queryJson, @createdAt, @updatedAt)
        on conflict(id) do update set
          name = excluded.name,
          query_json = excluded.query_json,
          updated_at = excluded.updated_at
      `).run({ ...parsed, queryJson: JSON.stringify(parsed.query) });
      recordEvent('session-saved-filter', parsed.id, 'session-saved-filter.upserted', {
        queryLength: parsed.query.query.length,
      });
      return parsed;
    },

    deleteSavedSessionFilter(id: string): boolean {
      const result = db.prepare(`delete from session_saved_filters where id = ?`).run(id);
      if (result.changes > 0) recordEvent('session-saved-filter', id, 'session-saved-filter.deleted', {});
      return result.changes > 0;
    },
  };
};

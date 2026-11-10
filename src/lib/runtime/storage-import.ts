import type { TRuntimeDatabase } from '@/lib/runtime/storage/schema';
import { isAgentPanelType } from '@/lib/panel-type';
import type { IHistoryEntry } from '@/types/message-history';
import type { ILayoutData, IPaneNode, ISplitNode, ITab, IWorkspacesData, TLayoutNode, TPanelType, TRuntimeVersion } from '@/types/terminal';

export interface IImportLegacyStorageSnapshotInput {
  workspacesData: IWorkspacesData;
  layoutsByWorkspaceId: Record<string, ILayoutData | null | undefined>;
  messageHistoryByWorkspaceId?: Record<string, IHistoryEntry[] | null | undefined>;
  importedAt?: string;
  pruneMissing?: boolean;
}

export interface IImportLegacyStorageSnapshotResult {
  importedGroupCount: number;
  importedWorkspaceCount: number;
  importedPaneCount: number;
  importedSplitPaneCount: number;
  importedTabCount: number;
  importedRuntimeV1TabCount: number;
  importedRuntimeV2TabCount: number;
  importedNonTerminalTabCount: number;
  importedStatusMetadataCount: number;
  importedMessageHistoryCount: number;
  missingLayoutCount: number;
  invalidLayoutCount: number;
  prunedWorkspaceCount: number;
  prunedPaneCount: number;
  prunedTabCount: number;
  prunedGroupCount: number;
}

const panelTypeForImport = (panelType: TPanelType | undefined): TPanelType =>
  panelType ?? 'terminal';

const runtimeVersionForImport = (tab: ITab): TRuntimeVersion =>
  tab.runtimeVersion ?? 1;

const hasStatusMetadata = (tab: ITab): boolean =>
  Boolean(
    tab.cliState
    || tab.agentSessionId
    || tab.agentJsonlPath
    || tab.agentSummary
    || tab.lastUserMessage
    || tab.lastCommand
    || tab.title
    || tab.dismissedAt
    || tab.terminalRatio
    || tab.terminalCollapsed,
  );

const splitIdForPath = (workspaceId: string, path: number[]): string =>
  `split-${workspaceId}-${path.length ? path.join('-') : 'root'}`;

const createEmptyResult = (): IImportLegacyStorageSnapshotResult => ({
  importedGroupCount: 0,
  importedWorkspaceCount: 0,
  importedPaneCount: 0,
  importedSplitPaneCount: 0,
  importedTabCount: 0,
  importedRuntimeV1TabCount: 0,
  importedRuntimeV2TabCount: 0,
  importedNonTerminalTabCount: 0,
  importedStatusMetadataCount: 0,
  importedMessageHistoryCount: 0,
  missingLayoutCount: 0,
  invalidLayoutCount: 0,
  prunedWorkspaceCount: 0,
  prunedPaneCount: 0,
  prunedTabCount: 0,
  prunedGroupCount: 0,
});

const isPaneNode = (node: TLayoutNode): node is IPaneNode =>
  node.type === 'pane' && typeof node.id === 'string' && Array.isArray(node.tabs);

const isSplitNode = (node: TLayoutNode): node is ISplitNode =>
  node.type === 'split' && Array.isArray(node.children) && node.children.length === 2;

const importAgentSession = (
  db: TRuntimeDatabase,
  tab: ITab,
  ts: string,
): void => {
  if (!tab.agentSessionId) return;
  db.prepare(`
    insert into agent_sessions (
      id, provider, source, source_id, cwd, jsonl_ref, summary, created_at, updated_at
    )
    values (?, ?, 'legacy-layout', ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      cwd = excluded.cwd,
      jsonl_ref = excluded.jsonl_ref,
      summary = excluded.summary,
      updated_at = excluded.updated_at
  `).run(
    tab.agentSessionId,
    isAgentPanelType(tab.panelType) ? tab.panelType : 'codex',
    tab.agentSessionId,
    tab.cwd ?? null,
    tab.agentJsonlPath ?? null,
    tab.agentSummary ?? null,
    ts,
    ts,
  );
};

const setAppState = (
  db: TRuntimeDatabase,
  key: string,
  value: unknown,
  updatedAt: string,
): void => {
  db.prepare(`
    insert into app_state (key, value_json, updated_at)
    values (?, ?, ?)
    on conflict(key) do update set
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), updatedAt);
};

const replaceWorkspaceDirectories = (
  db: TRuntimeDatabase,
  workspaceId: string,
  directories: readonly string[],
  ts: string,
): void => {
  db.prepare(`delete from workspace_directories where workspace_id = ?`).run(workspaceId);
  [...new Set(directories.filter(Boolean))].forEach((directory, index) => {
    db.prepare(`
      insert into workspace_directories (workspace_id, path, order_index, created_at, updated_at)
      values (?, ?, ?, ?, ?)
    `).run(workspaceId, directory, index, ts, ts);
  });
};

const replaceMessageHistory = (
  db: TRuntimeDatabase,
  workspaceId: string,
  entries: readonly IHistoryEntry[],
  ts: string,
  result: IImportLegacyStorageSnapshotResult,
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
    result.importedMessageHistoryCount += 1;
  });
};

const placeholders = (count: number): string =>
  Array.from({ length: count }, () => '?').join(', ');

const collectSnapshotIdsWithPath = (
  workspaceId: string,
  node: TLayoutNode,
  path: number[],
  ids: { paneIds: Set<string>; tabIds: Set<string> },
): void => {
  if (isPaneNode(node)) {
    ids.paneIds.add(node.id);
    node.tabs.forEach((tab) => ids.tabIds.add(tab.id));
    return;
  }
  if (isSplitNode(node)) {
    ids.paneIds.add(splitIdForPath(workspaceId, path));
    collectSnapshotIdsWithPath(workspaceId, node.children[0], [...path, 0], ids);
    collectSnapshotIdsWithPath(workspaceId, node.children[1], [...path, 1], ids);
  }
};

const deleteNotIn = (
  db: TRuntimeDatabase,
  table: string,
  column: string,
  parentColumn: string,
  parentId: string,
  ids: Set<string>,
): number => {
  if (ids.size === 0) {
    return db.prepare(`delete from ${table} where ${parentColumn} = ?`).run(parentId).changes;
  }
  const values = Array.from(ids);
  return db.prepare(`
    delete from ${table}
    where ${parentColumn} = ? and ${column} not in (${placeholders(values.length)})
  `).run(parentId, ...values).changes;
};

const pruneWorkspaceRows = (
  db: TRuntimeDatabase,
  workspaceId: string,
  layout: ILayoutData,
  result: IImportLegacyStorageSnapshotResult,
): void => {
  const ids = { paneIds: new Set<string>(), tabIds: new Set<string>() };
  collectSnapshotIdsWithPath(workspaceId, layout.root, [], ids);
  result.prunedTabCount += deleteNotIn(db, 'tabs', 'id', 'workspace_id', workspaceId, ids.tabIds);
  result.prunedPaneCount += deleteNotIn(db, 'panes', 'id', 'workspace_id', workspaceId, ids.paneIds);
};

const pruneSnapshotRows = (
  db: TRuntimeDatabase,
  workspacesData: IWorkspacesData,
  layoutsByWorkspaceId: Record<string, ILayoutData | null | undefined>,
  result: IImportLegacyStorageSnapshotResult,
): void => {
  const workspaceIds = new Set(workspacesData.workspaces.map((workspace) => workspace.id));
  const groupIds = new Set((workspacesData.groups ?? []).map((group) => group.id));
  if (workspaceIds.size === 0) {
    result.prunedWorkspaceCount += db.prepare(`delete from workspaces`).run().changes;
  } else {
    const ids = Array.from(workspaceIds);
    result.prunedWorkspaceCount += db.prepare(`
      delete from workspaces where id not in (${placeholders(ids.length)})
    `).run(...ids).changes;
  }

  if (groupIds.size === 0) {
    result.prunedGroupCount += db.prepare(`delete from workspace_groups`).run().changes;
  } else {
    const ids = Array.from(groupIds);
    result.prunedGroupCount += db.prepare(`
      delete from workspace_groups where id not in (${placeholders(ids.length)})
    `).run(...ids).changes;
  }

  for (const workspaceId of workspaceIds) {
    const layout = layoutsByWorkspaceId[workspaceId];
    if (!layout || (!isPaneNode(layout.root) && !isSplitNode(layout.root))) continue;
    pruneWorkspaceRows(db, workspaceId, layout, result);
  }
};

const importTab = (
  db: TRuntimeDatabase,
  workspaceId: string,
  paneId: string,
  tab: ITab,
  orderIndex: number,
  ts: string,
  result: IImportLegacyStorageSnapshotResult,
): void => {
  const panelType = panelTypeForImport(tab.panelType);
  const runtimeVersion = runtimeVersionForImport(tab);
  const statusMetadata = hasStatusMetadata(tab);

  importAgentSession(db, tab, ts);
  db.prepare(`
    insert into tabs (
      id, workspace_id, pane_id, session_name, panel_type, name, title, cwd,
      lifecycle_state, order_index, terminal_ratio, terminal_collapsed, web_url,
      last_command, runtime_version, created_at, updated_at
    )
    values (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      workspace_id = excluded.workspace_id,
      pane_id = excluded.pane_id,
      session_name = excluded.session_name,
      panel_type = excluded.panel_type,
      name = excluded.name,
      title = excluded.title,
      cwd = excluded.cwd,
      lifecycle_state = 'ready',
      order_index = excluded.order_index,
      terminal_ratio = excluded.terminal_ratio,
      terminal_collapsed = excluded.terminal_collapsed,
      web_url = excluded.web_url,
      last_command = excluded.last_command,
      runtime_version = excluded.runtime_version,
      updated_at = excluded.updated_at
  `).run(
    tab.id,
    workspaceId,
    paneId,
    tab.sessionName,
    panelType,
    tab.name ?? '',
    tab.title ?? null,
    tab.cwd ?? null,
    orderIndex,
    tab.terminalRatio ?? null,
    tab.terminalCollapsed ? 1 : 0,
    tab.webUrl ?? null,
    tab.lastCommand ?? null,
    runtimeVersion,
    ts,
    ts,
  );

  db.prepare(`
    insert into tab_status (
      tab_id, cli_state, pane_title, agent_session_id, agent_jsonl_ref,
      agent_summary, last_user_message, dismissed_at, updated_at
    )
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(tab_id) do update set
      cli_state = excluded.cli_state,
      pane_title = excluded.pane_title,
      agent_session_id = excluded.agent_session_id,
      agent_jsonl_ref = excluded.agent_jsonl_ref,
      agent_summary = excluded.agent_summary,
      last_user_message = excluded.last_user_message,
      dismissed_at = excluded.dismissed_at,
      updated_at = excluded.updated_at
  `).run(
    tab.id,
    tab.cliState ?? 'inactive',
    tab.title ?? null,
    tab.agentSessionId ?? null,
    tab.agentJsonlPath ?? null,
    tab.agentSummary ?? null,
    tab.lastUserMessage ?? null,
    tab.dismissedAt ?? null,
    ts,
  );

  result.importedTabCount += 1;
  if (panelType === 'terminal') {
    if (runtimeVersion === 2) result.importedRuntimeV2TabCount += 1;
    else result.importedRuntimeV1TabCount += 1;
  } else {
    result.importedNonTerminalTabCount += 1;
  }
  if (statusMetadata) result.importedStatusMetadataCount += 1;
};

const importNode = (
  db: TRuntimeDatabase,
  workspaceId: string,
  node: TLayoutNode,
  parentId: string | null,
  position: number,
  path: number[],
  ts: string,
  result: IImportLegacyStorageSnapshotResult,
): string | null => {
  if (isPaneNode(node)) {
    db.prepare(`
      insert into panes (id, workspace_id, parent_id, node_kind, position, active_tab_id, created_at, updated_at)
      values (?, ?, ?, 'pane', ?, null, ?, ?)
      on conflict(id) do update set
        workspace_id = excluded.workspace_id,
        parent_id = excluded.parent_id,
        node_kind = 'pane',
        split_axis = null,
        ratio = null,
        position = excluded.position,
        active_tab_id = null,
        updated_at = excluded.updated_at
    `).run(node.id, workspaceId, parentId, position, ts, ts);
    result.importedPaneCount += 1;
    node.tabs.forEach((tab, index) => importTab(db, workspaceId, node.id, tab, index, ts, result));
    db.prepare(`update panes set active_tab_id = ?, updated_at = ? where id = ?`)
      .run(node.activeTabId, ts, node.id);
    return node.id;
  }

  if (isSplitNode(node)) {
    const splitId = splitIdForPath(workspaceId, path);
    db.prepare(`
      insert into panes (id, workspace_id, parent_id, node_kind, split_axis, ratio, position, created_at, updated_at)
      values (?, ?, ?, 'split', ?, ?, ?, ?, ?)
      on conflict(id) do update set
        workspace_id = excluded.workspace_id,
        parent_id = excluded.parent_id,
        node_kind = 'split',
        split_axis = excluded.split_axis,
        ratio = excluded.ratio,
        position = excluded.position,
        active_tab_id = null,
        updated_at = excluded.updated_at
    `).run(splitId, workspaceId, parentId, node.orientation, node.ratio, position, ts, ts);
    result.importedSplitPaneCount += 1;
    importNode(db, workspaceId, node.children[0], splitId, 0, [...path, 0], ts, result);
    importNode(db, workspaceId, node.children[1], splitId, 1, [...path, 1], ts, result);
    return splitId;
  }

  result.invalidLayoutCount += 1;
  return null;
};

export const importLegacyStorageSnapshot = (
  db: TRuntimeDatabase,
  {
    workspacesData,
    layoutsByWorkspaceId,
    messageHistoryByWorkspaceId = {},
    importedAt = new Date().toISOString(),
    pruneMissing = false,
  }: IImportLegacyStorageSnapshotInput,
): IImportLegacyStorageSnapshotResult => {
  const result = createEmptyResult();
  const groups = workspacesData.groups ?? [];
  const importTx = db.transaction(() => {
    setAppState(db, 'workspace-ui', {
      activeWorkspaceId: workspacesData.activeWorkspaceId ?? null,
      sidebarCollapsed: workspacesData.sidebarCollapsed,
      sidebarWidth: workspacesData.sidebarWidth,
      updatedAt: workspacesData.updatedAt,
    }, importedAt);

    groups.forEach((group, index) => {
      db.prepare(`
        insert into workspace_groups (id, name, collapsed, order_index, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          name = excluded.name,
          collapsed = excluded.collapsed,
          order_index = excluded.order_index,
          updated_at = excluded.updated_at
      `).run(group.id, group.name, group.collapsed ? 1 : 0, index, importedAt, importedAt);
      result.importedGroupCount += 1;
    });

    workspacesData.workspaces.forEach((workspace, index) => {
      const layout = layoutsByWorkspaceId[workspace.id];
      if (!layout) {
        result.missingLayoutCount += 1;
        return;
      }
      const defaultCwd = workspace.directories[0] ?? '';
      db.prepare(`
        insert into workspaces (
          id, name, default_cwd, active, group_id, order_index, active_pane_id, created_at, updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          name = excluded.name,
          default_cwd = excluded.default_cwd,
          active = excluded.active,
          group_id = excluded.group_id,
          order_index = excluded.order_index,
          active_pane_id = excluded.active_pane_id,
          updated_at = excluded.updated_at
      `).run(
        workspace.id,
        workspace.name,
        defaultCwd,
        workspacesData.activeWorkspaceId === workspace.id ? 1 : 0,
        workspace.groupId ?? null,
        index,
        layout.activePaneId,
        importedAt,
        importedAt,
      );
      result.importedWorkspaceCount += 1;
      replaceWorkspaceDirectories(db, workspace.id, workspace.directories, importedAt);
      replaceMessageHistory(db, workspace.id, messageHistoryByWorkspaceId[workspace.id] ?? [], importedAt, result);
      importNode(db, workspace.id, layout.root, null, 0, [], importedAt, result);
    });
    if (pruneMissing) {
      pruneSnapshotRows(db, workspacesData, layoutsByWorkspaceId, result);
    }
  });

  importTx();
  return result;
};

import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';

export type TRuntimeDatabase = import('better-sqlite3').Database;

interface IBetterSqlite3Constructor {
  new (dbPath: string, options?: { readonly?: boolean; fileMustExist?: boolean }): TRuntimeDatabase;
}

export interface IOpenRuntimeDatabaseOptions {
  loadDatabase?: () => IBetterSqlite3Constructor;
  beforeMigration?: (input: IRuntimeMigrationBackupInput) => void;
}

export interface IRuntimeMigrationBackupInput {
  dbPath: string;
  fromVersion: number;
  toVersion: number;
}

export const CURRENT_RUNTIME_SCHEMA_VERSION = 6;

export const RUNTIME_SCHEMA_V6_DOWNGRADE_SQL = 'alter table tabs drop column created_by_tab_id; delete from schema_migrations where version = 6;';

const runtimeRequireBase = path.join(
  process.env.__CMUX_APP_DIR_UNPACKED || process.env.__CMUX_APP_DIR || path.join(/*turbopackIgnore: true*/ process.cwd()),
  'package.json',
);
const requireOptional = createRequire(runtimeRequireBase);

const RUNTIME_SCHEMA_V1 = `
create table if not exists schema_migrations (
  version integer primary key,
  applied_at text not null
);

create table if not exists workspace_groups (
  id text primary key,
  name text not null,
  collapsed integer not null default 0,
  order_index integer not null,
  created_at text not null,
  updated_at text not null
);

create table if not exists workspaces (
  id text primary key,
  name text not null,
  default_cwd text not null,
  active integer not null default 0,
  group_id text null references workspace_groups(id) on delete set null,
  order_index integer not null,
  created_at text not null,
  updated_at text not null
);

create table if not exists panes (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  parent_id text null references panes(id) on delete cascade,
  node_kind text not null,
  split_axis text null,
  ratio real null,
  position integer not null,
  active_tab_id text null references tabs(id) on delete set null,
  created_at text not null,
  updated_at text not null
);

create table if not exists tabs (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  pane_id text not null references panes(id) on delete cascade,
  session_name text not null unique,
  panel_type text not null,
  name text not null default '',
  title text null,
  cwd text null,
  lifecycle_state text not null default 'ready',
  failure_reason text null,
  order_index integer not null,
  terminal_ratio real null,
  terminal_collapsed integer not null default 0,
  web_url text null,
  last_command text null,
  created_at text not null,
  updated_at text not null
);

create table if not exists agent_sessions (
  id text primary key,
  provider text not null,
  source text not null,
  source_id text null,
  cwd text null,
  jsonl_ref text null,
  started_at text null,
  last_activity_at text null,
  first_message text not null default '',
  turn_count integer not null default 0,
  summary text null,
  created_at text not null,
  updated_at text not null
);

create table if not exists tab_status (
  tab_id text primary key references tabs(id) on delete cascade,
  cli_state text not null,
  current_process text null,
  pane_title text null,
  agent_session_id text null references agent_sessions(id) on delete set null,
  agent_jsonl_ref text null,
  agent_summary text null,
  last_user_message text null,
  last_assistant_message text null,
  current_action_json text null,
  ready_for_review_at integer null,
  busy_since integer null,
  dismissed_at integer null,
  last_event_json text null,
  event_seq integer not null default 0,
  updated_at text not null
);

create table if not exists mutation_events (
  id text primary key,
  command_id text null,
  actor text not null,
  entity_type text not null,
  entity_id text not null,
  event_type text not null,
  payload_json text not null,
  before_hash text null,
  after_hash text null,
  created_at text not null
);

create table if not exists status_events (
  id text primary key,
  tab_id text null references tabs(id) on delete set null,
  agent_session_id text null references agent_sessions(id) on delete set null,
  event_type text not null,
  payload_json text not null,
  source text not null,
  created_at text not null
);

create table if not exists remote_sources (
  id text primary key,
  source_label text not null,
  host text null,
  shell text null,
  latest_sync_at text null,
  latest_activity_at text null,
  latest_cwd text null,
  latest_remote_path text null,
  total_bytes integer not null default 0,
  updated_at text not null
);

create index if not exists idx_runtime_workspaces_group_order
  on workspaces(group_id, order_index, created_at);
create index if not exists idx_runtime_panes_workspace_parent_position
  on panes(workspace_id, parent_id, position);
create index if not exists idx_runtime_tabs_workspace_pane_order
  on tabs(workspace_id, pane_id, order_index);
create index if not exists idx_runtime_tabs_lifecycle_state_created_at
  on tabs(lifecycle_state, created_at);
create index if not exists idx_runtime_mutation_events_created_at
  on mutation_events(created_at);
create index if not exists idx_runtime_status_events_tab_created_at
  on status_events(tab_id, created_at);
create index if not exists idx_runtime_agent_sessions_provider_source
  on agent_sessions(provider, source_id);
create index if not exists idx_runtime_remote_sources_label_host
  on remote_sources(source_label, host);
`;

interface IRuntimeMigration {
  version: number;
  up: (db: TRuntimeDatabase) => void;
}

const RUNTIME_MIGRATIONS: IRuntimeMigration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(RUNTIME_SCHEMA_V1);
    },
  },
  {
    version: 2,
    up: (db) => {
      db.exec(`
        alter table workspaces add column active_pane_id text null;
        alter table tabs add column runtime_version integer not null default 2;
      `);
    },
  },
  {
    version: 3,
    up: (db) => {
      db.exec(`
        create table if not exists workspace_directories (
          workspace_id text not null references workspaces(id) on delete cascade,
          path text not null,
          order_index integer not null,
          created_at text not null,
          updated_at text not null,
          primary key (workspace_id, order_index)
        );

        create table if not exists app_state (
          key text primary key,
          value_json text not null,
          updated_at text not null
        );

        create table if not exists message_history (
          workspace_id text not null references workspaces(id) on delete cascade,
          id text not null,
          message text not null,
          sent_at text not null,
          order_index integer not null,
          created_at text not null,
          updated_at text not null,
          primary key (workspace_id, id)
        );

        create index if not exists idx_runtime_workspace_directories_workspace_order
          on workspace_directories(workspace_id, order_index);

        create index if not exists idx_runtime_message_history_workspace_order
          on message_history(workspace_id, order_index);
      `);
    },
  },
  {
    version: 4,
    up: (db) => {
      db.exec(`
        create table if not exists session_annotations (
          session_id text primary key,
          pinned integer not null default 0,
          tags_json text not null default '[]',
          version integer not null,
          updated_at text not null
        );

        create table if not exists session_saved_filters (
          id text primary key,
          name text not null,
          query_json text not null,
          created_at text not null,
          updated_at text not null
        );

        create index if not exists idx_runtime_session_annotations_pinned_updated
          on session_annotations(pinned, updated_at desc);
        create index if not exists idx_runtime_session_saved_filters_updated
          on session_saved_filters(updated_at desc, id);
      `);
    },
  },
  {
    version: 5,
    up: (db) => {
      db.exec(`
        create table if not exists approved_project_roots (
          id text primary key,
          label text not null,
          canonical_path text not null unique,
          approved_at text not null
        );

        create table if not exists managed_projects (
          id text primary key,
          approved_root_id text not null references approved_project_roots(id) on delete restrict,
          title text not null,
          relative_path text not null,
          canonical_path text not null unique,
          source text not null,
          external_id text null,
          source_fingerprint text null,
          created_at text not null,
          updated_at text not null
        );

        create table if not exists managed_project_imports (
          id text primary key,
          approved_root_id text not null references approved_project_roots(id) on delete restrict,
          digest text not null,
          source_fingerprint text not null,
          counts_json text not null,
          imported_at text not null
        );

        create table if not exists governance_audit_events (
          id text primary key,
          action text not null,
          target_project_id text null,
          status text not null,
          duration_ms integer not null,
          summary_json text not null,
          created_at text not null
        );

        create unique index if not exists idx_runtime_managed_projects_root_external
          on managed_projects(approved_root_id, external_id) where external_id is not null;
        create index if not exists idx_runtime_managed_projects_root_updated
          on managed_projects(approved_root_id, updated_at desc, id);
        create index if not exists idx_runtime_managed_project_imports_root_time
          on managed_project_imports(approved_root_id, imported_at desc, id);
        create index if not exists idx_runtime_governance_audit_project_time
          on governance_audit_events(target_project_id, created_at desc, id);
      `);
    },
  },
  {
    version: 6,
    up: (db) => {
      db.exec(`alter table tabs add column created_by_tab_id text null;`);
    },
  },
];

const createSqliteUnavailableError = (cause: unknown): Error =>
  Object.assign(
    new Error('Runtime v2 requires optional dependency better-sqlite3. Install dependencies with native build support before enabling AGENTMUX_RUNTIME_V2=1.'),
    {
      code: 'runtime-v2-sqlite-unavailable',
      retryable: false,
      cause,
    },
  );

const hasSchemaMigrationsTable = (db: TRuntimeDatabase): boolean => {
  const row = db.prepare(`
    select 1 as present from sqlite_master
    where type = 'table' and name = 'schema_migrations'
  `).get() as { present: number } | undefined;
  return Boolean(row);
};

const readAppliedMigrationVersions = (db: TRuntimeDatabase): Set<number> => {
  if (!hasSchemaMigrationsTable(db)) return new Set();
  const rows = db.prepare(`select version from schema_migrations order by version`).all() as Array<{ version: number }>;
  return new Set(rows.map((row) => row.version));
};

export const runRuntimeMigrations = (
  db: TRuntimeDatabase,
  targetVersion = CURRENT_RUNTIME_SCHEMA_VERSION,
): void => {
  const appliedVersions = readAppliedMigrationVersions(db);
  const maxAppliedVersion = Math.max(0, ...Array.from(appliedVersions));
  if (maxAppliedVersion > CURRENT_RUNTIME_SCHEMA_VERSION) {
    throw Object.assign(
      new Error(`Runtime v2 database schema version ${maxAppliedVersion} is newer than supported version ${CURRENT_RUNTIME_SCHEMA_VERSION}.`),
      {
        code: 'runtime-v2-schema-too-new',
        retryable: false,
      },
    );
  }

  for (const migration of RUNTIME_MIGRATIONS) {
    if (migration.version > targetVersion || appliedVersions.has(migration.version)) continue;
    db.transaction(() => {
      migration.up(db);
      db.prepare(`insert into schema_migrations(version, applied_at) values(?, ?)`).run(
        migration.version,
        new Date().toISOString(),
      );
    })();
    appliedVersions.add(migration.version);
  }
};

const loadBetterSqlite3 = (): IBetterSqlite3Constructor => {
  try {
    return requireOptional('better-sqlite3') as IBetterSqlite3Constructor;
  } catch (err) {
    throw createSqliteUnavailableError(err);
  }
};

const resolveDatabaseConstructor = (options: IOpenRuntimeDatabaseOptions): IBetterSqlite3Constructor => {
  try {
    return (options.loadDatabase ?? loadBetterSqlite3)();
  } catch (err) {
    if (typeof err === 'object' && err && 'code' in err && (err as { code?: unknown }).code === 'runtime-v2-sqlite-unavailable') {
      throw err;
    }
    throw createSqliteUnavailableError(err);
  }
};

const inspectRuntimeSchemaVersion = (
  Database: IBetterSqlite3Constructor,
  dbPath: string,
): number => {
  if (!fs.existsSync(dbPath)) return 0;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    if (!hasSchemaMigrationsTable(db)) return 0;
    const row = db.prepare(`select max(version) as version from schema_migrations`).get() as {
      version: number | null;
    };
    return row.version ?? 0;
  } finally {
    db.close();
  }
};

const createRuntimeMigrationBackup = ({
  dbPath,
  fromVersion,
  toVersion,
}: IRuntimeMigrationBackupInput): void => {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z');
  const dataDir = path.dirname(path.dirname(dbPath));
  const backupDir = path.join(dataDir, 'backups', `runtime-v2-migration-v${fromVersion}-v${toVersion}-${timestamp}`);
  try {
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    for (const source of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      if (!fs.existsSync(/* turbopackIgnore: true */ source)) continue;
      const destination = path.join(backupDir, path.basename(source));
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(destination, 0o600);
    }
  } catch (cause) {
    throw Object.assign(new Error('Runtime v2 migration backup failed.'), {
      code: 'runtime-v2-migration-backup-failed',
      retryable: false,
      cause,
    });
  }
};

const applyPrivateMode = (filePath: string): void => {
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
};

export const openRuntimeDatabase = (
  dbPath: string,
  options: IOpenRuntimeDatabaseOptions = {},
): TRuntimeDatabase => {
  const directory = path.dirname(dbPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  applyPrivateMode(dbPath);
  applyPrivateMode(`${dbPath}-wal`);
  applyPrivateMode(`${dbPath}-shm`);
  const Database = resolveDatabaseConstructor(options);
  const existingVersion = inspectRuntimeSchemaVersion(Database, dbPath);
  if (fs.existsSync(dbPath) && existingVersion < CURRENT_RUNTIME_SCHEMA_VERSION) {
    (options.beforeMigration ?? createRuntimeMigrationBackup)({
      dbPath,
      fromVersion: existingVersion,
      toVersion: CURRENT_RUNTIME_SCHEMA_VERSION,
    });
  }
  const db = new Database(dbPath);
  try {
    applyPrivateMode(dbPath);
    db.pragma('busy_timeout = 5000');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    runRuntimeMigrations(db);
    applyPrivateMode(dbPath);
    applyPrivateMode(`${dbPath}-wal`);
    applyPrivateMode(`${dbPath}-shm`);
    return db;
  } catch (err) {
    try {
      db.close();
    } catch {}
    throw err;
  }
};

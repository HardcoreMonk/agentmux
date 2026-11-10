import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

export type TSessionCatalogDatabase = import('better-sqlite3').Database;

interface IBetterSqlite3Constructor {
  new (dbPath: string): TSessionCatalogDatabase;
}

export interface IOpenSessionCatalogDatabaseOptions {
  loadDatabase?: () => IBetterSqlite3Constructor;
}

const catalogRequire = createRequire(path.join(process.cwd(), 'package.json'));

const loadBetterSqlite3 = (): IBetterSqlite3Constructor =>
  catalogRequire('better-sqlite3') as IBetterSqlite3Constructor;

const CATALOG_SCHEMA = `
create table if not exists catalog_sessions (
  session_id text primary key,
  provider text not null default 'codex',
  project_label text not null,
  model text null,
  started_at text not null,
  last_activity_at text not null,
  turn_count integer not null,
  indexed_at text not null,
  parent_session_id text null,
  root_session_id text null,
  relationship text null
);

create table if not exists catalog_messages (
  row_id integer primary key autoincrement,
  id text not null unique,
  session_id text not null references catalog_sessions(session_id) on delete cascade,
  role text not null,
  content text not null,
  snippet text not null,
  timestamp text not null,
  sequence integer not null
);

create virtual table if not exists catalog_messages_fts using fts5(
  message_id unindexed,
  session_id unindexed,
  content,
  tokenize = 'unicode61'
);

create table if not exists catalog_file_cursors (
  file_key text primary key,
  canonical_path text not null,
  file_identity text not null,
  mtime_ms real not null,
  size_bytes integer not null,
  safe_byte integer not null,
  session_id text null,
  updated_at text not null
);

create table if not exists catalog_health (
  id integer primary key check (id = 1),
  state text not null,
  queue_lag integer not null default 0,
  cursor_age_ms integer null,
  rebuild_state text not null default 'idle',
  updated_at text not null
);

create index if not exists idx_catalog_sessions_last_activity
  on catalog_sessions(last_activity_at desc, session_id desc);
create index if not exists idx_catalog_sessions_project_model
  on catalog_sessions(project_label, model);
create index if not exists idx_catalog_messages_session_sequence
  on catalog_messages(session_id, sequence);
`;

// Catalogs created before provider support lack the column; existing rows are Codex rows.
const migrateProviderColumn = (db: TSessionCatalogDatabase): void => {
  const columns = db.pragma('table_info(catalog_sessions)') as { name: string }[];
  if (!columns.some((column) => column.name === 'provider')) {
    db.exec(`alter table catalog_sessions add column provider text not null default 'codex'`);
  }
  db.exec('create index if not exists idx_catalog_sessions_provider on catalog_sessions(provider)');
};

const applyPrivateMode = (filePath: string): void => {
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
};

export const openSessionCatalogDatabase = (
  dbPath: string,
  options: IOpenSessionCatalogDatabaseOptions = {},
): TSessionCatalogDatabase => {
  const directory = path.dirname(dbPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const Database = (options.loadDatabase ?? loadBetterSqlite3)();
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(CATALOG_SCHEMA);
  migrateProviderColumn(db);
  applyPrivateMode(dbPath);
  applyPrivateMode(`${dbPath}-wal`);
  applyPrivateMode(`${dbPath}-shm`);
  return db;
};

export const quarantineSessionCatalogFiles = async (
  dbPath: string,
  timestamp: string,
): Promise<string[]> => {
  const moved: string[] = [];
  for (const source of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    const destination = `${source}.quarantine-${timestamp}`;
    try {
      await fsPromises.rename(source, destination);
      moved.push(destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return moved;
};

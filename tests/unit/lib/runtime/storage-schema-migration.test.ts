import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_RUNTIME_SCHEMA_VERSION,
  RUNTIME_SCHEMA_V6_DOWNGRADE_SQL,
  openRuntimeDatabase,
  runRuntimeMigrations,
  type IRuntimeMigrationBackupInput,
  type TRuntimeDatabase,
} from '@/lib/runtime/storage/schema';
import { createStorageRepository } from '@/lib/runtime/storage/repository';

const requireOptional = createRequire(path.join(process.cwd(), 'package.json'));
const Database = requireOptional('better-sqlite3') as typeof import('better-sqlite3');

describe('runtime storage annotation migration', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'codexmux-storage-migration-'));
  });

  afterEach(async () => {
    await fsPromises.rm(dir, { recursive: true, force: true });
  });

  const createDatabaseAtVersion = (dbPath: string, version: number) => {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    runRuntimeMigrations(db, version);
    db.close();
  };

  const createVersion3Database = (dbPath: string) => createDatabaseAtVersion(dbPath, 3);

  const createVersion5Database = (dbPath: string) => createDatabaseAtVersion(dbPath, 5);

  const readTabColumns = (db: TRuntimeDatabase): string[] =>
    (db.prepare(`pragma table_info(tabs)`).all() as Array<{ name: string }>).map((row) => row.name);

  const readMaxVersion = (db: TRuntimeDatabase): number =>
    (db.prepare(`select max(version) as version from schema_migrations`).get() as { version: number }).version;

  it('backs up an existing v3 database before adding annotation tables', () => {
    const dbPath = path.join(dir, 'runtime-v2', 'state.db');
    createVersion3Database(dbPath);
    const backups: IRuntimeMigrationBackupInput[] = [];

    const db = openRuntimeDatabase(dbPath, { beforeMigration: (input) => backups.push(input) });
    const tables = db.prepare(`select name from sqlite_master where type = 'table'`).all()
      .map((row) => (row as { name: string }).name);
    const version = db.prepare(`select max(version) as version from schema_migrations`).get() as { version: number };
    db.close();

    expect(backups).toEqual([{ dbPath, fromVersion: 3, toVersion: CURRENT_RUNTIME_SCHEMA_VERSION }]);
    expect(tables).toEqual(expect.arrayContaining(['session_annotations', 'session_saved_filters']));
    expect(version.version).toBe(CURRENT_RUNTIME_SCHEMA_VERSION);
  });

  it('does not start schema writes when the pre-migration backup fails', () => {
    const dbPath = path.join(dir, 'runtime-v2', 'state.db');
    createVersion3Database(dbPath);
    const beforeMigration = vi.fn(() => {
      throw Object.assign(new Error('backup failed'), { code: 'runtime-v2-migration-backup-failed' });
    });

    expect(() => openRuntimeDatabase(dbPath, { beforeMigration })).toThrow(expect.objectContaining({
      code: 'runtime-v2-migration-backup-failed',
    }));
    const db = new Database(dbPath, { readonly: true });
    const version = db.prepare(`select max(version) as version from schema_migrations`).get() as { version: number };
    const annotation = db.prepare(`select name from sqlite_master where name = 'session_annotations'`).get();
    db.close();

    expect(version.version).toBe(3);
    expect(annotation).toBeUndefined();
  });

  it('backs up a v5 database and adds the tab creator column', () => {
    const dbPath = path.join(dir, 'runtime-v2', 'state.db');
    createVersion5Database(dbPath);

    const db = openRuntimeDatabase(dbPath);
    const columns = readTabColumns(db);
    const version = readMaxVersion(db);
    db.close();

    expect(CURRENT_RUNTIME_SCHEMA_VERSION).toBe(6);
    expect(version).toBe(6);
    expect(columns).toContain('created_by_tab_id');
    expect(fs.readdirSync(path.join(dir, 'backups'))).toEqual([
      expect.stringMatching(/^runtime-v2-migration-v5-v6-/),
    ]);
  });

  it('downgrades a v6 database to v5 in place and upgrades it again on the next open', () => {
    const dbPath = path.join(dir, 'runtime-v2', 'state.db');
    const db = openRuntimeDatabase(dbPath);
    const repo = createStorageRepository(db);
    const workspace = repo.createWorkspace({ name: 'Runtime', defaultCwd: dir });
    repo.createPendingTerminalTab({
      id: 'tab-created',
      workspaceId: workspace.id,
      paneId: workspace.rootPaneId,
      sessionName: `rtv2-${workspace.id}-${workspace.rootPaneId}-tab-created`,
      cwd: dir,
    });
    repo.finalizeTerminalTab({ id: 'tab-created' });
    db.prepare(`update tabs set created_by_tab_id = ? where id = ?`).run('tab-creator', 'tab-created');

    db.exec(RUNTIME_SCHEMA_V6_DOWNGRADE_SQL);
    expect(readTabColumns(db)).not.toContain('created_by_tab_id');
    expect(readMaxVersion(db)).toBe(5);
    expect(db.prepare(`select id from tabs`).all()).toEqual([{ id: 'tab-created' }]);
    db.close();

    const reopened = openRuntimeDatabase(dbPath);
    expect(readMaxVersion(reopened)).toBe(6);
    expect(readTabColumns(reopened)).toContain('created_by_tab_id');
    reopened.close();
  });

  it('keeps the runtime database and its directory private', () => {
    const dbPath = path.join(dir, 'runtime-v2', 'state.db');

    const db = openRuntimeDatabase(dbPath);

    expect(fs.statSync(path.dirname(dbPath)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(dbPath).mode & 0o777).toBe(0o600);
    for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
      if (fs.existsSync(sidecar)) expect(fs.statSync(sidecar).mode & 0o777).toBe(0o600);
    }
    db.close();
  });
});

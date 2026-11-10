import type {
  ISessionCatalogEntry,
  ISessionSearchResult,
  TSessionAnnotationSelection,
} from '@/lib/session-catalog/contracts';
import type { ISessionCatalogProjection, ISessionCatalogSearchRecord } from '@/lib/session-catalog/jsonl-projector';
import type { TSessionCatalogDatabase } from '@/lib/session-catalog/schema';

export interface ISessionCatalogFileCursor {
  fileKey: string;
  canonicalPath: string;
  fileIdentity: string;
  mtimeMs: number;
  sizeBytes: number;
  safeByte: number;
  sessionId: string | null;
  updatedAt: string;
}

export interface ISessionCatalogSearchRepositoryInput {
  match?: string;
  providers?: string[];
  projects?: string[];
  models?: string[];
  dateFrom?: string;
  dateTo?: string;
  annotationSelection?: TSessionAnnotationSelection;
  after?: { lastActivityAt: string; sessionId: string };
  limit: number;
}

interface ISessionSearchRow {
  sessionId: string;
  provider: ISessionCatalogEntry['provider'];
  projectLabel: string;
  model: string | null;
  startedAt: string;
  lastActivityAt: string;
  turnCount: number;
  indexedAt: string;
  parentSessionId: string | null;
  rootSessionId: string | null;
  relationship: ISessionCatalogEntry['relationship'] | null;
  snippet: string;
}

const toEntry = (row: ISessionSearchRow): ISessionCatalogEntry => ({
  sessionId: row.sessionId,
  provider: row.provider,
  projectLabel: row.projectLabel,
  ...(row.model ? { model: row.model } : {}),
  startedAt: row.startedAt,
  lastActivityAt: row.lastActivityAt,
  turnCount: row.turnCount,
  indexedAt: row.indexedAt,
  ...(row.parentSessionId ? { parentSessionId: row.parentSessionId } : {}),
  ...(row.rootSessionId ? { rootSessionId: row.rootSessionId } : {}),
  ...(row.relationship ? { relationship: row.relationship } : {}),
});

export const createSessionCatalogRepository = (db: TSessionCatalogDatabase) => {
  const upsertSession = db.prepare(`
    insert into catalog_sessions (
      session_id, provider, project_label, model, started_at, last_activity_at, turn_count, indexed_at,
      parent_session_id, root_session_id, relationship
    ) values (
      @sessionId, @provider, @projectLabel, @model, @startedAt, @lastActivityAt, @turnCount, @indexedAt,
      @parentSessionId, @rootSessionId, @relationship
    )
    on conflict(session_id) do update set
      provider = excluded.provider,
      project_label = excluded.project_label,
      model = excluded.model,
      started_at = excluded.started_at,
      last_activity_at = excluded.last_activity_at,
      turn_count = excluded.turn_count,
      indexed_at = excluded.indexed_at,
      parent_session_id = excluded.parent_session_id,
      root_session_id = excluded.root_session_id,
      relationship = excluded.relationship
  `);
  const insertMessage = db.prepare(`
    insert or ignore into catalog_messages (id, session_id, role, content, snippet, timestamp, sequence)
    values (@id, @sessionId, @role, @text, @snippet, @timestamp, @sequence)
  `);
  const insertFts = db.prepare(`
    insert into catalog_messages_fts (message_id, session_id, content)
    values (@id, @sessionId, @text)
  `);

  const writeMessage = (record: ISessionCatalogSearchRecord): boolean => {
    const result = insertMessage.run(record);
    if (result.changes === 0) return false;
    insertFts.run(record);
    return true;
  };

  const replaceProjectionTx = db.transaction((projection: ISessionCatalogProjection): void => {
    if (!projection.entry) {
      throw Object.assign(new Error('Session catalog projection has no entry.'), {
        code: 'catalog-projection-missing-entry',
      });
    }
    const entry = projection.entry;
    upsertSession.run({
      ...entry,
      model: entry.model ?? null,
      parentSessionId: entry.parentSessionId ?? null,
      rootSessionId: entry.rootSessionId ?? null,
      relationship: entry.relationship ?? null,
    });
    db.prepare(`delete from catalog_messages_fts where session_id = ?`).run(entry.sessionId);
    db.prepare(`delete from catalog_messages where session_id = ?`).run(entry.sessionId);
    projection.records.forEach(writeMessage);
  });

  const appendProjectionTx = db.transaction((projection: ISessionCatalogProjection): void => {
    if (!projection.entry) {
      throw Object.assign(new Error('Session catalog projection has no entry.'), {
        code: 'catalog-projection-missing-entry',
      });
    }
    const current = db.prepare(`
      select started_at as startedAt, last_activity_at as lastActivityAt, turn_count as turnCount
      from catalog_sessions where session_id = ?
    `).get(projection.entry.sessionId) as { startedAt: string; lastActivityAt: string; turnCount: number } | undefined;
    const entry = current ? {
      ...projection.entry,
      startedAt: current.startedAt < projection.entry.startedAt ? current.startedAt : projection.entry.startedAt,
      lastActivityAt: current.lastActivityAt > projection.entry.lastActivityAt
        ? current.lastActivityAt
        : projection.entry.lastActivityAt,
      turnCount: current.turnCount + projection.entry.turnCount,
    } : projection.entry;
    upsertSession.run({
      ...entry,
      model: entry.model ?? null,
      parentSessionId: entry.parentSessionId ?? null,
      rootSessionId: entry.rootSessionId ?? null,
      relationship: entry.relationship ?? null,
    });
    projection.records.forEach(writeMessage);
  });

  const buildSearchSql = (input: ISessionCatalogSearchRepositoryInput, count: boolean) => {
    const params: Record<string, unknown> = {};
    const conditions: string[] = [];
    const join = input.match
      ? `join catalog_messages_fts on catalog_messages_fts.session_id = s.session_id
         join catalog_messages m on m.id = catalog_messages_fts.message_id`
      : '';
    if (input.match) {
      conditions.push('catalog_messages_fts match @match');
      params.match = input.match;
    }
    const addList = (column: string, prefix: string, values: string[] | undefined) => {
      if (!values?.length) return;
      const names = values.map((value, index) => {
        const name = `${prefix}${index}`;
        params[name] = value;
        return `@${name}`;
      });
      conditions.push(`${column} in (${names.join(', ')})`);
    };
    addList('s.provider', 'provider', input.providers);
    addList('s.project_label', 'project', input.projects);
    addList('s.model', 'model', input.models);
    if (input.dateFrom) {
      conditions.push('s.last_activity_at >= @dateFrom');
      params.dateFrom = input.dateFrom;
    }
    if (input.dateTo) {
      conditions.push('s.last_activity_at <= @dateTo');
      params.dateTo = input.dateTo;
    }
    if (input.annotationSelection?.sessionIds.length) {
      params.annotationSessionIds = JSON.stringify(input.annotationSelection.sessionIds);
      const membership = 's.session_id in (select value from json_each(@annotationSessionIds))';
      conditions.push(input.annotationSelection.mode === 'include' ? membership : `not (${membership})`);
    } else if (input.annotationSelection?.mode === 'include') {
      conditions.push('0');
    }
    if (!count && input.after) {
      conditions.push('(s.last_activity_at < @afterActivity or (s.last_activity_at = @afterActivity and s.session_id < @afterSessionId))');
      params.afterActivity = input.after.lastActivityAt;
      params.afterSessionId = input.after.sessionId;
    }
    const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
    if (count) {
      return {
        sql: `select count(distinct s.session_id) as total from catalog_sessions s ${join} ${where}`,
        params,
      };
    }
    params.limit = input.limit;
    return {
      sql: `
        select
          s.session_id as sessionId,
          s.provider,
          s.project_label as projectLabel,
          s.model,
          s.started_at as startedAt,
          s.last_activity_at as lastActivityAt,
          s.turn_count as turnCount,
          s.indexed_at as indexedAt,
          s.parent_session_id as parentSessionId,
          s.root_session_id as rootSessionId,
          s.relationship,
          ${input.match ? 'max(m.snippet)' : "''"} as snippet
        from catalog_sessions s
        ${join}
        ${where}
        group by s.session_id
        order by s.last_activity_at desc, s.session_id desc
        limit @limit
      `,
      params,
    };
  };

  return {
    replaceProjection: (projection: ISessionCatalogProjection): void => replaceProjectionTx(projection),
    appendProjection: (projection: ISessionCatalogProjection): void => appendProjectionTx(projection),
    countMessages: (sessionId: string): number => {
      const row = db.prepare(`select count(*) as total from catalog_messages where session_id = ?`)
        .get(sessionId) as { total: number };
      return row.total;
    },
    getSessionEntry: (sessionId: string): ISessionCatalogEntry | null => {
      const row = db.prepare(`
        select session_id as sessionId, provider, project_label as projectLabel, model,
          started_at as startedAt, last_activity_at as lastActivityAt, turn_count as turnCount,
          indexed_at as indexedAt, parent_session_id as parentSessionId,
          root_session_id as rootSessionId, relationship, '' as snippet
        from catalog_sessions where session_id = ?
      `).get(sessionId) as ISessionSearchRow | undefined;
      return row ? toEntry(row) : null;
    },
    search: (input: ISessionCatalogSearchRepositoryInput): ISessionSearchResult[] => {
      const { sql, params } = buildSearchSql(input, false);
      const rows = db.prepare(sql).all(params) as ISessionSearchRow[];
      return rows.map((row) => ({ entry: toEntry(row), snippet: row.snippet }));
    },
    countSearch: (input: ISessionCatalogSearchRepositoryInput): number => {
      const { sql, params } = buildSearchSql(input, true);
      const row = db.prepare(sql).get(params) as { total: number };
      return row.total;
    },
    upsertFileCursor: (cursor: ISessionCatalogFileCursor): void => {
      db.prepare(`
        insert into catalog_file_cursors (
          file_key, canonical_path, file_identity, mtime_ms, size_bytes, safe_byte, session_id, updated_at
        ) values (
          @fileKey, @canonicalPath, @fileIdentity, @mtimeMs, @sizeBytes, @safeByte, @sessionId, @updatedAt
        )
        on conflict(file_key) do update set
          canonical_path = excluded.canonical_path,
          file_identity = excluded.file_identity,
          mtime_ms = excluded.mtime_ms,
          size_bytes = excluded.size_bytes,
          safe_byte = excluded.safe_byte,
          session_id = excluded.session_id,
          updated_at = excluded.updated_at
      `).run(cursor);
    },
    getFileCursor: (fileKey: string): ISessionCatalogFileCursor | null => {
      const row = db.prepare(`
        select file_key as fileKey, canonical_path as canonicalPath, file_identity as fileIdentity,
          mtime_ms as mtimeMs, size_bytes as sizeBytes, safe_byte as safeByte,
          session_id as sessionId, updated_at as updatedAt
        from catalog_file_cursors where file_key = ?
      `).get(fileKey) as ISessionCatalogFileCursor | undefined;
      return row ?? null;
    },
    getFileCursorBySessionId: (sessionId: string): ISessionCatalogFileCursor | null => {
      const row = db.prepare(`
        select file_key as fileKey, canonical_path as canonicalPath, file_identity as fileIdentity,
          mtime_ms as mtimeMs, size_bytes as sizeBytes, safe_byte as safeByte,
          session_id as sessionId, updated_at as updatedAt
        from catalog_file_cursors where session_id = ?
        order by updated_at desc limit 1
      `).get(sessionId) as ISessionCatalogFileCursor | undefined;
      return row ?? null;
    },
    countSessions: (): number => {
      const row = db.prepare(`select count(*) as total from catalog_sessions`).get() as { total: number };
      return row.total;
    },
    compact: (): void => {
      db.pragma('optimize');
      db.exec('vacuum');
    },
  };
};

export type TSessionCatalogRepository = ReturnType<typeof createSessionCatalogRepository>;

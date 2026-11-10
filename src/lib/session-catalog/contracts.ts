import { z } from 'zod';
import type { TAgentPanelType } from '@/types/terminal';

const catalogIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const tagPattern = /^[\p{L}\p{N}][\p{L}\p{N}._ -]{0,39}$/u;
const cursorPattern = /^[A-Za-z0-9_-]{1,512}$/;
const isoTimestampSchema = z.iso.datetime();

export const sessionIdSchema = z.string().regex(catalogIdPattern);
export const sessionTagSchema = z.string().regex(tagPattern);
export const cursorSchema = z.string().regex(cursorPattern);
export const SESSION_ANNOTATION_SELECTION_MAX_IDS = 10_000;

const providerSchema = z.enum(['codex', 'claude']) satisfies z.ZodType<TAgentPanelType>;

export type TSessionRelationship = 'root' | 'child' | 'fork' | 'subagent' | 'unknown';
export type TSessionCatalogHealth = 'ready' | 'building' | 'degraded' | 'disabled';

export interface ISessionCatalogEntry {
  sessionId: string;
  provider: TAgentPanelType;
  projectLabel: string;
  model?: string;
  startedAt: string;
  lastActivityAt: string;
  turnCount: number;
  indexedAt: string;
  parentSessionId?: string;
  rootSessionId?: string;
  relationship?: TSessionRelationship;
}

export const sessionCatalogEntrySchema: z.ZodType<ISessionCatalogEntry> = z.object({
  sessionId: sessionIdSchema,
  provider: providerSchema,
  projectLabel: z.string().trim().min(1).max(160),
  model: z.string().trim().min(1).max(120).optional(),
  startedAt: isoTimestampSchema,
  lastActivityAt: isoTimestampSchema,
  turnCount: z.number().int().nonnegative(),
  indexedAt: isoTimestampSchema,
  parentSessionId: sessionIdSchema.optional(),
  rootSessionId: sessionIdSchema.optional(),
  relationship: z.enum(['root', 'child', 'fork', 'subagent', 'unknown']).optional(),
}).strict();

export interface ISessionSearchQuery {
  query: string;
  providers?: TAgentPanelType[];
  models?: string[];
  projects?: string[];
  tags?: string[];
  pinned?: boolean;
  dateFrom?: string;
  dateTo?: string;
  cursor?: string;
  limit?: number;
}

export const sessionSearchQuerySchema = z.object({
  query: z.string().trim().max(512),
  providers: z.array(providerSchema).max(2).optional(),
  models: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  projects: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
  tags: z.array(sessionTagSchema).max(20).optional(),
  pinned: z.boolean().optional(),
  dateFrom: isoTimestampSchema.optional(),
  dateTo: isoTimestampSchema.optional(),
  cursor: cursorSchema.optional(),
  limit: z.number().int().min(1).max(200).optional(),
}).strict() satisfies z.ZodType<ISessionSearchQuery>;

export type TSessionAnnotationSelection =
  | { mode: 'include'; sessionIds: string[] }
  | { mode: 'exclude'; sessionIds: string[] };

const sessionAnnotationSelectionIdsSchema = z.array(sessionIdSchema)
  .max(SESSION_ANNOTATION_SELECTION_MAX_IDS)
  .refine((sessionIds) => new Set(sessionIds).size === sessionIds.length, {
    message: 'Session annotation selection IDs must be unique.',
  });

export const sessionAnnotationSelectionSchema: z.ZodType<TSessionAnnotationSelection> = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('include'), sessionIds: sessionAnnotationSelectionIdsSchema }).strict(),
  z.object({ mode: z.literal('exclude'), sessionIds: sessionAnnotationSelectionIdsSchema }).strict(),
]);

export interface ISessionCatalogSearchInput extends ISessionSearchQuery {
  annotationSelection?: TSessionAnnotationSelection;
}

export const sessionCatalogSearchInputSchema: z.ZodType<ISessionCatalogSearchInput> = sessionSearchQuerySchema
  .extend({ annotationSelection: sessionAnnotationSelectionSchema.optional() })
  .strict();

export interface ISessionSearchResult {
  entry: ISessionCatalogEntry;
  snippet: string;
  annotation?: ISessionAnnotation;
}

export interface ISessionSearchPage {
  results: ISessionSearchResult[];
  nextCursor: string | null;
  total: number;
  health: TSessionCatalogHealth;
}

export const sessionSearchPageSchema: z.ZodType<ISessionSearchPage> = z.object({
  results: z.array(z.object({
    entry: sessionCatalogEntrySchema,
    snippet: z.string().max(512),
    annotation: z.lazy(() => sessionAnnotationSchema).optional(),
  }).strict()).max(200),
  nextCursor: cursorSchema.nullable(),
  total: z.number().int().nonnegative(),
  health: z.enum(['ready', 'building', 'degraded', 'disabled']),
}).strict();

export interface ISessionAnnotation {
  sessionId: string;
  pinned: boolean;
  tags: string[];
  version: number;
  updatedAt: string;
}

export const sessionAnnotationSchema: z.ZodType<ISessionAnnotation> = z.object({
  sessionId: sessionIdSchema,
  pinned: z.boolean(),
  tags: z.array(sessionTagSchema).max(20),
  version: z.number().int().positive(),
  updatedAt: isoTimestampSchema,
}).strict();

export interface ISavedSessionFilter {
  id: string;
  name: string;
  query: ISessionSearchQuery;
  createdAt: string;
  updatedAt: string;
}

export const savedSessionFilterSchema: z.ZodType<ISavedSessionFilter> = z.object({
  id: z.string().regex(catalogIdPattern),
  name: z.string().trim().min(1).max(80),
  query: sessionSearchQuerySchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
}).strict();

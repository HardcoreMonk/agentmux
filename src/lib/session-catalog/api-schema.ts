import { z } from 'zod';
import { parseAgentPanelTypeList } from '@/lib/panel-type';
import {
  sessionIdSchema,
  sessionSearchQuerySchema,
  sessionTagSchema,
  type ISessionSearchQuery,
} from '@/lib/session-catalog/contracts';

const stringListSchema = (maxItems: number, maxLength: number) => z.union([
  z.string().trim().min(1).max(maxLength).transform((value) => [value]),
  z.array(z.string().trim().min(1).max(maxLength)).min(1).max(maxItems),
]);

export const sessionSearchApiQuerySchema = z.object({
  query: z.string().max(512).default(''),
  models: stringListSchema(20, 120).optional(),
  projects: stringListSchema(50, 160).optional(),
  tags: z.union([
    sessionTagSchema.transform((value) => [value]),
    z.array(sessionTagSchema).min(1).max(20),
  ]).optional(),
  // Comma-separated agent providers (e.g. `codex,claude`); unknown values are dropped.
  providers: z.union([z.string().max(80), z.array(z.string().max(80)).max(4)])
    .transform((value) => parseAgentPanelTypeList(value))
    .optional(),
  pinned: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.string().regex(/^\d{1,3}$/).transform(Number).optional(),
}).strict().transform((value) => sessionSearchQuerySchema.parse(value));

export const parseSessionSearchApiQuery = (value: unknown): ISessionSearchQuery =>
  sessionSearchApiQuerySchema.parse(value);

export const sessionEntriesApiQuerySchema = z.object({
  sessionId: sessionIdSchema,
  beforeByte: z.string().regex(/^\d{1,16}$/).transform(Number).default(Number.MAX_SAFE_INTEGER),
  limit: z.string().regex(/^\d{1,3}$/).transform(Number).pipe(z.number().int().min(1).max(200)).default(100),
}).strict().refine((value) => Number.isSafeInteger(value.beforeByte), { message: 'beforeByte must be a safe integer' });

export const sessionAnnotationApiQuerySchema = z.object({ sessionId: sessionIdSchema }).strict();

export const updateSessionAnnotationApiBodySchema = z.object({
  pinned: z.boolean(),
  tags: z.array(sessionTagSchema).max(20),
  expectedVersion: z.number().int().nonnegative(),
}).strict();

export const savedSessionFilterApiBodySchema = z.object({
  id: sessionIdSchema,
  name: z.string().trim().min(1).max(80),
  query: sessionSearchQuerySchema,
}).strict();

export const deleteSavedSessionFilterApiQuerySchema = z.object({
  id: sessionIdSchema,
}).strict();

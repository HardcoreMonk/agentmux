import { nanoid } from 'nanoid';
import { z } from 'zod';
import { AGENT_PANEL_TYPES, PANEL_TYPES } from '@/lib/panel-type';
import { runtimeSessionNameSchema } from '@/lib/runtime/session-name';
import {
  sessionIdSchema,
  sessionAnnotationSelectionSchema,
  sessionCatalogSearchInputSchema,
  savedSessionFilterSchema,
  sessionAnnotationSchema,
  sessionSearchPageSchema,
  sessionTagSchema,
} from '@/lib/session-catalog/contracts';
import {
  applyManagedProjectImportSchema,
  approvedProjectRootSnapshotSchema,
  approvedProjectRootSchema,
  governanceAuditCandidateSchema,
  governanceAuditEventSchema,
  governanceRefreshResultSchema,
  governanceWorkerHealthSchema,
  managedProjectImportCountsSchema,
  managedProjectSchema,
  managedProjectSnapshotSchema,
  projectDocumentDetailSchema,
  projectDocumentRefSchema,
  projectGovernanceSummarySchema,
  projectIdSchema,
  projectLifecycleSnapshotSchema,
  registerApprovedProjectRootSchema,
  registerManagedProjectSchema,
  relativeDocumentPathSchema,
} from '@/lib/governance/contracts';
import {
  governanceRollbackPreviewSchema,
  scaffoldActionSummarySchema,
  scaffoldPreviewInputSchema,
  scaffoldPreviewSchema,
  scaffoldPreviewTokenSchema,
  scaffoldFingerprintSchema,
} from '@/lib/governance/scaffold-contracts';

const RUNTIME_TERMINAL_MAX_COLS = 500;
const RUNTIME_TERMINAL_MAX_ROWS = 200;
const emptyPayloadSchema = z.object({}).strict();
const governanceProjectPayloadSchema = z.object({ projectId: projectIdSchema }).strict();
const governanceDocumentPayloadSchema = z.object({
  projectId: projectIdSchema,
  path: relativeDocumentPathSchema,
}).strict();
const governanceRefreshPayloadSchema = z.object({
  projects: z.array(managedProjectSnapshotSchema).max(2000),
  roots: z.array(approvedProjectRootSnapshotSchema).max(200).default([]),
}).strict();
const governanceConfirmScaffoldPayloadSchema = z.object({
  projectId: projectIdSchema,
  token: scaffoldPreviewTokenSchema,
  digest: scaffoldFingerprintSchema,
  confirmation: z.string().trim().min(1).max(160),
}).strict();
const governanceActionPayloadSchema = z.object({
  projectId: projectIdSchema,
  actionId: projectIdSchema,
}).strict();
const governanceConfirmRollbackPayloadSchema = governanceActionPayloadSchema.extend({
  token: scaffoldPreviewTokenSchema,
  digest: scaffoldFingerprintSchema,
  confirmation: z.string().trim().min(1).max(160),
}).strict();
const runtimeHealthReplySchema = z.object({ ok: z.boolean() }).passthrough();
const timelineEntrySchema = z.object({
  id: z.string(),
  type: z.string(),
  timestamp: z.number(),
}).passthrough();
const timelineSessionRelationshipSchema = z.object({
  providerId: z.string(),
  sourceSessionId: z.string(),
  parentSessionId: z.string().nullable(),
  rootSessionId: z.string(),
  relationshipType: z.enum(['root', 'fork', 'sub-agent', 'resume', 'unknown']),
  relationshipConfidence: z.enum(['high', 'medium', 'low']),
});
const timelineSessionMetaSchema = z.object({
  sessionId: z.string(),
  startedAt: z.string(),
  lastActivityAt: z.string(),
  firstMessage: z.string(),
  turnCount: z.number(),
  jsonlPath: z.string().optional(),
  cwd: z.string().nullable().optional(),
  relationship: timelineSessionRelationshipSchema.optional(),
  providerId: z.enum(AGENT_PANEL_TYPES).optional(),
});
const timelineSessionPageSchema = z.object({
  sessions: z.array(timelineSessionMetaSchema),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  refreshing: z.boolean().optional(),
});
const timelineMessageCountsSchema = z.object({
  userCount: z.number().int().nonnegative(),
  assistantCount: z.number().int().nonnegative(),
  toolCount: z.number().int().nonnegative(),
  toolBreakdown: z.record(z.string(), z.number().int().nonnegative()),
});
const timelineEntriesBeforeSchema = z.object({
  entries: z.array(timelineEntrySchema),
  startByteOffset: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
const timelineInitMetaSchema = z.object({
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  lastTimestamp: z.number(),
  fileSize: z.number().int().nonnegative(),
  userCount: z.number().int().nonnegative(),
  assistantCount: z.number().int().nonnegative(),
  customTitle: z.string().optional(),
});
const timelineLiveInitSchema = z.object({
  type: z.literal('timeline:init'),
  entries: z.array(timelineEntrySchema),
  sessionId: z.string(),
  totalEntries: z.number().int().nonnegative(),
  startByteOffset: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  jsonlPath: z.string().nullable().optional(),
  summary: z.string().optional(),
  meta: timelineInitMetaSchema.optional(),
}).passthrough();
const timelineLiveSubscribeResultSchema = z.object({
  subscriberId: z.string().min(1),
  subscribed: z.boolean(),
  init: timelineLiveInitSchema,
});
const timelineLiveUnsubscribeResultSchema = z.object({
  subscriberId: z.string().min(1),
  unsubscribed: z.boolean(),
});
const cliStateSchema = z.union([
  z.literal('idle'),
  z.literal('busy'),
  z.literal('inactive'),
  z.literal('ready-for-review'),
  z.literal('needs-input'),
  z.literal('cancelled'),
  z.literal('unknown'),
]);
const timelineSessionDetectionStatusSchema = z.union([
  z.literal('unknown'),
  z.literal('starting'),
  z.literal('running'),
  z.literal('not-running'),
  z.literal('not-initialized'),
  z.literal('not-installed'),
]);
const timelineSessionInfoSchema = z.object({
  status: timelineSessionDetectionStatusSchema,
  sessionId: z.string().nullable(),
  jsonlPath: z.string().nullable(),
  pid: z.number().int().nullable(),
  startedAt: z.number().nullable(),
  cwd: z.string().nullable(),
}).strict();
const statusEventNameSchema = z.union([
  z.literal('session-start'),
  z.literal('prompt-submit'),
  z.literal('notification'),
  z.literal('stop'),
  z.literal('interrupt'),
]);
const panelTypeSchema = z.enum(PANEL_TYPES).optional().catch(undefined);
const statusTerminalStatusSchema = z.union([
  z.literal('idle'),
  z.literal('running'),
  z.literal('server'),
]);
const statusLastEventSchema = z.object({
  name: statusEventNameSchema,
  at: z.number(),
  seq: z.number().int().nonnegative(),
}).strict();
const statusCurrentActionSchema = z.object({
  toolName: z.string().nullable(),
  summary: z.string(),
}).strict();
const approvalPromptMetadataSchema = z.object({
  promptType: z.union([
    z.literal('command'),
    z.literal('file'),
    z.literal('permission'),
    z.literal('resume-directory'),
    z.literal('conversation'),
    z.literal('unknown'),
  ]),
  approvalKind: z.union([
    z.literal('allow'),
    z.literal('deny'),
    z.literal('trust'),
    z.literal('directory'),
    z.literal('input'),
    z.literal('unknown'),
  ]),
  riskLevel: z.union([
    z.literal('low'),
    z.literal('medium'),
    z.literal('high'),
    z.literal('unknown'),
  ]),
  commandPreview: z.string().nullable(),
  fileHints: z.array(z.string()),
  fallbackReason: z.null(),
}).strict();
const statusHookDecisionSchema = z.object({
  nextState: cliStateSchema,
  changed: z.boolean(),
  silent: z.boolean().optional(),
  skipHistory: z.boolean().optional(),
  deferStopHook: z.boolean(),
});
const statusDecisionSchema = z.object({
  nextState: cliStateSchema,
  changed: z.boolean(),
  silent: z.boolean().optional(),
  skipHistory: z.boolean().optional(),
});
const statusNotificationPolicySchema = z.object({
  processHookEvent: z.boolean(),
  sendReviewNotification: z.boolean(),
  sendNeedsInputNotification: z.boolean(),
});
const runtimeWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  defaultCwd: z.string(),
  active: z.union([z.boolean(), z.number()]),
  groupId: z.string().nullable().optional(),
  orderIndex: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const runtimeCreateWorkspaceResultSchema = z.object({
  id: z.string(),
  rootPaneId: z.string(),
});
const runtimePendingTerminalTabSchema = z.object({
  id: z.string(),
  sessionName: runtimeSessionNameSchema,
  workspaceId: z.string(),
  paneId: z.string(),
  cwd: z.string(),
  runtimeVersion: z.literal(2),
  lifecycleState: z.literal('pending_terminal'),
  createdAt: z.string(),
});
const runtimeTerminalTabSchema = z.object({
  id: z.string(),
  sessionName: runtimeSessionNameSchema,
  name: z.string(),
  order: z.number(),
  cwd: z.string().optional(),
  panelType: z.literal('terminal'),
  runtimeVersion: z.literal(2),
  lifecycleState: z.union([z.literal('pending_terminal'), z.literal('ready'), z.literal('failed')]),
});
const runtimeTerminalSessionSchema = z.object({
  sessionName: runtimeSessionNameSchema,
});
const rawTerminalSessionSchema = z.object({
  sessionName: z.string(),
});
const runtimeDeleteWorkspaceStorageResultSchema = z.object({
  deleted: z.boolean(),
  sessions: z.array(rawTerminalSessionSchema),
});
const runtimeDeleteTerminalTabStorageResultSchema = z.object({
  deleted: z.boolean(),
  session: rawTerminalSessionSchema.nullable(),
});
const runtimeLayoutTabSchema = z.object({
  id: z.string(),
  sessionName: z.string().min(1),
  name: z.string(),
  order: z.number(),
  title: z.string().optional(),
  cwd: z.string().optional(),
  runtimeVersion: z.union([z.literal(1), z.literal(2)]),
  panelType: panelTypeSchema.optional(),
  agentSessionId: z.string().nullable().optional(),
  agentJsonlPath: z.string().nullable().optional(),
  agentSummary: z.string().nullable().optional(),
  lastUserMessage: z.string().nullable().optional(),
  lastCommand: z.string().nullable().optional(),
  cliState: cliStateSchema.optional(),
  dismissedAt: z.number().nullable().optional(),
  webUrl: z.string().nullable().optional(),
  terminalRatio: z.number().optional(),
  terminalCollapsed: z.boolean().optional(),
});

type TRuntimeLayoutNode = {
  type: 'pane' | 'split';
  id?: string;
  tabs?: unknown[];
  activeTabId?: string | null;
  orientation?: 'horizontal' | 'vertical';
  ratio?: number;
  children?: unknown[];
};

const runtimeLayoutNodeSchema: z.ZodType<TRuntimeLayoutNode> = z.lazy(() => z.discriminatedUnion('type', [
  z.object({
    type: z.literal('pane'),
    id: z.string(),
    tabs: z.array(runtimeLayoutTabSchema),
    activeTabId: z.string().nullable(),
  }),
  z.object({
    type: z.literal('split'),
    orientation: z.union([z.literal('horizontal'), z.literal('vertical')]),
    ratio: z.number(),
    children: z.tuple([runtimeLayoutNodeSchema, runtimeLayoutNodeSchema]),
  }),
]));
const runtimeLayoutSchema = z.object({
  root: runtimeLayoutNodeSchema,
  activePaneId: z.string().nullable(),
  updatedAt: z.string(),
}).nullable();
const workspaceIdPayloadSchema = z.object({ workspaceId: z.string().min(1) });
const terminalTabIdPayloadSchema = z.object({ id: z.string().min(1) });
const createWorkspacePayloadSchema = z.object({
  name: z.string().min(1),
  defaultCwd: z.string().min(1),
});
const ensureWorkspacePanePayloadSchema = z.object({
  workspaceId: z.string().min(1),
  paneId: z.string().min(1),
  name: z.string().min(1),
  defaultCwd: z.string().min(1),
});
const createPendingTerminalTabPayloadSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  paneId: z.string().min(1),
  sessionName: runtimeSessionNameSchema,
  cwd: z.string().min(1),
});
const tabIdPayloadSchema = z.object({ id: z.string().min(1) });
const failPendingTerminalTabPayloadSchema = z.object({
  id: z.string().min(1),
  reason: z.string().min(1),
});
const failReadyTerminalTabPayloadSchema = z.object({
  id: z.string().min(1),
  reason: z.string().min(1),
});
const terminalCreatePayloadSchema = z.object({
  sessionName: runtimeSessionNameSchema,
  cols: z.number().int().min(1).max(RUNTIME_TERMINAL_MAX_COLS),
  rows: z.number().int().min(1).max(RUNTIME_TERMINAL_MAX_ROWS),
  cwd: z.string().optional(),
});
const terminalResizePayloadSchema = z.object({
  sessionName: runtimeSessionNameSchema,
  cols: z.number().int().min(1).max(RUNTIME_TERMINAL_MAX_COLS),
  rows: z.number().int().min(1).max(RUNTIME_TERMINAL_MAX_ROWS),
});
const terminalWritePayloadSchema = z.object({
  sessionName: runtimeSessionNameSchema,
  data: z.string(),
});
const terminalStdoutEventPayloadSchema = z.object({
  sessionName: runtimeSessionNameSchema,
  data: z.string(),
});
const terminalBackpressureEventPayloadSchema = z.object({
  sessionName: runtimeSessionNameSchema,
  pendingBytes: z.number().int().nonnegative(),
  maxPendingStdoutBytes: z.number().int().positive(),
});
const timelineListSessionsPayloadSchema = z.object({
  tmuxSession: z.string().min(1),
  cwd: z.string().optional(),
  panelType: z.string().min(1),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(200),
  providers: z.array(z.enum(AGENT_PANEL_TYPES)).optional(),
}).strict();
const timelineReadEntriesBeforePayloadSchema = z.object({
  jsonlPath: z.string().min(1),
  beforeByte: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(200),
  panelType: z.string().min(1),
});
const timelineCatalogHealthSchema = z.object({
  state: z.enum(['ready', 'building', 'degraded', 'disabled']),
  queueLag: z.number().int().nonnegative(),
  cursorAgeMs: z.number().int().nonnegative().nullable(),
  rebuildState: z.enum(['idle', 'building', 'cancelling']),
  indexedSessions: z.number().int().nonnegative(),
  lastIndexedAt: z.iso.datetime().nullable(),
}).strict();
const timelineCatalogReadEntriesPayloadSchema = z.object({
  sessionId: sessionIdSchema,
  beforeByte: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(200),
  // Ignored: the catalog replays with the provider stored on the entry.
  panelType: z.string().min(1).max(80).optional(),
}).strict();
const timelineCatalogRebuildResultSchema = z.object({
  started: z.boolean(),
  state: z.enum(['building', 'already-building', 'disabled']),
}).strict();
const storageListSessionAnnotationsPayloadSchema = z.object({
  sessionIds: z.array(sessionIdSchema).max(200),
}).strict();
const storageSelectSessionAnnotationsPayloadSchema = z.object({
  pinned: z.boolean().optional(),
  tags: z.array(sessionTagSchema).min(1).max(20).optional(),
}).strict().refine((input) => input.pinned !== undefined || Boolean(input.tags?.length), {
  message: 'At least one annotation predicate is required.',
});
const storageUpdateSessionAnnotationPayloadSchema = z.object({
  sessionId: sessionIdSchema,
  pinned: z.boolean(),
  tags: z.array(sessionTagSchema).max(20),
  expectedVersion: z.number().int().nonnegative(),
  sessionExists: z.boolean(),
}).strict();
const storageDeleteSavedSessionFilterPayloadSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/),
}).strict();
const storageListGovernanceAuditPayloadSchema = z.object({
  projectId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/).optional(),
  limit: z.number().int().min(1).max(200),
}).strict();
const timelineMessageCountsPayloadSchema = z.object({
  jsonlPath: z.string().min(1),
});
const timelineLiveSubscribePayloadSchema = z.object({
  subscriberId: z.string().min(1),
  jsonlPath: z.string().min(1),
  sessionName: z.string().min(1),
  sessionId: z.string().optional(),
  panelType: z.string().min(1),
}).strict();
const timelineLiveUnsubscribePayloadSchema = z.object({
  subscriberId: z.string().min(1),
}).strict();
const timelineSessionWatchSubscribePayloadSchema = z.object({
  subscriberId: z.string().min(1),
  sessionName: z.string().min(1),
  panePid: z.number().int().positive(),
  panelType: z.string().min(1),
  skipInitial: z.boolean().optional(),
}).strict();
const timelineSessionWatchUnsubscribePayloadSchema = z.object({
  subscriberId: z.string().min(1),
}).strict();
const timelineSessionWatchSubscribeResultSchema = z.object({
  subscriberId: z.string().min(1),
  subscribed: z.boolean(),
});
const timelineSessionWatchUnsubscribeResultSchema = z.object({
  subscriberId: z.string().min(1),
  unsubscribed: z.boolean(),
});
const timelineLiveAppendEventPayloadSchema = z.object({
  subscriberId: z.string().min(1),
  jsonlPath: z.string().min(1),
  entries: z.array(timelineEntrySchema),
});
const timelineLiveErrorEventPayloadSchema = z.object({
  subscriberId: z.string().min(1).optional(),
  jsonlPath: z.string().min(1).optional(),
  code: z.string().min(1),
  message: z.string().min(1),
});
const timelineSessionChangedEventPayloadSchema = z.object({
  subscriberId: z.string().min(1),
  sessionName: z.string().min(1),
  info: timelineSessionInfoSchema,
});
const agentProviderStatusBehaviorSchema = z.object({
  watchJsonlWhenBound: z.boolean(),
  deferStopHookUntilJsonlIdle: z.boolean(),
}).strip();
const statusReduceHookStatePayloadSchema = z.object({
  currentState: cliStateSchema,
  eventName: statusEventNameSchema,
  providerId: z.string().nullable().optional(),
  statusBehavior: agentProviderStatusBehaviorSchema.nullable().optional(),
});
const statusReduceCodexStatePayloadSchema = z.object({
  currentState: cliStateSchema,
  running: z.boolean(),
  hasJsonlPath: z.boolean(),
  idle: z.boolean(),
  hasCompletionSnippet: z.boolean(),
});
const statusEvaluateNotificationPolicyPayloadSchema = z.object({
  eventName: statusEventNameSchema,
  notificationType: z.string().optional(),
  newState: cliStateSchema,
  silent: z.boolean().optional(),
});
const statusSideEffectPolicyPayloadSchema = z.object({
  previousState: cliStateSchema,
  newState: cliStateSchema,
  silent: z.boolean().optional(),
  skipHistory: z.boolean().optional(),
  hasJsonlPath: z.boolean(),
  providerId: z.string().nullable().optional(),
  statusBehavior: agentProviderStatusBehaviorSchema.nullable().optional(),
  hasJsonlWatcher: z.boolean(),
  sessionHistoryDedupeAccepted: z.boolean(),
  reviewNotificationDedupeAccepted: z.boolean(),
}).strict();
const statusSideEffectIntentSchema = z.object({
  clearDismissedAt: z.boolean(),
  setReadyForReviewAt: z.boolean(),
  setBusySince: z.boolean(),
  saveSessionHistory: z.boolean(),
  sendReviewNotification: z.boolean(),
  sendNeedsInputNotification: z.boolean(),
  startJsonlWatch: z.boolean(),
  stopJsonlWatch: z.boolean(),
});
const statusClientEventTypeSchema = z.union([
  z.literal('dismiss-tab'),
  z.literal('ack-notification'),
]);
const statusClientEventPayloadSchema = z.object({
  eventType: statusClientEventTypeSchema,
  currentState: cliStateSchema,
  lastEventName: statusEventNameSchema.nullable().optional(),
  lastEventSeq: z.number().int().nonnegative().nullable().optional(),
  clientSeq: z.number().int().nonnegative().nullable().optional(),
}).strict();
const statusClientEventIntentSchema = z.object({
  accepted: z.boolean(),
  nextState: cliStateSchema.nullable(),
  setDismissedAt: z.boolean(),
  persistLayout: z.boolean(),
  broadcastUpdate: z.boolean(),
  updateSessionHistoryDismissedAt: z.boolean(),
});
const sessionHistoryEntrySchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  workspaceName: z.string(),
  workspaceDir: z.string().nullable(),
  tabId: z.string().min(1),
  agentSessionId: z.string().nullable(),
  prompt: z.string().nullable(),
  result: z.string().nullable(),
  startedAt: z.number(),
  completedAt: z.number(),
  duration: z.number(),
  dismissedAt: z.number().nullable(),
  toolUsage: z.record(z.string(), z.number().int().nonnegative()),
  touchedFiles: z.array(z.string()),
  cancelled: z.boolean().optional(),
}).strict();
const statusAddSessionHistoryEntryPayloadSchema = z.object({
  entry: sessionHistoryEntrySchema,
}).strict();
const statusAddSessionHistoryEntryResultSchema = z.object({
  added: z.boolean(),
  entry: sessionHistoryEntrySchema,
});
const statusUpdateSessionHistoryDismissedAtPayloadSchema = z.object({
  tabId: z.string().min(1),
  dismissedAt: z.number(),
}).strict();
const statusUpdateSessionHistoryDismissedAtResultSchema = z.object({
  updated: z.boolean(),
  entry: sessionHistoryEntrySchema.nullable(),
});
const statusWebPushPayloadSchema = z.object({
  title: z.string(),
  body: z.string(),
  silent: z.boolean(),
  tabId: z.string().min(1),
  workspaceId: z.string().min(1),
  agentSessionId: z.string().nullable(),
  workspaceName: z.string(),
  workspaceDir: z.string().nullable(),
  approvalKind: z.string().optional(),
  promptType: z.string().optional(),
  riskLevel: z.string().optional(),
  approvalDetail: z.string().nullable().optional(),
}).strict();
const statusSendWebPushPayloadSchema = z.object({
  anyDeviceVisible: z.boolean(),
  payload: statusWebPushPayloadSchema,
}).strict();
const statusSendWebPushResultSchema = z.object({
  skippedVisible: z.boolean(),
  attempted: z.number().int().nonnegative(),
  sent: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
const statusClientTabStatusEntrySchema = z.object({
  cliState: cliStateSchema,
  workspaceId: z.string().min(1),
  tabName: z.string(),
  currentProcess: z.string().optional(),
  paneTitle: z.string().optional(),
  panelType: panelTypeSchema.optional(),
  terminalStatus: statusTerminalStatusSchema.optional(),
  listeningPorts: z.array(z.number().int().nonnegative()).optional(),
  agentSummary: z.string().nullable().optional(),
  lastUserMessage: z.string().nullable().optional(),
  lastAssistantMessage: z.string().nullable().optional(),
  currentAction: statusCurrentActionSchema.nullable().optional(),
  readyForReviewAt: z.number().nullable().optional(),
  busySince: z.number().nullable().optional(),
  dismissedAt: z.number().nullable().optional(),
  agentSessionId: z.string().nullable().optional(),
  compactingSince: z.number().nullable().optional(),
  lastEvent: statusLastEventSchema.nullable().optional(),
  eventSeq: z.number().int().nonnegative().optional(),
  approvalPromptMetadata: approvalPromptMetadataSchema.nullable().optional(),
}).strict();
const statusLiveTabStatusEntrySchema = statusClientTabStatusEntrySchema.extend({
  tmuxSession: z.string().min(1),
  jsonlPath: z.string().nullable().optional(),
  processRetries: z.number().int().nonnegative().optional(),
}).strict();
const statusRateLimitWindowSchema = z.object({
  used_percentage: z.number(),
  resets_at: z.number(),
  observed_at: z.number().optional(),
}).strict();
const statusRateLimitsDataSchema = z.object({
  ts: z.number(),
  five_hour: statusRateLimitWindowSchema.nullable(),
  seven_day: statusRateLimitWindowSchema.nullable(),
}).strict();
const statusRateLimitsProviderSchema = z.enum(AGENT_PANEL_TYPES);
const statusLiveSyncPayloadSchema = z.object({
  tabs: z.record(z.string(), statusClientTabStatusEntrySchema),
  rateLimits: z.partialRecord(statusRateLimitsProviderSchema, statusRateLimitsDataSchema),
}).strict();
const statusLiveUpdatePayloadSchema = statusClientTabStatusEntrySchema
  .omit({ cliState: true, workspaceId: true, tabName: true })
  .extend({
    tabId: z.string().min(1),
    cliState: cliStateSchema.nullable(),
    workspaceId: z.string(),
    tabName: z.string(),
  })
  .strict();
const statusSessionHistoryUpdateEventPayloadSchema = z.object({
  entry: sessionHistoryEntrySchema,
}).strict();
const statusHookEventPayloadSchema = z.object({
  tabId: z.string().min(1),
  sessionName: z.string().min(1),
  event: statusLastEventSchema,
}).strict();
const statusErrorEventPayloadSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
}).strict();
const statusRateLimitsEventPayloadSchema = z.object({
  providerId: statusRateLimitsProviderSchema,
  data: statusRateLimitsDataSchema,
}).strict();
const statusLiveStartResultSchema = z.object({
  started: z.boolean(),
}).strict();
const statusLiveStopResultSchema = z.object({
  stopped: z.boolean(),
}).strict();
const statusLiveHookEventPayloadSchema = z.object({
  tmuxSession: z.string().min(1),
  event: z.string().min(1),
  notificationType: z.string().optional(),
  agentSessionId: z.string().optional(),
  transcriptPath: z.string().optional(),
  source: z.string().optional(),
}).strict();
const statusLiveClientEventPayloadSchema = z.object({
  eventType: statusClientEventTypeSchema,
  tabId: z.string().min(1),
  seq: z.number().int().nonnegative().optional(),
}).strict();
const statusLiveNotifyLastUserMessagePayloadSchema = z.object({
  sessionName: z.string().min(1),
  message: z.string(),
}).strict();
const statusLiveRemoveTabPayloadSchema = z.object({
  tabId: z.string().min(1),
}).strict();
const statusLiveRegisterTabPayloadSchema = z.object({
  tabId: z.string().min(1),
  entry: statusLiveTabStatusEntrySchema,
}).strict();
const statusLiveDeviceVisibilityPayloadSchema = z.object({
  deviceId: z.string().min(1),
  visible: z.boolean(),
}).strict();
const statusLiveAcceptedResultSchema = z.object({
  accepted: z.boolean(),
}).strict();
const statusLivePollResultSchema = z.object({
  polled: z.boolean(),
}).strict();

export const runtimeCommandRegistry = {
  'storage.health': { payload: emptyPayloadSchema, reply: runtimeHealthReplySchema },
  'storage.create-workspace': { payload: createWorkspacePayloadSchema, reply: runtimeCreateWorkspaceResultSchema },
  'storage.ensure-workspace-pane': {
    payload: ensureWorkspacePanePayloadSchema,
    reply: ensureWorkspacePanePayloadSchema.pick({ workspaceId: true, paneId: true }),
  },
  'storage.create-pending-terminal-tab': { payload: createPendingTerminalTabPayloadSchema, reply: runtimePendingTerminalTabSchema },
  'storage.finalize-terminal-tab': { payload: tabIdPayloadSchema, reply: runtimeTerminalTabSchema },
  'storage.fail-pending-terminal-tab': { payload: failPendingTerminalTabPayloadSchema, reply: z.object({ ok: z.boolean() }) },
  'storage.list-pending-terminal-tabs': { payload: emptyPayloadSchema, reply: z.array(runtimePendingTerminalTabSchema) },
  'storage.list-ready-terminal-tabs': { payload: emptyPayloadSchema, reply: z.array(runtimeTerminalTabSchema) },
  'storage.fail-ready-terminal-tab': { payload: failReadyTerminalTabPayloadSchema, reply: z.object({ ok: z.boolean() }) },
  'storage.get-ready-terminal-tab-by-session': { payload: runtimeTerminalSessionSchema, reply: runtimeTerminalTabSchema.nullable() },
  'storage.delete-workspace': { payload: workspaceIdPayloadSchema, reply: runtimeDeleteWorkspaceStorageResultSchema },
  'storage.delete-terminal-tab': { payload: terminalTabIdPayloadSchema, reply: runtimeDeleteTerminalTabStorageResultSchema },
  'storage.list-workspaces': { payload: emptyPayloadSchema, reply: z.array(runtimeWorkspaceSchema) },
  'storage.get-layout': { payload: workspaceIdPayloadSchema, reply: runtimeLayoutSchema },
  'storage.list-session-annotations': {
    payload: storageListSessionAnnotationsPayloadSchema,
    reply: z.array(sessionAnnotationSchema).max(200),
  },
  'storage.select-session-annotations': {
    payload: storageSelectSessionAnnotationsPayloadSchema,
    reply: sessionAnnotationSelectionSchema,
  },
  'storage.update-session-annotation': {
    payload: storageUpdateSessionAnnotationPayloadSchema,
    reply: sessionAnnotationSchema,
  },
  'storage.list-saved-session-filters': { payload: emptyPayloadSchema, reply: z.array(savedSessionFilterSchema).max(200) },
  'storage.upsert-saved-session-filter': { payload: savedSessionFilterSchema, reply: savedSessionFilterSchema },
  'storage.delete-saved-session-filter': {
    payload: storageDeleteSavedSessionFilterPayloadSchema,
    reply: z.object({ deleted: z.boolean() }).strict(),
  },
  'storage.register-approved-project-root': {
    payload: registerApprovedProjectRootSchema,
    reply: approvedProjectRootSchema,
  },
  'storage.list-approved-project-roots': { payload: emptyPayloadSchema, reply: z.array(approvedProjectRootSchema).max(200) },
  'storage.list-approved-project-root-snapshots': {
    payload: emptyPayloadSchema,
    reply: z.array(registerApprovedProjectRootSchema).max(200),
  },
  'storage.register-managed-project': { payload: registerManagedProjectSchema, reply: managedProjectSchema },
  'storage.list-managed-projects': { payload: emptyPayloadSchema, reply: z.array(managedProjectSchema).max(2000) },
  'storage.list-managed-project-snapshots': {
    payload: emptyPayloadSchema,
    reply: z.array(managedProjectSnapshotSchema).max(2000),
  },
  'storage.apply-managed-project-import': {
    payload: applyManagedProjectImportSchema,
    reply: z.object({ counts: managedProjectImportCountsSchema }).strict(),
  },
  'storage.list-governance-audit-events': {
    payload: storageListGovernanceAuditPayloadSchema,
    reply: z.array(governanceAuditEventSchema).max(200),
  },
  'governance.health': { payload: emptyPayloadSchema, reply: governanceWorkerHealthSchema },
  'governance.refresh-projects': { payload: governanceRefreshPayloadSchema, reply: governanceRefreshResultSchema },
  'governance.get-project-summary': {
    payload: governanceProjectPayloadSchema,
    reply: projectGovernanceSummarySchema,
  },
  'governance.list-project-documents': {
    payload: governanceProjectPayloadSchema,
    reply: z.array(projectDocumentRefSchema).max(2000),
  },
  'governance.get-project-lifecycle': {
    payload: governanceProjectPayloadSchema,
    reply: projectLifecycleSnapshotSchema,
  },
  'governance.list-project-audit': {
    payload: governanceProjectPayloadSchema,
    reply: z.array(governanceAuditCandidateSchema).max(2000),
  },
  'governance.read-project-document': {
    payload: governanceDocumentPayloadSchema,
    reply: projectDocumentDetailSchema,
  },
  'governance.preview-scaffold': {
    payload: scaffoldPreviewInputSchema,
    reply: scaffoldPreviewSchema,
  },
  'governance.confirm-scaffold': {
    payload: governanceConfirmScaffoldPayloadSchema,
    reply: scaffoldActionSummarySchema,
  },
  'governance.list-actions': {
    payload: governanceProjectPayloadSchema,
    reply: z.array(scaffoldActionSummarySchema).max(500),
  },
  'governance.preview-action-rollback': {
    payload: governanceActionPayloadSchema,
    reply: governanceRollbackPreviewSchema,
  },
  'governance.confirm-action-rollback': {
    payload: governanceConfirmRollbackPayloadSchema,
    reply: scaffoldActionSummarySchema,
  },
  'terminal.health': { payload: emptyPayloadSchema, reply: runtimeHealthReplySchema },
  'terminal.create-session': { payload: terminalCreatePayloadSchema, reply: runtimeTerminalSessionSchema },
  'terminal.attach': { payload: terminalResizePayloadSchema, reply: runtimeTerminalSessionSchema.extend({ attached: z.boolean() }) },
  'terminal.detach': { payload: runtimeTerminalSessionSchema, reply: runtimeTerminalSessionSchema.extend({ detached: z.boolean() }) },
  'terminal.kill-session': { payload: runtimeTerminalSessionSchema, reply: runtimeTerminalSessionSchema.extend({ killed: z.boolean() }) },
  'terminal.has-session': { payload: runtimeTerminalSessionSchema, reply: runtimeTerminalSessionSchema.extend({ exists: z.boolean() }) },
  'terminal.capture-pane': { payload: runtimeTerminalSessionSchema, reply: runtimeTerminalSessionSchema.extend({ content: z.string() }) },
  'terminal.send-text': {
    payload: runtimeTerminalSessionSchema.extend({ text: z.string(), enter: z.boolean() }),
    reply: runtimeTerminalSessionSchema.extend({ sent: z.boolean() }),
  },
  'terminal.write-stdin': { payload: terminalWritePayloadSchema, reply: z.object({ written: z.number().int().nonnegative() }) },
  'terminal.write-web-stdin': { payload: terminalWritePayloadSchema, reply: z.object({ written: z.number().int().nonnegative() }) },
  'terminal.resize': { payload: terminalResizePayloadSchema, reply: terminalResizePayloadSchema },
  'timeline.health': { payload: emptyPayloadSchema, reply: runtimeHealthReplySchema },
  'timeline.list-sessions': { payload: timelineListSessionsPayloadSchema, reply: timelineSessionPageSchema },
  'timeline.read-entries-before': { payload: timelineReadEntriesBeforePayloadSchema, reply: timelineEntriesBeforeSchema },
  'timeline.message-counts': { payload: timelineMessageCountsPayloadSchema, reply: timelineMessageCountsSchema },
  'timeline.live-subscribe': { payload: timelineLiveSubscribePayloadSchema, reply: timelineLiveSubscribeResultSchema },
  'timeline.live-unsubscribe': { payload: timelineLiveUnsubscribePayloadSchema, reply: timelineLiveUnsubscribeResultSchema },
  'timeline.session-watch-subscribe': { payload: timelineSessionWatchSubscribePayloadSchema, reply: timelineSessionWatchSubscribeResultSchema },
  'timeline.session-watch-unsubscribe': { payload: timelineSessionWatchUnsubscribePayloadSchema, reply: timelineSessionWatchUnsubscribeResultSchema },
  'timeline.catalog-health': { payload: emptyPayloadSchema, reply: timelineCatalogHealthSchema },
  'timeline.catalog-search': { payload: sessionCatalogSearchInputSchema, reply: sessionSearchPageSchema },
  'timeline.catalog-read-entries': { payload: timelineCatalogReadEntriesPayloadSchema, reply: timelineEntriesBeforeSchema },
  'timeline.catalog-rebuild': { payload: emptyPayloadSchema, reply: timelineCatalogRebuildResultSchema },
  'status.health': { payload: emptyPayloadSchema, reply: runtimeHealthReplySchema },
  'status.live-start': { payload: emptyPayloadSchema, reply: statusLiveStartResultSchema },
  'status.live-stop': { payload: emptyPayloadSchema, reply: statusLiveStopResultSchema },
  'status.live-request-sync': { payload: emptyPayloadSchema, reply: statusLiveSyncPayloadSchema },
  'status.live-hook-event': { payload: statusLiveHookEventPayloadSchema, reply: statusLiveAcceptedResultSchema },
  'status.live-client-event': { payload: statusLiveClientEventPayloadSchema, reply: statusLiveAcceptedResultSchema },
  'status.live-notify-last-user-message': { payload: statusLiveNotifyLastUserMessagePayloadSchema, reply: statusLiveAcceptedResultSchema },
  'status.live-register-tab': { payload: statusLiveRegisterTabPayloadSchema, reply: statusLiveAcceptedResultSchema },
  'status.live-device-visibility': { payload: statusLiveDeviceVisibilityPayloadSchema, reply: statusLiveAcceptedResultSchema },
  'status.live-remove-tab': { payload: statusLiveRemoveTabPayloadSchema, reply: statusLiveAcceptedResultSchema },
  'status.live-poll': { payload: emptyPayloadSchema, reply: statusLivePollResultSchema },
  'status.reduce-hook-state': { payload: statusReduceHookStatePayloadSchema, reply: statusHookDecisionSchema },
  'status.reduce-codex-state': { payload: statusReduceCodexStatePayloadSchema, reply: statusDecisionSchema },
  'status.evaluate-notification-policy': { payload: statusEvaluateNotificationPolicyPayloadSchema, reply: statusNotificationPolicySchema },
  'status.evaluate-side-effects': { payload: statusSideEffectPolicyPayloadSchema, reply: statusSideEffectIntentSchema },
  'status.evaluate-client-event': { payload: statusClientEventPayloadSchema, reply: statusClientEventIntentSchema },
  'status.add-session-history-entry': { payload: statusAddSessionHistoryEntryPayloadSchema, reply: statusAddSessionHistoryEntryResultSchema },
  'status.update-session-history-dismissed-at': { payload: statusUpdateSessionHistoryDismissedAtPayloadSchema, reply: statusUpdateSessionHistoryDismissedAtResultSchema },
  'status.send-web-push': { payload: statusSendWebPushPayloadSchema, reply: statusSendWebPushResultSchema },
} as const satisfies Record<string, { payload: z.ZodTypeAny; reply: z.ZodTypeAny }>;

export const runtimeEventRegistry = {
  'terminal.stdout': {
    source: 'terminal',
    target: 'supervisor',
    delivery: 'realtime',
    payload: terminalStdoutEventPayloadSchema,
  },
  'terminal.backpressure': {
    source: 'terminal',
    target: 'supervisor',
    delivery: 'realtime',
    payload: terminalBackpressureEventPayloadSchema,
  },
  'timeline.live-append': {
    source: 'timeline',
    target: 'supervisor',
    delivery: 'realtime',
    payload: timelineLiveAppendEventPayloadSchema,
  },
  'timeline.live-error': {
    source: 'timeline',
    target: 'supervisor',
    delivery: 'realtime',
    payload: timelineLiveErrorEventPayloadSchema,
  },
  'timeline.session-changed': {
    source: 'timeline',
    target: 'supervisor',
    delivery: 'realtime',
    payload: timelineSessionChangedEventPayloadSchema,
  },
  'status.sync': {
    source: 'status',
    target: 'supervisor',
    delivery: 'realtime',
    payload: statusLiveSyncPayloadSchema,
  },
  'status.update': {
    source: 'status',
    target: 'supervisor',
    delivery: 'realtime',
    payload: statusLiveUpdatePayloadSchema,
  },
  'status.session-history-update': {
    source: 'status',
    target: 'supervisor',
    delivery: 'realtime',
    payload: statusSessionHistoryUpdateEventPayloadSchema,
  },
  'status.hook-event': {
    source: 'status',
    target: 'supervisor',
    delivery: 'realtime',
    payload: statusHookEventPayloadSchema,
  },
  'status.error': {
    source: 'status',
    target: 'supervisor',
    delivery: 'realtime',
    payload: statusErrorEventPayloadSchema,
  },
  'status.rate-limits-update': {
    source: 'status',
    target: 'supervisor',
    delivery: 'realtime',
    payload: statusRateLimitsEventPayloadSchema,
  },
} as const satisfies Record<string, {
  source: string;
  target: string;
  delivery: 'realtime' | 'durable';
  payload: z.ZodTypeAny;
}>;

export type TRuntimeCommandType = keyof typeof runtimeCommandRegistry;
export type TRuntimeEventType = keyof typeof runtimeEventRegistry;
export type TRuntimeCommandPayload<TType extends TRuntimeCommandType> = z.infer<(typeof runtimeCommandRegistry)[TType]['payload']>;
export type TRuntimeCommandReplyPayload<TType extends TRuntimeCommandType> = z.infer<(typeof runtimeCommandRegistry)[TType]['reply']>;
export type TRuntimeEventPayload<TType extends TRuntimeEventType> = z.infer<(typeof runtimeEventRegistry)[TType]['payload']>;

const runtimeErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean().optional(),
});

const baseEnvelopeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  type: z.string().min(1),
  sentAt: z.string().min(1),
  payload: z.unknown(),
});

const commandSchema = baseEnvelopeSchema.extend({
  kind: z.literal('command'),
});

const successReplySchema = baseEnvelopeSchema.extend({
  kind: z.literal('reply'),
  commandId: z.string().min(1),
  ok: z.literal(true),
}).strict();

const failedReplySchema = baseEnvelopeSchema.extend({
  kind: z.literal('reply'),
  commandId: z.string().min(1),
  ok: z.literal(false),
  payload: z.null(),
  error: runtimeErrorSchema,
}).strict();

const replySchema = z.discriminatedUnion('ok', [successReplySchema, failedReplySchema]);

const eventSchema = baseEnvelopeSchema.extend({
  kind: z.literal('event'),
  delivery: z.union([z.literal('realtime'), z.literal('durable')]),
});

const messageSchema = z.union([commandSchema, replySchema, eventSchema]);

export const isRuntimeCommandType = (type: string): type is TRuntimeCommandType =>
  type in runtimeCommandRegistry;

export const isRuntimeEventType = (type: string): type is TRuntimeEventType =>
  type in runtimeEventRegistry;

export const parseRuntimeCommandPayload = <TType extends TRuntimeCommandType>(
  type: TType,
  value: unknown,
): TRuntimeCommandPayload<TType> => {
  const parsed = runtimeCommandRegistry[type].payload.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid runtime IPC payload for ${type}: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`);
  }
  return parsed.data as TRuntimeCommandPayload<TType>;
};

export const parseRuntimeReplyPayload = <TType extends TRuntimeCommandType>(
  type: TType,
  value: unknown,
): TRuntimeCommandReplyPayload<TType> => {
  const parsed = runtimeCommandRegistry[type].reply.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid runtime IPC reply for ${type}: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`);
  }
  return parsed.data as TRuntimeCommandReplyPayload<TType>;
};

export const parseRuntimeEventPayload = <TType extends TRuntimeEventType>(
  type: TType,
  value: unknown,
): TRuntimeEventPayload<TType> => {
  const parsed = runtimeEventRegistry[type].payload.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid runtime IPC event for ${type}: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`);
  }
  return parsed.data as TRuntimeEventPayload<TType>;
};

export interface IRuntimeError {
  code: string;
  message: string;
  retryable?: boolean;
}

export interface IRuntimeEnvelope<TPayload = unknown> {
  id: string;
  source: string;
  target: string;
  type: string;
  sentAt: string;
  payload: TPayload;
}

export interface IRuntimeCommand<TPayload = unknown> extends IRuntimeEnvelope<TPayload> {
  kind: 'command';
}

export interface IRuntimeReply<TPayload = unknown> extends IRuntimeEnvelope<TPayload> {
  kind: 'reply';
  commandId: string;
  ok: boolean;
  error?: IRuntimeError;
}

export interface IRuntimeEvent<TPayload = unknown> extends IRuntimeEnvelope<TPayload> {
  kind: 'event';
  delivery: 'realtime' | 'durable';
}

export type TRuntimeMessage<TPayload = unknown> =
  | IRuntimeCommand<TPayload>
  | IRuntimeReply<TPayload>
  | IRuntimeEvent<TPayload>;

export interface ICreateCommandInput<TPayload> {
  id?: string;
  source: string;
  target: string;
  type: string;
  payload: TPayload;
}

export interface ICreateReplyBaseInput {
  id?: string;
  commandId: string;
  source: string;
  target: string;
  type: string;
}

export type TCreateReplyInput<TPayload = null> =
  | (ICreateReplyBaseInput & { ok: true; payload: TPayload; error?: never })
  | (ICreateReplyBaseInput & { ok: false; payload: null; error: IRuntimeError });

export interface ICreateEventInput<TPayload> {
  id?: string;
  source: string;
  target: string;
  type: string;
  delivery: 'realtime' | 'durable';
  payload: TPayload;
}

const nowIso = (): string => new Date().toISOString();
const nextId = (): string => `msg-${nanoid(10)}`;

export const createRuntimeCommand = <TPayload>(input: ICreateCommandInput<TPayload>): IRuntimeCommand<TPayload> => ({
  kind: 'command',
  id: input.id ?? nextId(),
  source: input.source,
  target: input.target,
  type: input.type,
  sentAt: nowIso(),
  payload: input.payload,
});

const getReplyCommandType = (replyType: string): TRuntimeCommandType | null => {
  if (!replyType.endsWith('.reply')) return null;
  const commandType = replyType.slice(0, -'.reply'.length);
  return isRuntimeCommandType(commandType) ? commandType : null;
};

export const createRuntimeReply = <TPayload = null>(input: TCreateReplyInput<TPayload>): IRuntimeReply<TPayload> => {
  const msg = {
    kind: 'reply' as const,
    id: input.id ?? nextId(),
    commandId: input.commandId,
    source: input.source,
    target: input.target,
    type: input.type,
    sentAt: nowIso(),
    ok: input.ok,
    payload: input.payload,
    ...('error' in input ? { error: input.error } : {}),
  };
  const parsed = parseRuntimeMessage(msg) as IRuntimeReply<TPayload>;
  if (!parsed.ok) return parsed;
  const commandType = getReplyCommandType(parsed.type);
  if (!commandType) return parsed;
  return {
    ...parsed,
    payload: parseRuntimeReplyPayload(commandType, parsed.payload),
  } as IRuntimeReply<TPayload>;
};

export const createRuntimeEvent = <TPayload>(input: ICreateEventInput<TPayload>): IRuntimeEvent<TPayload> => {
  const msg = parseRuntimeMessage({
    kind: 'event' as const,
    id: input.id ?? nextId(),
    source: input.source,
    target: input.target,
    type: input.type,
    sentAt: nowIso(),
    delivery: input.delivery,
    payload: input.payload,
  }) as IRuntimeEvent<TPayload>;

  if (!isRuntimeEventType(msg.type)) return msg;
  const expected = runtimeEventRegistry[msg.type];
  if (
    msg.source !== expected.source
    || msg.target !== expected.target
    || msg.delivery !== expected.delivery
  ) {
    throw new Error(`Invalid runtime IPC event for ${msg.type}: envelope mismatch`);
  }
  return { ...msg, payload: parseRuntimeEventPayload(msg.type, msg.payload) } as IRuntimeEvent<TPayload>;
};

export const parseRuntimeMessage = (value: unknown): TRuntimeMessage => {
  const parsed = messageSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid runtime IPC message: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`);
  }
  return parsed.data as TRuntimeMessage;
};

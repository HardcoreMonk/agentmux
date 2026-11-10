import type { ILayoutData, TAgentPanelType } from '@/types/terminal';
import type { IChunkReadResult, ISessionInfo, ISessionMeta, ITimelineAppendMessage, ITimelineErrorMessage, ITimelineInitMessage } from '@/types/timeline';
import type { IMessageCountResult } from '@/lib/timeline-message-counts';
import type { ICodexStateInput, IHookStateDecision, IHookStateInput, IStateDecision } from '@/lib/status-state-machine';
import type { IStatusClientEventIntent, IStatusClientEventPolicyInput } from '@/lib/status-client-event-policy';
import type { IStatusSideEffectIntent, IStatusSideEffectPolicyInput } from '@/lib/status-side-effect-policy';
import type {
  IStatusAddSessionHistoryResult,
  IStatusUpdateSessionHistoryDismissedAtResult,
} from '@/lib/runtime/status/session-history-actions';
import type { IStatusSendWebPushInput, IStatusSendWebPushResult } from '@/lib/runtime/status/web-push-actions';
import type { IClientTabStatusEntry, ILastEvent, IRateLimitsData, IStatusUpdateMessage, ITabStatusEntry, TEventName, TRateLimitsByProvider } from '@/types/status';
import type { ISessionHistoryEntry } from '@/types/session-history';
import type {
  ISavedSessionFilter,
  ISessionAnnotation,
  ISessionCatalogSearchInput,
  ISessionSearchPage,
  ISessionSearchQuery,
  TSessionAnnotationSelection,
} from '@/lib/session-catalog/contracts';
import type {
  IApprovedProjectRoot,
  IApprovedProjectRootSnapshot,
  IGovernanceAuditEvent,
  IGovernanceAuditCandidate,
  IGovernanceRefreshResult,
  IGovernanceWorkerHealth,
  IManagedProject,
  IManagedProjectSnapshot,
  IProjectDocumentDetail,
  IProjectDocumentRef,
  IProjectGovernanceSummary,
  IProjectLifecycleSnapshot,
  TManagedProjectImportField,
  TManagedProjectImportStatus,
  TManagedProjectSource,
} from '@/lib/governance/contracts';
import type {
  IGovernanceActionSummary,
  IGovernanceRollbackPreview,
  IScaffoldPreview,
  TScaffoldArtifactId,
  TScaffoldTemplateInput,
} from '@/lib/governance/scaffold-contracts';

export interface IRuntimeHealth {
  ok: boolean;
  storage: unknown;
  terminal: unknown;
  timeline: unknown;
  status: unknown;
  governance: unknown;
}

export interface IRuntimeWorkspace {
  id: string;
  name: string;
  defaultCwd: string;
  active: boolean | number;
  groupId?: string | null;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface IRuntimeCreateWorkspaceResult {
  id: string;
  rootPaneId: string;
}

export interface IRuntimeEnsureWorkspacePaneInput {
  workspaceId: string;
  paneId: string;
  name: string;
  defaultCwd: string;
}

export interface IRuntimeEnsureWorkspacePaneResult {
  workspaceId: string;
  paneId: string;
}

export interface IRuntimeWorkspaceList {
  workspaces: IRuntimeWorkspace[];
}

export interface IRuntimeWorkspaceTerminalSession {
  sessionName: string;
}

export interface IRuntimeTerminalSessionPresence {
  sessionName: string;
  exists: boolean;
}

export interface IRuntimeDeleteWorkspaceStorageResult {
  deleted: boolean;
  sessions: IRuntimeWorkspaceTerminalSession[];
}

export interface IRuntimeDeleteWorkspaceResult {
  deleted: boolean;
  killedSessions: string[];
  failedKills: Array<{ sessionName: string; error: string }>;
}

export interface IRuntimeDeleteTerminalTabStorageResult {
  deleted: boolean;
  session: IRuntimeWorkspaceTerminalSession | null;
}

export interface IRuntimeDeleteTerminalTabResult {
  deleted: boolean;
  killedSession: string | null;
  failedKill: { sessionName: string; error: string } | null;
}

export interface IRuntimeTerminalTab {
  id: string;
  sessionName: string;
  name: string;
  order: number;
  cwd?: string;
  panelType: 'terminal';
  runtimeVersion: 2;
  lifecycleState: 'pending_terminal' | 'ready' | 'failed';
}

export interface IRuntimePendingTerminalTab {
  id: string;
  sessionName: string;
  workspaceId: string;
  paneId: string;
  cwd: string;
  runtimeVersion: 2;
  lifecycleState: 'pending_terminal';
  createdAt: string;
}

export type TRuntimeLayout = ILayoutData | null;

export interface IRuntimeTimelineSessionPage {
  sessions: ISessionMeta[];
  total: number;
  hasMore: boolean;
  refreshing?: boolean;
}

export interface IRuntimeTimelineSessionListInput {
  tmuxSession: string;
  cwd?: string;
  panelType: string;
  offset: number;
  limit: number;
  providers?: TAgentPanelType[];
}

export interface IRuntimeSessionCatalogHealth {
  state: 'ready' | 'building' | 'degraded' | 'disabled';
  queueLag: number;
  cursorAgeMs: number | null;
  rebuildState: 'idle' | 'building' | 'cancelling';
  indexedSessions: number;
  lastIndexedAt: string | null;
}

export type TRuntimeSessionCatalogSearchInput = ISessionSearchQuery;
export type TRuntimeTimelineCatalogSearchInput = ISessionCatalogSearchInput;
export type TRuntimeSessionCatalogSearchResult = ISessionSearchPage;

export interface IRuntimeSelectSessionAnnotationsInput {
  pinned?: boolean;
  tags?: string[];
}

export type TRuntimeSessionAnnotationSelection = TSessionAnnotationSelection;

export interface IRuntimeSessionCatalogReadEntriesInput {
  sessionId: string;
  beforeByte: number;
  limit: number;
  /** Ignored by the catalog; kept optional for older callers. */
  panelType?: string;
}

export interface IRuntimeSessionCatalogRebuildResult {
  started: boolean;
  state: 'building' | 'already-building' | 'disabled';
}

export interface IRuntimeUpdateSessionAnnotationInput {
  sessionId: string;
  pinned: boolean;
  tags: string[];
  expectedVersion: number;
}

export type TRuntimeSessionAnnotation = ISessionAnnotation;
export type TRuntimeSavedSessionFilter = ISavedSessionFilter;

export type TRuntimeRegisterApprovedProjectRootInput = IApprovedProjectRootSnapshot;
export type TRuntimeApprovedProjectRoot = IApprovedProjectRoot;
export type TRuntimeApprovedProjectRootSnapshot = IApprovedProjectRootSnapshot;

export interface IRuntimeRegisterManagedProjectInput {
  approvedRootId: string;
  title: string;
  relativePath: string;
  canonicalPath: string;
  source: TManagedProjectSource;
  externalId?: string;
  sourceFingerprint?: string;
}

export interface IRuntimeManagedProjectImportAction {
  status: TManagedProjectImportStatus;
  projectId?: string;
  externalId: string;
  title: string;
  relativePath: string;
  canonicalPath: string;
  selectedFields: TManagedProjectImportField[];
}

export interface IRuntimeApplyManagedProjectImportInput {
  approvedRootId: string;
  digest: string;
  sourceFingerprint: string;
  actions: IRuntimeManagedProjectImportAction[];
}

export interface IRuntimeManagedProjectImportResult {
  counts: Record<TManagedProjectImportStatus, number>;
}

export type TRuntimeManagedProject = IManagedProject;
export type TRuntimeManagedProjectSnapshot = IManagedProjectSnapshot;
export type TRuntimeGovernanceAuditEvent = IGovernanceAuditEvent;
export type TRuntimeGovernanceAuditCandidate = IGovernanceAuditCandidate;
export type TRuntimeGovernanceRefreshResult = IGovernanceRefreshResult;
export type TRuntimeGovernanceWorkerHealth = IGovernanceWorkerHealth;
export type TRuntimeProjectDocumentDetail = IProjectDocumentDetail;
export type TRuntimeProjectDocumentRef = IProjectDocumentRef;
export type TRuntimeProjectGovernanceSummary = IProjectGovernanceSummary;
export type TRuntimeProjectLifecycleSnapshot = IProjectLifecycleSnapshot;
export type TRuntimeScaffoldPreview = IScaffoldPreview;
export type TRuntimeGovernanceActionSummary = IGovernanceActionSummary;
export type TRuntimeGovernanceRollbackPreview = IGovernanceRollbackPreview;

export interface IRuntimePreviewScaffoldInput {
  projectId: string;
  artifacts: TScaffoldArtifactId[];
  adoptArtifacts: TScaffoldArtifactId[];
  input: TScaffoldTemplateInput;
}

export interface IRuntimeConfirmScaffoldInput {
  projectId: string;
  token: string;
  digest: string;
  confirmation: string;
}

export interface IRuntimeGovernanceActionInput {
  projectId: string;
  actionId: string;
}

export interface IRuntimeConfirmGovernanceRollbackInput extends IRuntimeGovernanceActionInput {
  token: string;
  digest: string;
  confirmation: string;
}

export interface IRuntimeTimelineEntriesBeforeInput {
  jsonlPath: string;
  beforeByte: number;
  limit: number;
  panelType: string;
}

export type TRuntimeTimelineEntriesBeforeResult = Pick<IChunkReadResult, 'entries' | 'startByteOffset' | 'hasMore'>;

export type TRuntimeTimelineMessageCounts = IMessageCountResult;

export interface IRuntimeTimelineLiveSubscribeInput {
  jsonlPath: string;
  sessionName: string;
  sessionId?: string;
  panelType: string;
  onAppend?: (event: IRuntimeTimelineLiveAppendEvent) => void;
  onError?: (event: IRuntimeTimelineLiveErrorEvent) => void;
}

export interface IRuntimeTimelineLiveSubscribePayload {
  subscriberId: string;
  jsonlPath: string;
  sessionName: string;
  sessionId?: string;
  panelType: string;
}

export interface IRuntimeTimelineLiveSubscribeResult {
  subscriberId: string;
  subscribed: boolean;
  init: ITimelineInitMessage;
}

export interface IRuntimeTimelineLiveUnsubscribeResult {
  subscriberId: string;
  unsubscribed: boolean;
}

export interface IRuntimeTimelineLiveAppendEvent extends Omit<ITimelineAppendMessage, 'type'> {
  subscriberId: string;
  jsonlPath: string;
}

export interface IRuntimeTimelineLiveErrorEvent extends Omit<ITimelineErrorMessage, 'type'> {
  subscriberId?: string;
  jsonlPath?: string;
}

export interface IRuntimeTimelineSessionWatchSubscribeInput {
  sessionName: string;
  panePid: number;
  panelType: string;
  skipInitial?: boolean;
  onChanged?: (event: IRuntimeTimelineSessionChangedEvent) => void;
}

export interface IRuntimeTimelineSessionWatchSubscribePayload {
  subscriberId: string;
  sessionName: string;
  panePid: number;
  panelType: string;
  skipInitial?: boolean;
}

export interface IRuntimeTimelineSessionWatchSubscribeResult {
  subscriberId: string;
  subscribed: boolean;
}

export interface IRuntimeTimelineSessionWatchUnsubscribeResult {
  subscriberId: string;
  unsubscribed: boolean;
}

export interface IRuntimeTimelineSessionChangedEvent {
  subscriberId: string;
  sessionName: string;
  info: ISessionInfo;
}

export type TRuntimeStatusHookStateInput = IHookStateInput;

export type TRuntimeStatusHookDecision = IHookStateDecision;

export type TRuntimeStatusCodexStateInput = ICodexStateInput;

export type TRuntimeStatusDecision = IStateDecision;

export interface IRuntimeStatusNotificationPolicyInput {
  eventName: TEventName;
  notificationType?: string;
  newState: string;
  silent?: boolean;
}

export interface IRuntimeStatusNotificationPolicyResult {
  processHookEvent: boolean;
  sendReviewNotification: boolean;
  sendNeedsInputNotification: boolean;
}

export type TRuntimeStatusSideEffectInput = IStatusSideEffectPolicyInput;

export type TRuntimeStatusSideEffectIntent = IStatusSideEffectIntent;

export type TRuntimeStatusClientEventInput = IStatusClientEventPolicyInput;

export type TRuntimeStatusClientEventIntent = IStatusClientEventIntent;

export type TRuntimeStatusAddSessionHistoryResult = IStatusAddSessionHistoryResult;

export type TRuntimeStatusUpdateSessionHistoryDismissedAtResult = IStatusUpdateSessionHistoryDismissedAtResult;

export interface IRuntimeStatusUpdateSessionHistoryDismissedAtInput {
  tabId: string;
  dismissedAt: number;
}

export type TRuntimeStatusSessionHistoryEntry = ISessionHistoryEntry;

export type TRuntimeStatusSendWebPushInput = IStatusSendWebPushInput;

export type TRuntimeStatusSendWebPushResult = IStatusSendWebPushResult;

export interface IRuntimeStatusLiveSyncPayload {
  tabs: Record<string, IClientTabStatusEntry>;
  rateLimits: TRateLimitsByProvider;
}

export type TRuntimeStatusLiveUpdatePayload = Omit<IStatusUpdateMessage, 'type'>;

export interface IRuntimeStatusSessionHistoryUpdatePayload {
  entry: ISessionHistoryEntry;
}

export interface IRuntimeStatusHookEventPayload {
  tabId: string;
  sessionName: string;
  event: ILastEvent;
}

export interface IRuntimeStatusErrorPayload {
  code: string;
  message: string;
}

export interface IRuntimeStatusRateLimitsUpdatePayload {
  providerId: TAgentPanelType;
  data: IRateLimitsData;
}

export type TRuntimeStatusLiveEventPayload =
  | IRuntimeStatusLiveSyncPayload
  | TRuntimeStatusLiveUpdatePayload
  | IRuntimeStatusSessionHistoryUpdatePayload
  | IRuntimeStatusHookEventPayload
  | IRuntimeStatusErrorPayload
  | IRuntimeStatusRateLimitsUpdatePayload;

export type TRuntimeStatusLiveEventType =
  | 'status.sync'
  | 'status.update'
  | 'status.session-history-update'
  | 'status.hook-event'
  | 'status.error'
  | 'status.rate-limits-update';

interface IRuntimeStatusLiveEventBase {
  kind: 'event';
  id: string;
  source: 'status';
  target: 'supervisor';
  sentAt: string;
  delivery: 'realtime';
}

export type IRuntimeStatusLiveEvent =
  | (IRuntimeStatusLiveEventBase & { type: 'status.sync'; payload: IRuntimeStatusLiveSyncPayload })
  | (IRuntimeStatusLiveEventBase & { type: 'status.update'; payload: TRuntimeStatusLiveUpdatePayload })
  | (IRuntimeStatusLiveEventBase & { type: 'status.session-history-update'; payload: IRuntimeStatusSessionHistoryUpdatePayload })
  | (IRuntimeStatusLiveEventBase & { type: 'status.hook-event'; payload: IRuntimeStatusHookEventPayload })
  | (IRuntimeStatusLiveEventBase & { type: 'status.error'; payload: IRuntimeStatusErrorPayload })
  | (IRuntimeStatusLiveEventBase & { type: 'status.rate-limits-update'; payload: IRuntimeStatusRateLimitsUpdatePayload });

export interface IRuntimeStatusLiveSubscribeInput {
  onEvent?: (event: IRuntimeStatusLiveEvent) => void;
}

export interface IRuntimeStatusLiveSubscribeResult {
  subscriberId: string;
  subscribed: boolean;
  sync: IRuntimeStatusLiveSyncPayload;
}

export interface IRuntimeStatusLiveUnsubscribeResult {
  subscriberId: string;
  unsubscribed: boolean;
}

export interface IRuntimeStatusLiveHookEventInput {
  tmuxSession: string;
  event: string;
  notificationType?: string;
  agentSessionId?: string;
  transcriptPath?: string;
  source?: string;
}

export interface IRuntimeStatusLiveClientEventInput {
  eventType: 'dismiss-tab' | 'ack-notification';
  tabId: string;
  seq?: number;
}

export interface IRuntimeStatusLiveNotifyLastUserMessageInput {
  sessionName: string;
  message: string;
}

export interface IRuntimeStatusLiveRemoveTabInput {
  tabId: string;
}

export interface IRuntimeStatusLiveRegisterTabInput {
  tabId: string;
  entry: ITabStatusEntry;
}

export interface IRuntimeStatusLiveDeviceVisibilityInput {
  deviceId: string;
  visible: boolean;
}

export interface IRuntimeStatusLiveAcceptedResult {
  accepted: boolean;
}

export interface IRuntimeStatusLivePollResult {
  polled: boolean;
}

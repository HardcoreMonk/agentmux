import type { TCliState, TToolName } from '@/types/timeline';
import type { TAgentPanelType, TPanelType } from '@/types/terminal';
import type { ISessionHistoryEntry } from '@/types/session-history';
import type { IApprovalPromptMetadata } from '@/lib/permission-prompt';

export type TTerminalStatus = 'idle' | 'running' | 'server';

export type TEventName = 'session-start' | 'prompt-submit' | 'notification' | 'stop' | 'interrupt';

export interface ILastEvent {
  name: TEventName;
  at: number;
  seq: number;
}

export interface ICurrentAction {
  toolName: TToolName | null;
  summary: string;
}

export interface ITabStatusEntry {
  cliState: TCliState;
  workspaceId: string;
  tabName: string;
  currentProcess?: string;
  paneTitle?: string;
  tmuxSession: string;
  panelType?: TPanelType;
  terminalStatus?: TTerminalStatus;
  listeningPorts?: number[];
  agentSummary?: string | null;
  lastUserMessage?: string | null;
  lastAssistantMessage?: string | null;
  currentAction?: ICurrentAction | null;
  readyForReviewAt?: number | null;
  busySince?: number | null;
  dismissedAt?: number | null;
  agentSessionId?: string | null;
  compactingSince?: number | null;
  processRetries?: number;
  jsonlPath?: string | null;
  lastEvent?: ILastEvent | null;
  eventSeq?: number;
  lastInterruptTs?: number;
  approvalPromptMetadata?: IApprovalPromptMetadata | null;
}

export type TTabDisplayStatus = 'busy' | 'ready-for-review' | 'needs-input' | 'idle' | 'unknown';

export type IClientTabStatusEntry = Omit<ITabStatusEntry, 'tmuxSession' | 'jsonlPath' | 'processRetries'>;

export interface IStatusSyncMessage {
  type: 'status:sync';
  tabs: Record<string, IClientTabStatusEntry>;
}

export interface IStatusUpdateMessage {
  type: 'status:update';
  tabId: string;
  cliState: TCliState | null;
  workspaceId: string;
  tabName: string;
  currentProcess?: string;
  paneTitle?: string;
  panelType?: TPanelType;
  terminalStatus?: TTerminalStatus;
  listeningPorts?: number[];
  agentSummary?: string | null;
  lastUserMessage?: string | null;
  lastAssistantMessage?: string | null;
  currentAction?: ICurrentAction | null;
  readyForReviewAt?: number | null;
  busySince?: number | null;
  dismissedAt?: number | null;
  agentSessionId?: string | null;
  compactingSince?: number | null;
  lastEvent?: ILastEvent | null;
  eventSeq?: number;
  approvalPromptMetadata?: IApprovalPromptMetadata | null;
}

export interface IRateLimitWindow {
  used_percentage: number;
  resets_at: number;
  observed_at?: number;
}

export interface IRateLimitsData {
  ts: number;
  five_hour: IRateLimitWindow | null;
  seven_day: IRateLimitWindow | null;
}

export type TRateLimitsByProvider = Partial<Record<TAgentPanelType, IRateLimitsData>>;

export interface IRateLimitsUpdateMessage {
  type: 'rate-limits:update';
  providerId: TAgentPanelType;
  data: IRateLimitsData;
}

export interface ISessionHistorySyncMessage {
  type: 'session-history:sync';
  entries: ISessionHistoryEntry[];
}

export interface ISessionHistoryUpdateMessage {
  type: 'session-history:update';
  entry: ISessionHistoryEntry;
}

export interface IStatusHookEventMessage {
  type: 'status:hook-event';
  tabId: string;
  sessionName: string;
  event: ILastEvent;
}

export type TStatusServerMessage = IStatusSyncMessage | IStatusUpdateMessage | IRateLimitsUpdateMessage | ISessionHistorySyncMessage | ISessionHistoryUpdateMessage | IStatusHookEventMessage;

export interface IStatusTabDismissedMessage {
  type: 'status:tab-dismissed';
  tabId: string;
}

export interface IStatusRequestSyncMessage {
  type: 'status:request-sync';
}

export interface IStatusAckNotificationMessage {
  type: 'status:ack-notification';
  tabId: string;
  seq: number;
}

export type TStatusClientMessage =
  | IStatusTabDismissedMessage
  | IStatusRequestSyncMessage
  | IStatusAckNotificationMessage;

import type { IChunkReadResult, IIncrementalResult, ISessionInfo, ITimelineEntry } from '@/types/timeline';
import type { ISessionWatcher } from '@/lib/session-detection';
import type { IAgentJsonlStatus } from '@/lib/status/jsonl-check';
import type { ITab, TPanelType } from '@/types/terminal';

export interface IAgentResumeCommandOptions {
  workspaceId?: string;
  tabId?: string;
  sessionName?: string;
}

export interface IAgentLaunchCommandOptions {
  workspaceId?: string;
  tabId?: string;
  sessionName?: string;
}

export interface IAgentSessionWatchOptions {
  skipInitial?: boolean;
}

export interface IAgentJsonlResolution {
  sessionId: string;
  jsonlPath: string;
  mtimeMs?: number;
  startedAt?: number | null;
}

export interface IAgentPromptClaim {
  message: string;
  sentAt: number;
}

export interface IAgentProviderStatusBehavior {
  readonly watchJsonlWhenBound: boolean;
  readonly deferStopHookUntilJsonlIdle: boolean;
  readonly reconcileStateFromJsonl: boolean;
  readonly recoverPaneInput: boolean;
}

export type TAgentHookStatusBehavior = Pick<
  IAgentProviderStatusBehavior,
  'watchJsonlWhenBound' | 'deferStopHookUntilJsonlIdle'
>;

export interface IAgentProvider {
  readonly id: string;
  readonly displayName: string;
  readonly panelType: TPanelType;
  readonly statusBehavior: IAgentProviderStatusBehavior;

  matchesProcess(commandName: string): boolean;
  isValidSessionId(id: unknown): id is string;

  detectActiveSession(panePid: number, childPids?: number[]): Promise<ISessionInfo>;
  isAgentRunning(panePid: number, childPids?: number[]): Promise<boolean>;
  watchSessions(
    panePid: number,
    onChange: (info: ISessionInfo) => void,
    options?: IAgentSessionWatchOptions,
  ): ISessionWatcher;

  buildResumeCommand(sessionId: string, options: IAgentResumeCommandOptions): Promise<string>;
  buildLaunchCommand(options: IAgentLaunchCommandOptions): Promise<string>;
  jsonlRoots(homeDir?: string): string[];
  resolveJsonlPath(sessionId: string, cwd: string): Promise<string | null>;
  resolveLatestJsonlPath?(cwd: string): Promise<IAgentJsonlResolution | null>;
  resolveJsonlPathForClaim?(cwd: string, claim: IAgentPromptClaim): Promise<IAgentJsonlResolution | null>;
  parseJsonlContent(content: string): ITimelineEntry[];
  readTailEntries(filePath: string, maxEntries: number): Promise<IChunkReadResult>;
  readEntriesBefore(filePath: string, beforeByte: number, maxEntries: number): Promise<IChunkReadResult>;
  parseIncremental(
    filePath: string,
    fromOffset: number,
    pendingBuffer?: string,
  ): Promise<IIncrementalResult>;
  readJsonlStatus(jsonlPath: string): Promise<IAgentJsonlStatus>;

  readSessionId(tab: ITab): string | null;
  writeSessionId(tab: ITab, sessionId: string | null | undefined): void;
  readJsonlPath(tab: ITab): string | null;
  writeJsonlPath(tab: ITab, jsonlPath: string | null | undefined): void;
  readSummary(tab: ITab): string | null;
  writeSummary(tab: ITab, summary: string | null | undefined): void;
}

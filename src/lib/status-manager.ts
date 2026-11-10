import { WebSocket } from 'ws';
import { getWorkspaces } from '@/lib/workspace-store';
import { readLayoutFile, resolveLayoutFile, collectAllTabs, updateTabCliStatus, updateTabAgentSessionId, updateTabAgentJsonlPath, parseSessionName, setLayoutReconciler } from '@/lib/layout-store';
import { getAllPanesInfo, getListeningPorts, SAFE_SHELLS, getSessionCwd, getSessionPanePid } from '@/lib/tmux';
import { getChildPids } from '@/lib/session-detection';
import {
  detectAnyActiveSession,
  getProviderByPanelType,
} from '@/lib/providers';
import type { IAgentProvider } from '@/lib/providers';
import { createRateLimitsWatcher } from '@/lib/rate-limits-watcher';
import { mergeRateLimitsData, rateLimitsEqual } from '@/lib/codex-rate-limits';
import { createLogger } from '@/lib/logger';
import type { IPaneInfo } from '@/lib/tmux';
import type { TCliState } from '@/types/timeline';
import type { TTerminalStatus, ITabStatusEntry, IClientTabStatusEntry, IRateLimitsData } from '@/types/status';
import {
  addSessionHistoryEntry as addLegacySessionHistoryEntry,
  updateSessionHistoryDismissedAt as updateLegacySessionHistoryDismissedAt,
} from '@/lib/session-history';
import type { ISessionHistoryEntry } from '@/types/session-history';
import { isAnyDeviceVisible } from '@/lib/push-subscriptions';
import { nanoid } from 'nanoid';
import fs from 'fs/promises';
import { readAgentSessionId, readAgentSummary } from '@/lib/agent-tab-fields';
import { getConfig } from '@/lib/config-store';
import { reduceCodexState } from '@/lib/status-state-machine';
import { createDedupeKeyStore } from '@/lib/dedupe-key-store';
import { completionKeyFor, normalizeSessionId, resolveAgentSessionId, sessionIdFromJsonlPath } from '@/lib/status-session-mapping';
import { mergeStatusMetadata } from '@/lib/status-metadata';
import { forwardBridgeTraceStatusUpdate } from '@/lib/bridge-trace-forwarder';
import { getPerfNow, recordPerfCounter, recordPerfDuration } from '@/lib/perf-metrics';
import { getRuntimeStatusV2Mode } from '@/lib/runtime/status-mode';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';
import { compareRuntimeStatusShadowDecision } from '@/lib/runtime/status-shadow-compare';
import {
  evaluateStatusClientEvent,
  type IStatusClientEventIntent,
  type IStatusClientEventPolicyInput,
} from '@/lib/status-client-event-policy';
import {
  evaluateStatusSideEffects,
  type IStatusSideEffectIntent,
  type IStatusSideEffectPolicyInput,
} from '@/lib/status-side-effect-policy';
import {
  checkJsonlIdle,
  clearJsonlCheckCache,
  emptyJsonlCheckResult,
  type IJsonlCheckResult,
} from '@/lib/status/jsonl-check';
import {
  buildStatusSessionHistoryEntry,
  type IStatusJsonlStats,
} from '@/lib/status/session-history-entry';
import { createStatusSessionHistoryPersistence } from '@/lib/status/session-history-persistence';
import { createStatusPaneRecoveryService } from '@/lib/status/pane-recovery-service';
import { StatusPollService } from '@/lib/status/poll-service';
import { StatusJsonlWatchService } from '@/lib/status/jsonl-watch-service';
import { evaluateStatusHookEvent } from '@/lib/status/hook-event-service';
import { decideHookSessionRebind, decideNeedsInputJsonlExit } from '@/lib/status/hook-session-binding';
import { evaluateResolveUnknownStatus } from '@/lib/status/resolve-unknown-service';
import { StatusStopRecheckService } from '@/lib/status/stop-recheck-service';
import {
  shouldEmitSyntheticJsonlInterrupt,
  shouldKeepStatusJsonlWatch,
  shouldScheduleDelayedJsonlInputRecovery,
} from '@/lib/status/jsonl-reconciliation-service';
import {
  buildStatusRemoveMessage,
  buildStatusUpdateMessage,
  toStatusClientTabEntry,
} from '@/lib/status/client-payload';
import { reconcileStatusPollTabChanges } from '@/lib/status/poll-tab-reconciliation';
import { buildStatusPollCreatedTabBootstrap } from '@/lib/status/poll-created-tab-bootstrap';
import {
  applyStatusPollTraversalCounts,
  createStatusPollCounts,
  recordStatusPollBroadcastRemove,
  recordStatusPollBroadcastUpdate,
  recordStatusPollTabKind,
} from '@/lib/status/poll-counts';
import { applyStatusPollTabEntryUpdate } from '@/lib/status/poll-tab-entry-update';
import {
  recoverStatusPollPaneInput,
  resolveStatusPollUpdateAction,
  StatusPollRecoveryService,
} from '@/lib/status/poll-recovery-service';
import { collectStatusPollWorkspaceTabs } from '@/lib/status/poll-workspace-traversal';
import { buildStatusScanTabBootstrap } from '@/lib/status/scan-tab-bootstrap';
import { deliverStatusWebPush } from '@/lib/status/web-push-delivery';
import { buildStatusWebPushPayload } from '@/lib/status/web-push-payload';
import { createStatusWebPushActions } from '@/lib/runtime/status/web-push-actions';

const log = createLogger('status');
const hookLog = createLogger('hooks');

interface IReadTabMetadataOptions {
  sessionId?: string | null;
  jsonlPath?: string | null;
  childPids?: number[];
}

type TChildPidCache = Map<number, Promise<number[]>>;

const COMPACT_STALE_MS = 60_000;

const BUSY_STUCK_MS = 10 * 60 * 1000;
const JSONL_EXTENDED_TAIL_SIZE = 131_072;
const PROCESS_RETRY_COUNT = 3;
const CODEX_STOP_RECHECK_MS = 500;

interface IReadTabMetadataResult extends IJsonlCheckResult {
  jsonlPath: string | null;
  running: boolean;
  sessionId?: string | null;
}

const checkProviderJsonlIdle = async (
  provider: IAgentProvider,
  jsonlPath: string,
  onRateLimits?: (data: IRateLimitsData) => void,
): Promise<IJsonlCheckResult> => {
  const { rateLimits, ...result } = await provider.readJsonlStatus(jsonlPath);
  if (rateLimits) onRateLimits?.(rateLimits);
  return result;
};

const parseJsonlStats = async (jsonlPath: string): Promise<IStatusJsonlStats> => {
  const empty: IStatusJsonlStats = { toolUsage: {}, touchedFiles: [], lastAssistantText: null, lastUserText: null, firstUserTs: null, lastAssistantTs: null, turnDurationMs: null };
  try {
    const stat = await fs.stat(jsonlPath);
    if (stat.size === 0) return empty;

    const handle = await fs.open(jsonlPath, 'r');
    try {
      const readSize = Math.min(stat.size, JSONL_EXTENDED_TAIL_SIZE);
      const buffer = Buffer.alloc(readSize);
      await handle.read(buffer, 0, readSize, stat.size - readSize);
      const lines = buffer.toString('utf-8').split('\n').filter((l) => l.trim());

      const toolUsage: Record<string, number> = {};
      const touchedFiles = new Set<string>();
      let lastAssistantText: string | null = null;
      let lastUserText: string | null = null;
      let lastAssistantTs: number | null = null;
      let firstUserTs: number | null = null;
      let turnDurationMs: number | null = null;

      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.type === 'file-history-snapshot') break;
          if (entry.isSidechain) continue;

          if (entry.type === 'system' && entry.subtype === 'turn_duration' && typeof entry.durationMs === 'number' && !turnDurationMs) {
            turnDurationMs = entry.durationMs;
          }

          const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : null;

          if (entry.type === 'user') {
            if (ts) firstUserTs = ts;
            if (!lastUserText && Array.isArray(entry.message?.content)) {
              for (const block of entry.message.content) {
                if (block.type === 'text' && block.text) {
                  lastUserText = block.text;
                  break;
                }
              }
            }
          }

          if (entry.type === 'assistant') {
            if (ts && !lastAssistantTs) lastAssistantTs = ts;
            if (Array.isArray(entry.message?.content)) {
              let msgLastText: string | null = null;
              for (const block of entry.message.content) {
                if (block.type === 'tool_use' && block.name) {
                  toolUsage[block.name] = (toolUsage[block.name] ?? 0) + 1;
                  if ((block.name === 'Edit' || block.name === 'Write') && block.input?.file_path) {
                    touchedFiles.add(String(block.input.file_path));
                  }
                }
                if (block.type === 'text' && block.text) {
                  msgLastText = block.text;
                }
              }
              if (!lastAssistantText && msgLastText) {
                lastAssistantText = msgLastText;
              }
            }
          }
        } catch { continue; }
      }

      return { toolUsage, touchedFiles: [...touchedFiles], lastAssistantText, lastUserText, firstUserTs, lastAssistantTs, turnDurationMs };
    } finally {
      await handle.close();
    }
  } catch {
    return empty;
  }
};

const g = globalThis as unknown as { __ptStatusManager?: StatusManager };

export interface IStatusManagerOptions {
  broadcast?: (event: object, exclude?: WebSocket) => void;
  enableRateLimits?: boolean;
  useRuntimeAdapters?: boolean;
}

export class StatusManager {
  private tabs = new Map<string, ITabStatusEntry>();
  private clients = new Set<WebSocket>();
  private initialized = false;
  private rateLimitsWatcher: ReturnType<typeof createRateLimitsWatcher> | null = null;
  private lastRateLimits: IRateLimitsData | null = null;
  private compactStaleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private reviewNotificationDedupe = createDedupeKeyStore();
  private sessionHistoryDedupe = createDedupeKeyStore();
  private webPushActions = createStatusWebPushActions();
  private paneRecovery = createStatusPaneRecoveryService({
    warn: (message) => log.warn(message),
  });
  private readonly jsonlWatchService: StatusJsonlWatchService;
  private readonly pollService: StatusPollService;
  private readonly pollRecoveryService: StatusPollRecoveryService;
  private readonly sessionHistoryPersistence: ReturnType<typeof createStatusSessionHistoryPersistence>;
  private readonly stopRecheckService: StatusStopRecheckService;

  constructor(private readonly options: IStatusManagerOptions = {}) {
    this.jsonlWatchService = new StatusJsonlWatchService({
      onChange: (tabId, jsonlPath) => this.onJsonlFileChange(tabId, jsonlPath),
      onStart: (tabId, jsonlPath) => log.debug('startJsonlWatch tabId=%s path=%s', tabId, jsonlPath),
      onStop: (tabId) => log.debug('stopJsonlWatch tabId=%s', tabId),
    });
    this.pollService = new StatusPollService({
      getTabCount: () => this.tabs.size,
      poll: () => this.poll(),
      onPollError: (err) => log.error({ err }, 'Polling error'),
      recordCounter: recordPerfCounter,
      getPerfNow,
      recordDuration: recordPerfDuration,
    });
    this.pollRecoveryService = new StatusPollRecoveryService({
      busyStuckMs: BUSY_STUCK_MS,
    });
    this.stopRecheckService = new StatusStopRecheckService({
      delayMs: CODEX_STOP_RECHECK_MS,
      recheckCodexStop: ({ tabId, tmuxSession }) => this.recheckCodexStopNow(tabId, tmuxSession),
      refreshStopSnippet: ({ tabId, jsonlPath }) => this.refreshStopSnippet(tabId, jsonlPath),
      clearJsonlCache: (jsonlPath) => clearJsonlCheckCache(jsonlPath),
      warn: (message) => hookLog.warn(message),
    });
    this.sessionHistoryPersistence = createStatusSessionHistoryPersistence({
      shouldUseRuntimeDefault: () => this.shouldUseRuntimeStatusDefault(),
      addRuntime: async (entry) => {
        await getRuntimeSupervisor().addStatusSessionHistoryEntry(entry);
      },
      updateRuntimeDismissedAt: (input) => getRuntimeSupervisor().updateStatusSessionHistoryDismissedAt(input),
      addLegacy: addLegacySessionHistoryEntry,
      updateLegacyDismissedAt: updateLegacySessionHistoryDismissedAt,
      recordCounter: recordPerfCounter,
      warn: (message) => log.warn(message),
    });
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    await this.scanAll();
    this.startPolling();

    if (this.options.enableRateLimits !== false) {
      this.rateLimitsWatcher = createRateLimitsWatcher((data) => {
        this.publishRateLimits(data);
      });
      this.rateLimitsWatcher.start();
    }
  }

  private publishRateLimits(data: IRateLimitsData): void {
    const merged = mergeRateLimitsData(this.lastRateLimits, data);
    if (rateLimitsEqual(this.lastRateLimits, merged)) return;
    this.lastRateLimits = merged;
    this.broadcast({ type: 'rate-limits:update', data: merged });
  }

  private async scanAll(): Promise<void> {
    const { workspaces } = await getWorkspaces();
    const panesInfo = await getAllPanesInfo();
    const childPidCache: TChildPidCache = new Map();
    this.jsonlWatchService.stopAll();
    this.tabs.clear();

    const traversal = await collectStatusPollWorkspaceTabs({
      workspaces,
      readLayout: async (workspaceId) => readLayoutFile(resolveLayoutFile(workspaceId)),
    });
    for (const { workspaceId, tab } of traversal.workspaceTabs) {
        const paneInfo = panesInfo.get(tab.sessionName);
        const provider = getProviderByPanelType(tab.panelType);
        const detected = await this.readTabMetadata(paneInfo, provider, {
          sessionId: provider?.readSessionId(tab) ?? null,
          jsonlPath: provider?.readJsonlPath(tab) ?? null,
          childPids: provider ? await this.getCachedChildPids(childPidCache, paneInfo) : undefined,
        });
        const { terminalStatus, listeningPorts } = provider
          ? { terminalStatus: 'idle' as const, listeningPorts: [] as number[] }
          : await this.detectTerminalStatus(paneInfo);
        const bootstrap = buildStatusScanTabBootstrap({
          workspaceId,
          tab,
          statusBehavior: provider?.statusBehavior ?? null,
          paneInfo,
          detected,
          terminalStatus,
          listeningPorts,
          now: Date.now(),
        });
        this.tabs.set(tab.id, bootstrap.entry);
        if (bootstrap.actions.shouldStartJsonlWatch && detected.jsonlPath) {
          this.startJsonlWatch(tab.id, detected.jsonlPath);
        }
        if (bootstrap.actions.shouldRecoverPaneInput) {
          const pendingRecovery = await this.recoverPendingInputFromPane(tab.id, { silent: true });
          if (!pendingRecovery.recovered) {
            await this.recoverInterruptedPromptFromPane(tab.id, { silent: true });
          }
        }
        if (bootstrap.actions.shouldResolveUnknown) {
          this.resolveUnknown(tab.id).catch((err) => log.warn('resolveUnknown failed: %s', err));
        }
    }
  }

  private async resolveUnknown(tabId: string): Promise<void> {
    const entry = this.tabs.get(tabId);
    if (!entry || entry.cliState !== 'unknown') return;

    const provider = getProviderByPanelType(entry.panelType);
    let agentRunning = false;
    let jsonl: { idle: boolean; stale: boolean; lastAssistantSnippet: string | null } | null = null;
    if (provider) {
      const paneInfo = (await getAllPanesInfo()).get(entry.tmuxSession);
      const childPids = paneInfo?.pid ? await getChildPids(paneInfo.pid) : [];
      agentRunning = paneInfo?.pid
        ? await provider.isAgentRunning(paneInfo.pid, childPids)
        : false;
      if (agentRunning && entry.jsonlPath) {
        const { idle, stale, lastAssistantSnippet } = await checkProviderJsonlIdle(
          provider,
          entry.jsonlPath,
          (data) => this.publishRateLimits(data),
        );
        jsonl = { idle, stale, lastAssistantSnippet };
      }
    }

    const decision = evaluateResolveUnknownStatus({
      currentState: entry.cliState,
      providerId: provider?.id ?? null,
      agentRunning,
      jsonl,
    });
    if (decision.action !== 'apply-state') return;

    this.applyCliState(tabId, entry, decision.nextState, decision.options);
    this.persistToLayout(entry);
    this.broadcastUpdate(tabId, entry);
  }

  private getCachedChildPids(cache: TChildPidCache, paneInfo: IPaneInfo | undefined): Promise<number[]> {
    if (!paneInfo?.pid) return Promise.resolve([]);

    const existing = cache.get(paneInfo.pid);
    if (existing) return existing;

    const next = getChildPids(paneInfo.pid);
    cache.set(paneInfo.pid, next);
    return next;
  }

  private async readTabMetadata(
    paneInfo: IPaneInfo | undefined,
    provider: IAgentProvider | null,
    options: IReadTabMetadataOptions = {},
  ): Promise<IReadTabMetadataResult> {
    const empty = { ...emptyJsonlCheckResult(), jsonlPath: null, running: false, sessionId: null };
    if (!paneInfo || !paneInfo.pid || !provider) return empty;

    const childPids = options.childPids ?? await getChildPids(paneInfo.pid);
    const running = await provider.isAgentRunning(paneInfo.pid, childPids);
    if (!running) return empty;

    const session = await provider.detectActiveSession(paneInfo.pid, childPids);
    const jsonlPath = session.jsonlPath ?? options.jsonlPath ?? null;
    const sessionId = session.sessionId
      ?? sessionIdFromJsonlPath(jsonlPath)
      ?? normalizeSessionId(options.sessionId);

    if (session.status !== 'running' || !jsonlPath) {
      return { ...emptyJsonlCheckResult(), jsonlPath, running: true, sessionId };
    }

    const result = await checkProviderJsonlIdle(
      provider,
      jsonlPath,
      (data) => this.publishRateLimits(data),
    );
    return { ...result, jsonlPath, running: true, sessionId };
  }

  private mergeJsonlMetadata(entry: ITabStatusEntry, metadata: IJsonlCheckResult): boolean {
    const { next, changed } = mergeStatusMetadata(entry, metadata);
    if (changed) {
      entry.currentAction = next.currentAction;
      entry.lastAssistantMessage = next.lastAssistantMessage;
    }
    return changed;
  }

  private reconcileCodexState(
    tabId: string,
    entry: ITabStatusEntry,
    metadata: IReadTabMetadataResult,
  ): boolean {
    if (!getProviderByPanelType(entry.panelType)?.statusBehavior.reconcileStateFromJsonl) return false;

    const decision = reduceCodexState({
      currentState: entry.cliState,
      running: metadata.running,
      hasJsonlPath: !!metadata.jsonlPath,
      idle: metadata.idle,
      hasCompletionSnippet: !!metadata.lastAssistantSnippet,
    });
    if (!decision.changed) return false;

    this.applyCliState(tabId, entry, decision.nextState, {
      silent: decision.silent,
      skipHistory: decision.skipHistory,
      completionKey: completionKeyFor({
        completionTurnId: metadata.completionTurnId,
        metadataSessionId: metadata.sessionId,
        entrySessionId: entry.agentSessionId,
        jsonlPath: metadata.jsonlPath,
        tmuxSession: entry.tmuxSession,
      }),
    });
    return true;
  }

  private async detectTerminalStatus(
    paneInfo?: IPaneInfo,
  ): Promise<{ terminalStatus: TTerminalStatus; listeningPorts: number[] }> {
    if (!paneInfo || !paneInfo.pid) return { terminalStatus: 'idle', listeningPorts: [] };

    const ports = await getListeningPorts(paneInfo.pid);
    if (ports.length > 0) return { terminalStatus: 'server', listeningPorts: ports };

    const isShell = SAFE_SHELLS.has(paneInfo.command);
    return { terminalStatus: isShell ? 'idle' : 'running', listeningPorts: [] };
  }

  async rescan(): Promise<void> {
    await this.scanAll();
  }

  startPolling(): void {
    this.pollService.start();
  }

  stopPolling(): void {
    this.pollService.stop();
  }

  async poll(): Promise<void> {
    const pollContext = this.pollService.beginPoll();
    const pollCounts = createStatusPollCounts();

    const { workspaces } = await getWorkspaces();
    const traversal = await collectStatusPollWorkspaceTabs({
      workspaces,
      readLayout: async (workspaceId) => readLayoutFile(resolveLayoutFile(workspaceId)),
    });
    const panesInfo = await getAllPanesInfo();
    applyStatusPollTraversalCounts(pollCounts, {
      workspaceCount: traversal.workspaceCount,
      paneCount: panesInfo.size,
      scannedTabCount: traversal.scannedTabCount,
    });
    const childPidCache: TChildPidCache = new Map();
    const knownTabIds = traversal.knownTabIds;
    const tabsBeforePoll = new Set(this.tabs.keys());
    const now = Date.now();

    for (const { workspaceId, tab } of traversal.workspaceTabs) {
        const existing = this.tabs.get(tab.id);
        const paneInfo = panesInfo.get(tab.sessionName);
        const provider = getProviderByPanelType(tab.panelType);
        recordStatusPollTabKind(pollCounts, !!provider);

        const { terminalStatus, listeningPorts } = provider
          ? { terminalStatus: 'idle' as const, listeningPorts: [] as number[] }
          : await this.detectTerminalStatus(paneInfo);
        const currentProcess = paneInfo?.command;
        const newPaneTitle = paneInfo ? `${paneInfo.command}|${paneInfo.path}` : undefined;

        if (!existing) {
          const detected = await this.readTabMetadata(paneInfo, provider, {
            sessionId: provider?.readSessionId(tab) ?? null,
            jsonlPath: provider?.readJsonlPath(tab) ?? null,
            childPids: provider ? await this.getCachedChildPids(childPidCache, paneInfo) : undefined,
          });
          const bootstrap = buildStatusPollCreatedTabBootstrap({
            workspaceId,
            tab,
            statusBehavior: provider?.statusBehavior ?? null,
            paneInfo,
            detected,
            terminalStatus,
            listeningPorts,
            now: Date.now(),
          });
          const { entry } = bootstrap;
          this.tabs.set(tab.id, entry);
          this.persistToLayout(entry);
          this.broadcastUpdate(tab.id, entry);
          recordStatusPollBroadcastUpdate(pollCounts);
          if (bootstrap.actions.shouldResolveUnknown) {
            this.resolveUnknown(tab.id).catch((err) => log.warn('resolveUnknown failed: %s', err));
          }
          if (bootstrap.actions.shouldStartJsonlWatch && detected.jsonlPath) {
            this.startJsonlWatch(tab.id, detected.jsonlPath);
          }
          continue;
        }

        const tabSummary = readAgentSummary(tab);
        const baseTabChanges = reconcileStatusPollTabChanges({
          existing,
          currentProcess,
          nextLastUserMessage: tab.lastUserMessage,
          nextPanelType: tab.panelType,
          nextTerminalStatus: terminalStatus,
          nextListeningPorts: listeningPorts,
          nextAgentSummary: tabSummary,
          metadataChanged: false,
          codexStateChanged: false,
          retryCount: PROCESS_RETRY_COUNT,
        });
        const refreshed = await this.readTabMetadata(paneInfo, provider, {
          sessionId: provider?.readSessionId(tab) ?? existing.agentSessionId ?? null,
          jsonlPath: provider?.readJsonlPath(tab) ?? existing.jsonlPath ?? null,
          childPids: provider ? await this.getCachedChildPids(childPidCache, paneInfo) : undefined,
        });
        applyStatusPollTabEntryUpdate({
          entry: existing,
          workspaceId,
          tab,
          paneTitle: newPaneTitle,
          currentProcess,
          refreshed,
          persistedSessionId: readAgentSessionId(tab),
          processRetries: baseTabChanges.processRetries,
          terminalChanged: baseTabChanges.terminalChanged,
          terminalStatus,
          listeningPorts,
          summaryChanged: baseTabChanges.summaryChanged,
          agentSummary: tabSummary,
        });
        const metadataChanged = this.mergeJsonlMetadata(existing, refreshed);
        const codexStateChanged = this.reconcileCodexState(tab.id, existing, refreshed);
        if (provider?.statusBehavior.watchJsonlWhenBound && existing.jsonlPath) {
          this.startJsonlWatch(tab.id, existing.jsonlPath);
        }

        const busyRecovered = await this.pollRecoveryService.recoverBusyStuck({
          currentState: existing.cliState,
          lastEventAt: existing.lastEvent?.at,
          now,
          paneInfo,
          provider,
          getChildPids: (info) => this.getCachedChildPids(childPidCache, info),
          forceIdle: () => {
            log.info({ tabId: tab.id }, 'busy stuck — agent process gone, forcing idle');
            this.applyCliState(tab.id, existing, 'idle', { silent: true });
            this.persistToLayout(existing);
            this.broadcastUpdate(tab.id, existing);
          },
        });
        if (busyRecovered) {
          recordStatusPollBroadcastUpdate(pollCounts);
          continue;
        }

        const paneRecovery = await recoverStatusPollPaneInput({
          recoverPaneInput: !!provider?.statusBehavior.recoverPaneInput,
          running: refreshed.running,
          recoverPending: () => this.recoverPendingInputFromPane(tab.id),
          recoverInterrupted: () => this.recoverInterruptedPromptFromPane(tab.id),
        });
        const updateAction = resolveStatusPollUpdateAction({
          paneRecovered: paneRecovery.recovered,
          shouldBroadcastUpdate: baseTabChanges.shouldBroadcastUpdate,
          metadataChanged,
          codexStateChanged,
        });
        if (updateAction === 'count-only') {
          recordStatusPollBroadcastUpdate(pollCounts);
        } else if (updateAction === 'broadcast') {
          this.broadcastUpdate(tab.id, existing);
          recordStatusPollBroadcastUpdate(pollCounts);
        }
    }

    for (const tabId of tabsBeforePoll) {
      if (!knownTabIds.has(tabId) && this.tabs.has(tabId)) {
        this.stopJsonlWatch(tabId);
        this.tabs.delete(tabId);
        this.broadcastRemove(tabId);
        recordStatusPollBroadcastRemove(pollCounts);
      }
    }

    this.pollService.refreshInterval();
    this.pollService.finishPoll(pollContext, pollCounts);
  }

  getAllForClient(): Record<string, IClientTabStatusEntry> {
    const result: Record<string, IClientTabStatusEntry> = {};
    for (const [tabId, entry] of this.tabs) {
      result[tabId] = toStatusClientTabEntry(entry);
    }
    return result;
  }

  getRateLimitsForClient(): IRateLimitsData | null {
    return this.lastRateLimits;
  }

  getPerfSnapshot() {
    const stateCounts: Record<TCliState, number> = {
      idle: 0,
      busy: 0,
      inactive: 0,
      'ready-for-review': 0,
      'needs-input': 0,
      cancelled: 0,
      unknown: 0,
    };
    const providerCounts: Record<string, number> = {};
    let providerTabCount = 0;
    let terminalTabCount = 0;
    let openClients = 0;
    let totalBufferedAmount = 0;
    let maxBufferedAmount = 0;

    for (const entry of this.tabs.values()) {
      stateCounts[entry.cliState] += 1;
      const provider = getProviderByPanelType(entry.panelType);
      if (provider) {
        providerTabCount++;
        providerCounts[provider.id] = (providerCounts[provider.id] ?? 0) + 1;
      } else {
        terminalTabCount++;
      }
    }

    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) openClients++;
      totalBufferedAmount += ws.bufferedAmount;
      maxBufferedAmount = Math.max(maxBufferedAmount, ws.bufferedAmount);
    }

    return {
      tabs: this.tabs.size,
      providerTabs: providerTabCount,
      terminalTabs: terminalTabCount,
      stateCounts,
      providerCounts,
      clients: this.clients.size,
      openClients,
      bufferedAmount: {
        total: totalBufferedAmount,
        max: maxBufferedAmount,
      },
      jsonlWatchers: this.jsonlWatchService.size(),
      compactStaleTimers: this.compactStaleTimers.size,
      currentIntervalMs: this.pollService.getCurrentInterval(),
      lastPoll: this.pollService.getLastSnapshot(),
    };
  }

  private applyCliState(
    tabId: string,
    entry: ITabStatusEntry,
    newState: TCliState,
    opts: { silent?: boolean; skipHistory?: boolean; completionKey?: string | null } = {},
  ): void {
    const prevState = entry.cliState;
    if (prevState === newState) return;
    const prevBusySince = entry.busySince;
    const provider = getProviderByPanelType(entry.panelType);
    const wantsSessionHistory = newState === 'ready-for-review' && !!entry.jsonlPath && !opts.skipHistory;
    const wantsReviewNotification = newState === 'ready-for-review' && !opts.silent;
    const sideEffectInput: IStatusSideEffectPolicyInput = {
      previousState: prevState,
      newState,
      ...(opts.silent !== undefined ? { silent: opts.silent } : {}),
      ...(opts.skipHistory !== undefined ? { skipHistory: opts.skipHistory } : {}),
      hasJsonlPath: !!entry.jsonlPath,
      providerId: provider?.id ?? null,
      hasJsonlWatcher: this.jsonlWatchService.has(tabId),
      sessionHistoryDedupeAccepted: wantsSessionHistory
        ? this.sessionHistoryDedupe.remember(opts.completionKey)
        : false,
      reviewNotificationDedupeAccepted: wantsReviewNotification
        ? this.reviewNotificationDedupe.remember(opts.completionKey)
        : false,
    };
    const sideEffects = evaluateStatusSideEffects(sideEffectInput);
    this.shadowStatusSideEffects(sideEffectInput, sideEffects);
    const now = Date.now();
    entry.cliState = newState;
    entry.readyForReviewAt = sideEffects.setReadyForReviewAt ? now : null;
    entry.busySince = sideEffects.setBusySince ? now : null;
    if (newState !== 'needs-input') entry.approvalPromptMetadata = null;
    if (sideEffects.clearDismissedAt) entry.dismissedAt = null;

    if (sideEffects.saveSessionHistory) {
      const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
      delay(500).then(() => this.saveSessionHistory(tabId, entry, prevBusySince, false)).catch((err) => {
        log.warn('Failed to save session history: %s', err);
      });
    }

    if (sideEffects.sendReviewNotification) {
      this.sendWebPush(tabId, entry, 'review').catch((err) => {
        log.warn('Web push failed: %s', err);
      });
    }

    if (sideEffects.sendNeedsInputNotification) {
      this.sendWebPush(tabId, entry, 'needs-input').catch((err) => {
        log.warn('Web push failed: %s', err);
      });
    }

    if (sideEffects.startJsonlWatch) {
      this.startJsonlWatch(tabId, entry.jsonlPath!);
    } else if (sideEffects.stopJsonlWatch) {
      this.stopJsonlWatch(tabId);
    }
  }

  private shadowStatusSideEffects(
    input: IStatusSideEffectPolicyInput,
    expected: IStatusSideEffectIntent,
  ): void {
    if (process.env.AGENTMUX_RUNTIME_V2 !== '1' || getRuntimeStatusV2Mode() !== 'shadow') return;

    getRuntimeSupervisor().evaluateStatusSideEffects(input).then((actual) => {
      const comparison = compareRuntimeStatusShadowDecision('side-effect', expected, actual);
      if (comparison.ok) {
        recordPerfCounter('runtime_v2.status_shadow.side_effect.match');
        return;
      }
      recordPerfCounter('runtime_v2.status_shadow.side_effect.mismatch');
      log.warn({ mismatches: comparison.mismatches }, 'runtime v2 status side-effect shadow mismatch');
    }).catch((err) => {
      recordPerfCounter('runtime_v2.status_shadow.side_effect.error');
      log.warn('runtime v2 status side-effect shadow failed: %s', err instanceof Error ? err.message : String(err));
    });
  }

  private async saveSessionHistory(tabId: string, entry: ITabStatusEntry, prevBusySince: number | null | undefined, cancelled: boolean): Promise<void> {
    if (!entry.lastUserMessage) return;

    const stats = entry.jsonlPath ? await parseJsonlStats(entry.jsonlPath) : null;
    const { workspaces } = await getWorkspaces();
    const ws = workspaces.find((w) => w.id === entry.workspaceId);
    const now = Date.now();

    const historyEntry = buildStatusSessionHistoryEntry({
      id: nanoid(),
      tabId,
      entry,
      workspaceName: ws?.name ?? entry.workspaceId,
      workspaceDir: ws?.directories[0] ?? null,
      stats,
      prevBusySince,
      cancelled,
      now,
    });

    await this.addSessionHistoryEntry(historyEntry);
    this.broadcast({ type: 'session-history:update', entry: historyEntry });
  }

  private shouldUseRuntimeStatusDefault(): boolean {
    return this.options.useRuntimeAdapters !== false
      && process.env.AGENTMUX_RUNTIME_V2 === '1'
      && getRuntimeStatusV2Mode() === 'default';
  }

  private async addSessionHistoryEntry(entry: ISessionHistoryEntry): Promise<void> {
    await this.sessionHistoryPersistence.add(entry);
  }

  private async updateSessionHistoryDismissedAt(
    tabId: string,
    dismissedAt: number,
  ): Promise<ISessionHistoryEntry | null> {
    return this.sessionHistoryPersistence.updateDismissedAt({ tabId, dismissedAt });
  }

  dismissTab(tabId: string, exclude?: WebSocket): boolean {
    const entry = this.tabs.get(tabId);
    if (!entry) return false;

    const clientEventInput: IStatusClientEventPolicyInput = {
      eventType: 'dismiss-tab',
      currentState: entry.cliState,
      lastEventName: entry.lastEvent?.name ?? null,
      lastEventSeq: entry.lastEvent?.seq ?? null,
      clientSeq: null,
    };
    const clientEvent = evaluateStatusClientEvent(clientEventInput);
    this.shadowStatusClientEvent(clientEventInput, clientEvent);
    if (!clientEvent.accepted || clientEvent.nextState !== 'idle') return false;

    const dismissedAt = Date.now();
    this.applyCliState(tabId, entry, 'idle', { silent: true });
    if (clientEvent.setDismissedAt) entry.dismissedAt = dismissedAt;
    if (clientEvent.persistLayout) this.persistToLayout(entry);
    if (clientEvent.broadcastUpdate) this.broadcastUpdate(tabId, entry, exclude);

    if (clientEvent.updateSessionHistoryDismissedAt) {
      this.updateSessionHistoryDismissedAt(tabId, dismissedAt).then((updated) => {
        if (updated) this.broadcast({ type: 'session-history:update', entry: updated });
      }).catch((err) => {
        log.warn('Failed to update session history dismissedAt: %s', err);
      });
    }
    return true;
  }

  ackNotificationInput(tabId: string, seq: number): boolean {
    const entry = this.tabs.get(tabId);
    if (!entry) return false;
    const clientEventInput: IStatusClientEventPolicyInput = {
      eventType: 'ack-notification',
      currentState: entry.cliState,
      lastEventName: entry.lastEvent?.name ?? null,
      lastEventSeq: entry.lastEvent?.seq ?? null,
      clientSeq: seq,
    };
    const clientEvent = evaluateStatusClientEvent(clientEventInput);
    this.shadowStatusClientEvent(clientEventInput, clientEvent);
    if (!clientEvent.accepted || clientEvent.nextState !== 'busy') return false;

    hookLog.debug({ tabId, seq }, 'ack: needs-input→busy');
    this.applyCliState(tabId, entry, 'busy');
    if (clientEvent.persistLayout) this.persistToLayout(entry);
    if (clientEvent.broadcastUpdate) this.broadcastUpdate(tabId, entry);
    return true;
  }

  private shadowStatusClientEvent(
    input: IStatusClientEventPolicyInput,
    expected: IStatusClientEventIntent,
  ): void {
    if (process.env.AGENTMUX_RUNTIME_V2 !== '1' || getRuntimeStatusV2Mode() !== 'shadow') return;

    getRuntimeSupervisor().evaluateStatusClientEvent(input).then((actual) => {
      const comparison = compareRuntimeStatusShadowDecision('client-event', expected, actual);
      if (comparison.ok) {
        recordPerfCounter('runtime_v2.status_shadow.client_event.match');
        return;
      }
      recordPerfCounter('runtime_v2.status_shadow.client_event.mismatch');
      log.warn({ mismatches: comparison.mismatches }, 'runtime v2 status client-event shadow mismatch');
    }).catch((err) => {
      recordPerfCounter('runtime_v2.status_shadow.client_event.error');
      log.warn('runtime v2 status client-event shadow failed: %s', err instanceof Error ? err.message : String(err));
    });
  }

  private async recoverPendingInputFromPane(
    tabId: string,
    opts: { silent?: boolean } = {},
  ): Promise<{ recovered: boolean; reason?: string }> {
    const entry = this.tabs.get(tabId);
    if (!entry) return { recovered: false, reason: 'no-entry' };
    const recovery = await this.paneRecovery.recoverPendingInput({
      tabId,
      entry,
      silent: opts.silent,
    });
    if (!recovery.recovered) return recovery;

    entry.approvalPromptMetadata = recovery.approvalPromptMetadata;
    entry.eventSeq = recovery.lastEvent.seq;
    entry.lastEvent = recovery.lastEvent;

    const optionCount = recovery.log.event === 'pending-input' ? recovery.log.optionCount : 0;
    hookLog.debug({ tabId, seq: recovery.log.seq, options: optionCount }, 'recover pending→needs-input from pane capture');
    this.applyCliState(tabId, entry, recovery.nextState, recovery.applyOptions);
    this.persistToLayout(entry);
    this.broadcastUpdate(tabId, entry);
    return { recovered: true };
  }

  private async recoverInterruptedPromptFromPane(
    tabId: string,
    opts: { silent?: boolean } = {},
  ): Promise<{ recovered: boolean; reason?: string }> {
    const entry = this.tabs.get(tabId);
    if (!entry) return { recovered: false, reason: 'no-entry' };
    const recovery = await this.paneRecovery.recoverInterruptedPrompt({
      tabId,
      entry,
      silent: opts.silent,
    });
    if (!recovery.recovered) return recovery;

    entry.eventSeq = recovery.lastEvent.seq;
    entry.lastEvent = recovery.lastEvent;
    if (recovery.lastInterruptTs) entry.lastInterruptTs = recovery.lastInterruptTs;
    if (recovery.clearCurrentAction) entry.currentAction = null;

    hookLog.debug({ tabId, seq: recovery.log.seq }, 'recover busy→idle from Codex interrupted prompt');
    this.applyCliState(tabId, entry, recovery.nextState, recovery.applyOptions);
    this.persistToLayout(entry);
    this.broadcastUpdate(tabId, entry);
    return { recovered: true };
  }

  async recoverUnknownIfPending(tabId: string): Promise<{ recovered: boolean; reason?: string }> {
    const entry = this.tabs.get(tabId);
    if (!entry) return { recovered: false, reason: 'no-entry' };
    if (entry.cliState !== 'unknown') return { recovered: false, reason: 'not-unknown' };
    return this.recoverPendingInputFromPane(tabId, { silent: true });
  }

  private findTabIdBySession(tmuxSession: string): string | undefined {
    for (const [tabId, entry] of this.tabs) {
      if (entry.tmuxSession === tmuxSession) return tabId;
    }
    return undefined;
  }

  updateTabFromHook(
    tmuxSession: string,
    event: string,
    options: { notificationType?: string; agentSessionId?: string; transcriptPath?: string; source?: string } = {},
  ): void {
    const { notificationType } = options;
    const tabId = this.findTabIdBySession(tmuxSession);
    if (!tabId) {
      hookLog.debug({ tmuxSession, event, notificationType }, 'no tabId for session');
      return;
    }
    const entry = this.tabs.get(tabId);
    if (!entry) {
      hookLog.debug({ tabId, event, notificationType }, 'no entry for tab');
      return;
    }

    const provider = getProviderByPanelType(entry.panelType);
    this.rebindSessionFromHook(tabId, entry, options);
    const hookEvent = evaluateStatusHookEvent({
      event,
      notificationType,
      entry,
      providerId: provider?.id ?? null,
      statusBehavior: provider?.statusBehavior ?? null,
    });

    if (hookEvent.kind === 'compact') {
      hookLog.debug({ tabId, event }, 'compact hook');
      this.setCompacting(tabId, entry, hookEvent.compactingSince);
      return;
    }

    if (hookEvent.kind === 'ignore' && hookEvent.reason === 'unknown-event') {
      hookLog.debug({ tabId, event, notificationType }, 'unknown event, ignoring');
      return;
    }

    if (hookEvent.kind === 'ignore') {
      hookLog.debug({ tabId, event: hookEvent.eventName, notificationType }, 'non-input notification, skipping state transition');
      return;
    }

    const { eventName, lastEvent, decision, prevState, newState } = hookEvent;
    const seq = lastEvent.seq;
    entry.eventSeq = seq;
    entry.lastEvent = lastEvent;
    this.broadcast({
      type: 'status:hook-event',
      tabId,
      sessionName: tmuxSession,
      event: entry.lastEvent,
    });

    if (hookEvent.shouldRecheckCodexStop) {
      hookLog.debug({ tabId, event: eventName, notificationType, seq, prevState }, 'queued Codex stop JSONL verification');
      this.recheckCodexStop(tabId, tmuxSession);
      return;
    }

    hookLog.debug(
      { tabId, event: eventName, notificationType, seq, prevState, newState, transition: decision.changed },
      `processed ${eventName}${notificationType ? `(${notificationType})` : ''} ${prevState}→${newState}`,
    );

    if (decision.changed) {
      this.applyCliState(tabId, entry, newState);
      this.persistToLayout(entry);
      this.broadcastUpdate(tabId, entry);
    }

    if (hookEvent.shouldResolveJsonl) {
      this.resolveAndWatchJsonl(tabId, tmuxSession).catch(() => {});
    }

    if (hookEvent.shouldRefreshStopSnippet && entry.jsonlPath) {
      this.stopRecheckService.scheduleStopSnippetRefresh({ tabId, jsonlPath: entry.jsonlPath });
    }
  }

  private rebindSessionFromHook(
    tabId: string,
    entry: ITabStatusEntry,
    options: { agentSessionId?: string; transcriptPath?: string },
  ): void {
    const provider = getProviderByPanelType(entry.panelType);
    const decision = decideHookSessionRebind({
      behavior: provider?.statusBehavior ?? null,
      currentSessionId: entry.agentSessionId ?? null,
      currentJsonlPath: entry.jsonlPath ?? null,
      hookSessionId: options.agentSessionId,
      transcriptPath: options.transcriptPath,
    });
    if (!provider || !decision.rebind) return;

    entry.agentSessionId = decision.sessionId;
    entry.jsonlPath = decision.jsonlPath;
    this.stopJsonlWatch(tabId);
    hookLog.debug({ tabId, agentSessionId: decision.sessionId }, 'rebinding tab to hook session');

    const { tmuxSession } = entry;
    updateTabAgentSessionId(tmuxSession, provider, decision.sessionId).catch(() => {});
    void (async () => {
      let jsonlPath = decision.jsonlPath;
      if (!jsonlPath) {
        const cwd = await getSessionCwd(tmuxSession);
        jsonlPath = cwd ? await provider.resolveJsonlPath(decision.sessionId, cwd) : null;
      }
      const current = this.tabs.get(tabId);
      if (!current || current.agentSessionId !== decision.sessionId) return;
      current.jsonlPath = jsonlPath;
      await updateTabAgentJsonlPath(tmuxSession, provider, jsonlPath).catch(() => {});
      const keepWatching = shouldKeepStatusJsonlWatch({
        cliState: current.cliState,
        watchJsonlWhenBound: provider.statusBehavior.watchJsonlWhenBound,
      });
      if (jsonlPath && keepWatching) this.startJsonlWatch(tabId, jsonlPath);
      this.broadcastUpdate(tabId, current);
    })().catch((err) => {
      hookLog.debug({ tabId, err }, 'hook session rebind failed');
    });
  }

  private recheckCodexStop(tabId: string, tmuxSession: string): void {
    this.stopRecheckService.scheduleCodexStopRecheck({ tabId, tmuxSession });
  }

  private async recheckCodexStopNow(tabId: string, tmuxSession: string): Promise<void> {
    let entry = this.tabs.get(tabId);
    if (!entry) return;

    if (!entry.jsonlPath) {
      await this.resolveAndWatchJsonl(tabId, tmuxSession);
      entry = this.tabs.get(tabId);
    }

    if (!entry?.jsonlPath) return;
    clearJsonlCheckCache(entry.jsonlPath);
    await this.onJsonlFileChange(tabId, entry.jsonlPath);
  }

  private async refreshStopSnippet(tabId: string, jsonlPath: string): Promise<void> {
    const entry = this.tabs.get(tabId);
    if (!entry) return;

    const provider = getProviderByPanelType(entry.panelType);
    const check = provider
      ? await checkProviderJsonlIdle(provider, jsonlPath, (data) => this.publishRateLimits(data))
      : await checkJsonlIdle(jsonlPath);
    const { next, changed } = mergeStatusMetadata(entry, {
      currentAction: check.currentAction,
      lastAssistantSnippet: check.lastAssistantSnippet,
      reset: check.reset,
    });
    if (!changed) return;
    entry.currentAction = next.currentAction;
    entry.lastAssistantMessage = next.lastAssistantMessage;
    this.broadcastUpdate(tabId, entry);
  }

  private setCompacting(tabId: string, entry: ITabStatusEntry, since: number | null): void {
    const existingTimer = this.compactStaleTimers.get(tabId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.compactStaleTimers.delete(tabId);
    }

    if ((entry.compactingSince ?? null) === since) return;
    entry.compactingSince = since;
    this.broadcastUpdate(tabId, entry);

    if (since !== null) {
      const timer = setTimeout(() => {
        this.compactStaleTimers.delete(tabId);
        const e = this.tabs.get(tabId);
        if (!e || e.compactingSince !== since) return;
        e.compactingSince = null;
        hookLog.debug({ tabId }, 'compact stale, auto-cleared');
        this.broadcastUpdate(tabId, e);
      }, COMPACT_STALE_MS);
      this.compactStaleTimers.set(tabId, timer);
    }
  }

  removeTab(tabId: string): boolean {
    const entry = this.tabs.get(tabId);
    if (!entry) return false;
    if (entry && (entry.cliState === 'busy' || entry.cliState === 'needs-input') && entry.lastUserMessage) {
      this.saveSessionHistory(tabId, entry, entry.busySince, true).catch((err) => {
        log.warn('Failed to save cancelled session history: %s', err);
      });
    }
    this.stopJsonlWatch(tabId);
    const compactTimer = this.compactStaleTimers.get(tabId);
    if (compactTimer) {
      clearTimeout(compactTimer);
      this.compactStaleTimers.delete(tabId);
    }
    this.tabs.delete(tabId);
    this.broadcastRemove(tabId);
    return true;
  }

  reconcileWorkspaceTabs(wsId: string, validTabIds: readonly string[]): void {
    const valid = new Set(validTabIds);
    for (const [tabId, entry] of this.tabs) {
      if (entry.workspaceId === wsId && !valid.has(tabId)) {
        this.removeTab(tabId);
      }
    }
  }

  removeWorkspaceTabs(wsId: string): void {
    for (const [tabId, entry] of this.tabs) {
      if (entry.workspaceId === wsId) {
        this.removeTab(tabId);
      }
    }
  }

  registerTab(tabId: string, entry: ITabStatusEntry): void {
    this.tabs.set(tabId, entry);
    this.broadcastUpdate(tabId, entry);
  }

  addClient(ws: WebSocket): void {
    this.clients.add(ws);
    if (this.lastRateLimits && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'rate-limits:update', data: this.lastRateLimits }));
    }
  }

  removeClient(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  private persistToLayout(entry: ITabStatusEntry): void {
    updateTabCliStatus(entry.tmuxSession, entry.cliState, entry.dismissedAt).catch(() => {});
  }

  private broadcastUpdate(tabId: string, entry: ITabStatusEntry, exclude?: WebSocket): void {
    const msg = buildStatusUpdateMessage(tabId, entry);
    this.broadcast(msg, exclude);
    forwardBridgeTraceStatusUpdate(msg).catch((err) => {
      log.debug('bridge trace forward failed: %s', err instanceof Error ? err.message : String(err));
    });
  }

  private broadcastRemove(tabId: string): void {
    this.broadcast(buildStatusRemoveMessage(tabId));
  }

  private static readonly BACKPRESSURE_LIMIT = 1024 * 1024;

  broadcast(event: object, exclude?: WebSocket): void {
    if (this.options.broadcast) {
      this.options.broadcast(event, exclude);
      return;
    }
    const msg = JSON.stringify(event);
    let sent = 0;
    let skippedBackpressure = 0;
    for (const ws of this.clients) {
      if (ws === exclude || ws.readyState !== WebSocket.OPEN) continue;
      if (ws.bufferedAmount >= StatusManager.BACKPRESSURE_LIMIT) {
        skippedBackpressure++;
        continue;
      }
      ws.send(msg);
      sent++;
    }
    if (sent > 0) recordPerfCounter('status.ws.sent', sent);
    if (skippedBackpressure > 0) {
      recordPerfCounter('status.ws.backpressure_skipped', skippedBackpressure);
    }
  }

  private async resolveAndWatchJsonl(tabId: string, tmuxSession: string): Promise<void> {
    const entry = this.tabs.get(tabId);
    if (!entry || entry.jsonlPath) return;

    let jsonlPath: string | null = null;

    const parsed = parseSessionName(tmuxSession);
    if (parsed) {
      const layout = await readLayoutFile(resolveLayoutFile(parsed.wsId));
      if (layout) {
        const tab = collectAllTabs(layout.root).find((t) => t.sessionName === tmuxSession);
        const provider = getProviderByPanelType(entry.panelType);
        const tabAgentSessionId = provider?.statusBehavior.bindSessionFromHook && entry.agentSessionId
          ? entry.agentSessionId
          : tab ? normalizeSessionId(readAgentSessionId(tab)) : null;
        if (provider && tabAgentSessionId) {
          const cwd = await getSessionCwd(tmuxSession);
          if (cwd) {
            jsonlPath = await provider.resolveJsonlPath(tabAgentSessionId, cwd);
          }
        }

        if (tab?.lastUserMessage && entry.lastUserMessage !== tab.lastUserMessage) {
          entry.lastUserMessage = tab.lastUserMessage;
          this.broadcastUpdate(tabId, entry);
        }
      }
    }

    if (!jsonlPath) {
      const panePid = await getSessionPanePid(tmuxSession);
      if (panePid) {
        const { info } = await detectAnyActiveSession(panePid);
        jsonlPath = info.jsonlPath;
        if (info.sessionId) entry.agentSessionId = info.sessionId;
      }
    }

    if (!jsonlPath) return;

    entry.jsonlPath = jsonlPath;
    entry.agentSessionId = resolveAgentSessionId({
      currentSessionId: entry.agentSessionId,
      jsonlPath,
    });

    if ((entry.cliState === 'busy' || entry.cliState === 'needs-input') && !this.jsonlWatchService.has(tabId)) {
      this.startJsonlWatch(tabId, jsonlPath);
    }
    const provider = getProviderByPanelType(entry.panelType);
    if (provider?.statusBehavior.watchJsonlWhenBound) {
      this.startJsonlWatch(tabId, jsonlPath);
    }
    if (provider?.statusBehavior.reconcileStateFromJsonl) {
      const metadata = await checkProviderJsonlIdle(
        provider,
        jsonlPath,
        (data) => this.publishRateLimits(data),
      );
      this.mergeJsonlMetadata(entry, metadata);
      this.reconcileCodexState(tabId, entry, { ...metadata, jsonlPath, running: true });
      this.broadcastUpdate(tabId, entry);
    }
  }

  private startJsonlWatch(tabId: string, jsonlPath: string): void {
    this.jsonlWatchService.start(tabId, jsonlPath);
  }

  private stopJsonlWatch(tabId: string): void {
    this.jsonlWatchService.stop(tabId);
  }

  private async onJsonlFileChange(tabId: string, jsonlPath: string): Promise<void> {
    const entry = this.tabs.get(tabId);
    if (!entry) {
      this.stopJsonlWatch(tabId);
      return;
    }
    const provider = getProviderByPanelType(entry.panelType);
    const statusBehavior = provider?.statusBehavior ?? null;
    if (!shouldKeepStatusJsonlWatch({
      cliState: entry.cliState,
      watchJsonlWhenBound: !!statusBehavior?.watchJsonlWhenBound,
    })) {
      this.stopJsonlWatch(tabId);
      return;
    }

    const check = provider
      ? await checkProviderJsonlIdle(provider, jsonlPath, (data) => this.publishRateLimits(data))
      : await checkJsonlIdle(jsonlPath);
    const { interrupted, lastEntryTs } = check;

    const needsInputExit = decideNeedsInputJsonlExit({
      behavior: statusBehavior,
      cliState: entry.cliState,
      needsInputSince: entry.lastEvent?.at ?? null,
      lastEntryTs,
      interrupted,
    });
    if (needsInputExit !== 'none') {
      hookLog.debug({ tabId, lastEntryTs, to: needsInputExit }, 'left needs-input after JSONL growth');
      this.applyCliState(tabId, entry, needsInputExit);
      this.persistToLayout(entry);
      this.broadcastUpdate(tabId, entry);
    }

    if (lastEntryTs !== null && shouldEmitSyntheticJsonlInterrupt({
      currentState: entry.cliState,
      interrupted,
      lastEntryTs,
      lastInterruptTs: entry.lastInterruptTs,
      lastEventAt: entry.lastEvent?.at,
    })) {
      entry.lastInterruptTs = lastEntryTs;
      hookLog.debug({ tabId, lastEntryTs }, 'synthetic interrupt from JSONL');
      this.updateTabFromHook(entry.tmuxSession, 'interrupt');
    }

    let changed = false;

    changed = this.mergeJsonlMetadata(entry, check) || changed;

    if (statusBehavior?.reconcileStateFromJsonl) {
      entry.jsonlPath = jsonlPath;
      changed = this.reconcileCodexState(tabId, entry, { ...check, jsonlPath, running: true }) || changed;
    }

    if (statusBehavior?.recoverPaneInput) {
      const recovery = await this.recoverPendingInputFromPane(tabId);
      if (recovery.recovered) {
        changed = false;
      } else {
        const interruptedRecovery = await this.recoverInterruptedPromptFromPane(tabId);
        if (interruptedRecovery.recovered) {
          changed = false;
        } else if (shouldScheduleDelayedJsonlInputRecovery({
          currentState: entry.cliState,
          currentAction: check.currentAction,
        })) {
          setTimeout(() => {
            this.recoverPendingInputFromPane(tabId).catch((err) => {
              hookLog.debug({ tabId, err }, 'delayed permission prompt recovery failed');
            });
          }, 750);
        }
      }
    }

    if (changed) {
      this.broadcastUpdate(tabId, entry);
    }
  }

  shutdown(): void {
    this.stopPolling();
    this.rateLimitsWatcher?.stop();
    this.jsonlWatchService.stopAll();
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1001, 'Server shutting down');
      }
    }
    this.clients.clear();
  }

  notifyLastUserMessage(sessionName: string, message: string): boolean {
    const parsed = parseSessionName(sessionName);
    if (!parsed) return false;
    const entry = this.tabs.get(parsed.tabId);
    if (!entry || entry.lastUserMessage === message) return false;
    entry.lastUserMessage = message;
    this.broadcastUpdate(parsed.tabId, entry);
    return true;
  }

  private async sendWebPush(tabId: string, entry: ITabStatusEntry, pushType: 'review' | 'needs-input'): Promise<void> {
    const ws = (await getWorkspaces()).workspaces.find((w) => w.id === entry.workspaceId);
    const config = await getConfig();
    const payload = buildStatusWebPushPayload({
      tabId,
      entry,
      pushType,
      workspaceName: ws?.name ?? '',
      workspaceDir: ws?.directories[0] ?? null,
      soundOnCompleteEnabled: config.soundOnCompleteEnabled,
    });

    const anyDeviceVisible = isAnyDeviceVisible();
    const result = await deliverStatusWebPush({
      anyDeviceVisible,
      payload,
      useRuntimeDefault: this.shouldUseRuntimeStatusDefault(),
      sendRuntime: (input) => getRuntimeSupervisor().sendStatusWebPush(input),
      sendLegacy: (input) => this.webPushActions.send(input),
      recordCounter: recordPerfCounter,
      warn: (message) => log.warn(message),
    });
    if (result.failed > 0) log.warn('Web push send failed: %s', result.failed);
  }
}

export const getStatusManager = (): StatusManager => {
  if (!g.__ptStatusManager) {
    const manager = new StatusManager();
    g.__ptStatusManager = manager;
    setLayoutReconciler({
      reconcileWorkspaceTabs: (wsId, validTabIds) => manager.reconcileWorkspaceTabs(wsId, validTabIds),
      removeWorkspaceTabs: (wsId) => manager.removeWorkspaceTabs(wsId),
    });
  }
  return g.__ptStatusManager;
};

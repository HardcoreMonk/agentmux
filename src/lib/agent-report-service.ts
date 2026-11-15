import { isAgentComposerEmpty } from '@/lib/agent-composer';
import { buildAgentReport } from '@/lib/agent-report';
import { AgentReportQueue } from '@/lib/agent-report-queue';
import { createLogger } from '@/lib/logger';
import { isAgentPanelType } from '@/lib/panel-type';
import { resolveTabRuntimeVersion } from '@/lib/runtime/terminal-mode';
import type { TAgentInputTargetCheck } from '@/lib/workspace-tab-service';
import type { TCliState } from '@/types/timeline';
import type { ITab } from '@/types/terminal';

const log = createLogger('agent-reports');

const MAX_COMPLETION_KEYS = 500;

export const AGENT_REPORT_READ_DELAY_MS = 500;

export type TAgentReportFlushResult =
  | 'delivered'
  | 'waiting'
  | 'paused'
  | 'empty'
  | 'disabled';

export interface IAgentReportDeps {
  isEnabled(): Promise<boolean>;
  findTab(tabId: string): Promise<{ workspaceId: string; tab: ITab } | null>;
  readLastMessage(tab: ITab): Promise<string | null>;
  readCliState(tabId: string): TCliState | null;
  checkTarget(tab: ITab, cliState: TCliState | null): Promise<TAgentInputTargetCheck>;
  readComposerScreen(tab: ITab): Promise<string | null>;
  writeInput(tab: ITab, text: string): Promise<{ followUpEnterSkipped: boolean }>;
  notify(parentTabId: string, kind: 'paused' | 'expired', count: number): void;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface IAgentReportServiceLike {
  onChildStateChange(
    childTabId: string,
    newState: TCliState,
    opts: { silent?: boolean; completionKey?: string | null },
  ): Promise<void>;
  flush(parentTabId: string): Promise<TAgentReportFlushResult>;
  tick(): Promise<void>;
  onPromptSubmit(tabId: string): 'report' | 'human';
  onTabRemoved(tabId: string): void;
  reset(): void;
}

export class AgentReportService implements IAgentReportServiceLike {
  private readonly queue: AgentReportQueue;
  private readonly seenCompletionKeys = new Set<string>();
  private readonly flushingParents = new Set<string>();

  constructor(private readonly deps: IAgentReportDeps, queue?: AgentReportQueue) {
    this.queue = queue ?? new AgentReportQueue();
  }

  private rememberCompletionKey(key: string | null | undefined): boolean {
    if (!key) return true;
    if (this.seenCompletionKeys.has(key)) return false;
    if (this.seenCompletionKeys.size >= MAX_COMPLETION_KEYS) {
      const oldest = this.seenCompletionKeys.values().next().value;
      if (oldest !== undefined) {
        this.seenCompletionKeys.delete(oldest);
      }
    }
    this.seenCompletionKeys.add(key);
    return true;
  }

  async onChildStateChange(
    childTabId: string,
    newState: TCliState,
    opts: { silent?: boolean; completionKey?: string | null },
  ): Promise<void> {
    try {
      if (newState !== 'ready-for-review' && newState !== 'needs-input') return;
      if (!(await this.deps.isEnabled())) {
        this.reset();
        return;
      }
      if (opts.silent) return;
      if (opts.completionKey && this.seenCompletionKeys.has(opts.completionKey)) return;

      const childFound = await this.deps.findTab(childTabId);
      if (!childFound) return;
      const { tab: childTab } = childFound;
      if (!isAgentPanelType(childTab.panelType)) return;
      if (!childTab.createdByTabId) return;
      if (resolveTabRuntimeVersion(childTab) === 2) return;

      const parentTabId = childTab.createdByTabId;
      const parentFound = await this.deps.findTab(parentTabId);
      if (!parentFound) {
        this.queue.forgetTab(parentTabId);
        return;
      }
      const { tab: parentTab } = parentFound;
      if (!isAgentPanelType(parentTab.panelType)) return;
      if (resolveTabRuntimeVersion(parentTab) === 2) return;

      let lastMessage: string | null = null;
      const event = newState === 'needs-input' ? 'blocked' : 'done';
      if (event === 'done') {
        await this.deps.sleep(AGENT_REPORT_READ_DELAY_MS);
        if (!(await this.deps.isEnabled())) {
          this.reset();
          return;
        }
        lastMessage = await this.deps.readLastMessage(childTab);
      }

      if (opts.completionKey && this.seenCompletionKeys.has(opts.completionKey)) return;

      const text = buildAgentReport({
        childTabId: childTab.id,
        childName: childTab.name ? childTab.name : null,
        provider: childTab.panelType,
        event,
        lastMessage,
      });

      this.queue.enqueue(parentTabId, {
        childTabId: childTab.id,
        text,
        enqueuedAt: this.deps.now(),
      });
      this.rememberCompletionKey(opts.completionKey);

      await this.flush(parentTabId);
    } catch (err) {
      log.warn('onChildStateChange failed: %s', err instanceof Error ? err.message : String(err));
    }
  }

  async flush(parentTabId: string): Promise<TAgentReportFlushResult> {
    try {
      // Checked before the config read: StatusManager calls flush on every idle/ready transition of any tab.
      if (!this.queue.hasPending(parentTabId)) return 'empty';
      if (this.flushingParents.has(parentTabId)) return 'waiting';
      this.flushingParents.add(parentTabId);
      try {
        if (!(await this.deps.isEnabled())) {
          this.reset();
          return 'disabled';
        }

        const parentFound = await this.deps.findTab(parentTabId);
        if (!parentFound) {
          this.queue.forgetTab(parentTabId);
          return 'empty';
        }
        const { tab: parentTab } = parentFound;
        if (!isAgentPanelType(parentTab.panelType) || resolveTabRuntimeVersion(parentTab) === 2) {
          this.queue.forgetTab(parentTabId);
          return 'empty';
        }

        if (this.queue.isPaused(parentTabId)) {
          const pausedCount = this.queue.takePauseNotice(parentTabId);
          if (pausedCount !== null) {
            this.deps.notify(parentTabId, 'paused', pausedCount);
          }
          return 'paused';
        }

        const initialBatch = this.queue.peekBatch(parentTabId, this.deps.now());
        if (!initialBatch) return 'waiting';

        const cliState = this.deps.readCliState(parentTabId);
        if (cliState !== 'idle' && cliState !== 'ready-for-review') {
          return 'waiting';
        }

        const targetCheck = await this.deps.checkTarget(parentTab, cliState);
        if (!targetCheck.ok) return 'waiting';

        const ansiScreen = await this.deps.readComposerScreen(parentTab);
        if (ansiScreen === null || isAgentComposerEmpty(parentTab.panelType, ansiScreen) !== true) {
          return 'waiting';
        }

        const currentBatch = this.queue.peekBatch(parentTabId, this.deps.now());
        if (!currentBatch) return 'waiting';

        this.queue.beginDelivery(parentTabId, this.deps.now());
        await this.deps.writeInput(parentTab, currentBatch.text);
        this.queue.commitBatch(parentTabId, currentBatch.count);
        return 'delivered';
      } finally {
        this.flushingParents.delete(parentTabId);
      }
    } catch (err) {
      log.warn('flush failed: %s', err instanceof Error ? err.message : String(err));
      return 'waiting';
    }
  }

  async tick(): Promise<void> {
    try {
      if (this.queue.parentsWithPending().length === 0) return;
      if (!(await this.deps.isEnabled())) {
        this.reset();
        return;
      }
      const expired = this.queue.expire(this.deps.now());
      for (const { parentTabId, count } of expired) {
        this.deps.notify(parentTabId, 'expired', count);
      }
      for (const parentTabId of this.queue.parentsWithPending()) {
        await this.flush(parentTabId);
      }
    } catch (err) {
      log.warn('tick failed: %s', err instanceof Error ? err.message : String(err));
    }
  }

  onPromptSubmit(tabId: string): 'report' | 'human' {
    try {
      return this.queue.onPromptSubmit(tabId, this.deps.now());
    } catch (err) {
      log.warn('onPromptSubmit failed: %s', err instanceof Error ? err.message : String(err));
      return 'human';
    }
  }

  onTabRemoved(tabId: string): void {
    try {
      this.queue.forgetTab(tabId);
      this.flushingParents.delete(tabId);
    } catch (err) {
      log.warn('onTabRemoved failed: %s', err instanceof Error ? err.message : String(err));
    }
  }

  reset(): void {
    this.queue.clear();
    this.seenCompletionKeys.clear();
    this.flushingParents.clear();
  }
}

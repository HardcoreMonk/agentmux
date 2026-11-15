import { combineAgentReports } from '@/lib/agent-report';

export const AGENT_REPORT_MAX_CONSECUTIVE = 5;
export const AGENT_REPORT_TTL_MS = 30 * 60_000;
export const AGENT_REPORT_TURN_START_TIMEOUT_MS = 60_000;

export interface IQueuedAgentReport {
  childTabId: string;
  text: string;
  enqueuedAt: number;
}

interface IParentQueueState {
  pending: IQueuedAgentReport[];
  consecutiveCount: number;
  expectingTurnStartAt: number | null;
  pauseNotified: boolean;
}

export class AgentReportQueue {
  private readonly parents = new Map<string, IParentQueueState>();

  private getOrCreateParent(parentTabId: string): IParentQueueState {
    let state = this.parents.get(parentTabId);
    if (!state) {
      state = {
        pending: [],
        consecutiveCount: 0,
        expectingTurnStartAt: null,
        pauseNotified: false,
      };
      this.parents.set(parentTabId, state);
    }
    return state;
  }

  enqueue(parentTabId: string, report: IQueuedAgentReport): void {
    const state = this.getOrCreateParent(parentTabId);
    state.pending.push({ ...report });
  }

  peekBatch(parentTabId: string, now: number): { text: string; count: number } | null {
    const state = this.parents.get(parentTabId);
    if (!state) return null;

    if (state.expectingTurnStartAt !== null) {
      if (now - state.expectingTurnStartAt >= AGENT_REPORT_TURN_START_TIMEOUT_MS) {
        state.expectingTurnStartAt = null;
      } else {
        return null;
      }
    }

    if (state.pending.length === 0) return null;
    if (state.consecutiveCount >= AGENT_REPORT_MAX_CONSECUTIVE) return null;

    return {
      text: combineAgentReports(state.pending.map((entry) => entry.text)),
      count: state.pending.length,
    };
  }

  commitBatch(parentTabId: string, count: number, now: number): void {
    const state = this.getOrCreateParent(parentTabId);
    state.pending.splice(0, count);
    state.consecutiveCount += 1;
    state.expectingTurnStartAt = now;
  }

  isPaused(parentTabId: string): boolean {
    const state = this.parents.get(parentTabId);
    return (state?.consecutiveCount ?? 0) >= AGENT_REPORT_MAX_CONSECUTIVE;
  }

  takePauseNotice(parentTabId: string): number | null {
    const state = this.parents.get(parentTabId);
    if (
      !state
      || state.consecutiveCount < AGENT_REPORT_MAX_CONSECUTIVE
      || state.pending.length === 0
      || state.pauseNotified
    ) {
      return null;
    }
    state.pauseNotified = true;
    return state.pending.length;
  }

  onPromptSubmit(parentTabId: string, now?: number): 'report' | 'human' {
    const state = this.parents.get(parentTabId);
    if (state?.expectingTurnStartAt !== null && state?.expectingTurnStartAt !== undefined) {
      const timedOut =
        now !== undefined && now - state.expectingTurnStartAt >= AGENT_REPORT_TURN_START_TIMEOUT_MS;
      state.expectingTurnStartAt = null;
      if (!timedOut) {
        return 'report';
      }
    }
    if (state) {
      state.consecutiveCount = 0;
      state.pauseNotified = false;
    }
    return 'human';
  }

  expire(now: number): Array<{ parentTabId: string; count: number }> {
    const expired: Array<{ parentTabId: string; count: number }> = [];
    for (const [parentTabId, state] of this.parents.entries()) {
      if (state.pending.length === 0) continue;
      const kept = state.pending.filter((entry) => now - entry.enqueuedAt <= AGENT_REPORT_TTL_MS);
      const removedCount = state.pending.length - kept.length;
      if (removedCount > 0) {
        state.pending = kept;
        expired.push({ parentTabId, count: removedCount });
      }
    }
    return expired;
  }

  parentsWithPending(): string[] {
    const result: string[] = [];
    for (const [parentTabId, state] of this.parents.entries()) {
      if (state.pending.length > 0) {
        result.push(parentTabId);
      }
    }
    return result;
  }

  forgetTab(tabId: string): void {
    this.parents.delete(tabId);
    for (const state of this.parents.values()) {
      if (state.pending.length > 0) {
        state.pending = state.pending.filter((entry) => entry.childTabId !== tabId);
      }
    }
  }

  clear(): void {
    this.parents.clear();
  }
}

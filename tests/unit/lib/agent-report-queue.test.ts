import { describe, expect, it } from 'vitest';
import {
  AGENT_REPORT_MAX_CONSECUTIVE,
  AGENT_REPORT_TTL_MS,
  AGENT_REPORT_TURN_START_TIMEOUT_MS,
  AgentReportQueue,
} from '@/lib/agent-report-queue';

describe('AgentReportQueue', () => {
  it('combines multiple pending reports in peekBatch and removes them on commitBatch', () => {
    const queue = new AgentReportQueue();
    queue.enqueue('parent-1', {
      childTabId: 'child-1',
      text: '[agentmux report · child-1 (codex) · done]\nFirst done\nreply: agentmux tab send child-1 \'...\'',
      enqueuedAt: 1_000,
    });
    queue.enqueue('parent-1', {
      childTabId: 'child-2',
      text: '[agentmux report · child-2 (claude) · blocked]\nBlocked\nreply: agentmux tab send child-2 \'...\'',
      enqueuedAt: 1_100,
    });

    expect(queue.parentsWithPending()).toEqual(['parent-1']);

    const batch = queue.peekBatch('parent-1', 1_200);
    expect(batch).toEqual({
      text: [
        '[agentmux report · child-1 (codex) · done]\nFirst done\nreply: agentmux tab send child-1 \'...\'',
        '[agentmux report · child-2 (claude) · blocked]\nBlocked\nreply: agentmux tab send child-2 \'...\'',
      ].join('\n\n'),
      count: 2,
    });

    queue.commitBatch('parent-1', 2, 1_200);
    queue.onPromptSubmit('parent-1');

    expect(queue.peekBatch('parent-1', 1_300)).toBeNull();
    expect(queue.parentsWithPending()).toEqual([]);
  });

  it('pauses after five consecutive committed batches and emits takePauseNotice once per pause cycle', () => {
    const queue = new AgentReportQueue();
    let now = 1_000;

    for (let i = 0; i < AGENT_REPORT_MAX_CONSECUTIVE; i += 1) {
      queue.enqueue('parent-1', {
        childTabId: `child-${i}`,
        text: `report-${i}`,
        enqueuedAt: now,
      });
      const batch = queue.peekBatch('parent-1', now);
      expect(batch?.count).toBe(1);
      queue.commitBatch('parent-1', 1, now);
      expect(queue.onPromptSubmit('parent-1')).toBe('report');
      now += 100;
    }

    expect(queue.isPaused('parent-1')).toBe(true);
    expect(queue.takePauseNotice('parent-1')).toBeNull();

    queue.enqueue('parent-1', {
      childTabId: 'child-6',
      text: 'report-6',
      enqueuedAt: now,
    });
    queue.enqueue('parent-1', {
      childTabId: 'child-7',
      text: 'report-7',
      enqueuedAt: now + 10,
    });

    expect(queue.peekBatch('parent-1', now + 20)).toBeNull();
    expect(queue.takePauseNotice('parent-1')).toBe(2);
    expect(queue.takePauseNotice('parent-1')).toBeNull();
  });

  it('distinguishes report prompt-submit from human prompt-submit and resets pause on human input', () => {
    const queue = new AgentReportQueue();
    let now = 1_000;

    for (let i = 0; i < AGENT_REPORT_MAX_CONSECUTIVE; i += 1) {
      queue.enqueue('parent-1', {
        childTabId: 'child-1',
        text: `report-${i}`,
        enqueuedAt: now,
      });
      queue.commitBatch('parent-1', 1, now);
      expect(queue.onPromptSubmit('parent-1')).toBe('report');
      now += 100;
    }

    queue.enqueue('parent-1', {
      childTabId: 'child-1',
      text: 'report-paused',
      enqueuedAt: now,
    });
    expect(queue.isPaused('parent-1')).toBe(true);
    expect(queue.takePauseNotice('parent-1')).toBe(1);

    expect(queue.onPromptSubmit('parent-1')).toBe('human');
    expect(queue.isPaused('parent-1')).toBe(false);
    expect(queue.peekBatch('parent-1', now + 50)).toEqual({
      text: 'report-paused',
      count: 1,
    });

    for (let i = 0; i < AGENT_REPORT_MAX_CONSECUTIVE; i += 1) {
      if (i > 0) {
        queue.enqueue('parent-1', {
          childTabId: 'child-1',
          text: `cycle2-${i}`,
          enqueuedAt: now,
        });
      }
      queue.commitBatch('parent-1', 1, now);
      expect(queue.onPromptSubmit('parent-1')).toBe('report');
      now += 100;
    }

    queue.enqueue('parent-1', {
      childTabId: 'child-1',
      text: 'cycle2-paused',
      enqueuedAt: now,
    });
    expect(queue.isPaused('parent-1')).toBe(true);
    expect(queue.takePauseNotice('parent-1')).toBe(1);
  });

  it('next report waits for the turn to start until onPromptSubmit or the 60s timeout', () => {
    const queue = new AgentReportQueue();
    const t = 10_000;

    queue.enqueue('parent-1', {
      childTabId: 'child-1',
      text: 'first',
      enqueuedAt: t,
    });
    queue.commitBatch('parent-1', 1, t);

    queue.enqueue('parent-1', {
      childTabId: 'child-2',
      text: 'second',
      enqueuedAt: t + 100,
    });

    expect(queue.peekBatch('parent-1', t + AGENT_REPORT_TURN_START_TIMEOUT_MS - 1)).toBeNull();

    expect(queue.onPromptSubmit('parent-1')).toBe('report');
    expect(queue.peekBatch('parent-1', t + 500)).toEqual({
      text: 'second',
      count: 1,
    });

    queue.commitBatch('parent-1', 1, t + 500);
    queue.enqueue('parent-1', {
      childTabId: 'child-3',
      text: 'third',
      enqueuedAt: t + 600,
    });

    expect(
      queue.peekBatch('parent-1', t + 500 + AGENT_REPORT_TURN_START_TIMEOUT_MS - 1),
    ).toBeNull();
    expect(
      queue.peekBatch('parent-1', t + 500 + AGENT_REPORT_TURN_START_TIMEOUT_MS),
    ).toEqual({
      text: 'third',
      count: 1,
    });
    expect(queue.onPromptSubmit('parent-1')).toBe('human');
  });

  it('expires reports older than 30 minutes and returns expired counts per parent', () => {
    const queue = new AgentReportQueue();
    const t0 = 5_000;

    queue.enqueue('parent-1', {
      childTabId: 'child-1',
      text: 'old-1',
      enqueuedAt: t0,
    });
    queue.enqueue('parent-1', {
      childTabId: 'child-2',
      text: 'fresh-1',
      enqueuedAt: t0 + 1_000,
    });
    queue.enqueue('parent-2', {
      childTabId: 'child-3',
      text: 'old-2',
      enqueuedAt: t0,
    });

    expect(queue.expire(t0 + AGENT_REPORT_TTL_MS)).toEqual([]);

    const expired = queue.expire(t0 + AGENT_REPORT_TTL_MS + 1);
    expect(expired).toEqual([
      { parentTabId: 'parent-1', count: 1 },
      { parentTabId: 'parent-2', count: 1 },
    ]);

    expect(queue.peekBatch('parent-1', t0 + AGENT_REPORT_TTL_MS + 1)).toEqual({
      text: 'fresh-1',
      count: 1,
    });
    expect(queue.peekBatch('parent-2', t0 + AGENT_REPORT_TTL_MS + 1)).toBeNull();
  });

  it('forgetTab removes a tab both as a child across parents and as a parent', () => {
    const queue = new AgentReportQueue();
    queue.enqueue('parent-1', {
      childTabId: 'child-a',
      text: 'from-a',
      enqueuedAt: 100,
    });
    queue.enqueue('parent-1', {
      childTabId: 'child-b',
      text: 'from-b',
      enqueuedAt: 200,
    });
    queue.enqueue('parent-2', {
      childTabId: 'child-a',
      text: 'from-a-to-p2',
      enqueuedAt: 300,
    });

    queue.forgetTab('child-a');

    expect(queue.peekBatch('parent-1', 400)).toEqual({
      text: 'from-b',
      count: 1,
    });
    expect(queue.peekBatch('parent-2', 400)).toBeNull();

    queue.forgetTab('parent-1');
    expect(queue.peekBatch('parent-1', 400)).toBeNull();
    expect(queue.parentsWithPending()).toEqual([]);

    queue.enqueue('parent-3', {
      childTabId: 'child-c',
      text: 'from-c',
      enqueuedAt: 500,
    });
    queue.clear();
    expect(queue.parentsWithPending()).toEqual([]);
  });
});

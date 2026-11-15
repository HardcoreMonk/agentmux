import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';

import { CODEX_RESPONSE_SUPPRESS_MS, CODEX_TUI_READY_TIMEOUT_MS, createCodexScreenTracker } from '@/lib/codex-screen-tracker';
import { CODEX_TUI_READY_SETTLE_MS } from '@/lib/codex-screen';

const fixture = (name: string): string =>
  fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/codex-screens', `${name}.txt`), 'utf-8');

describe('codex screen tracker', () => {
  let now: number;
  let tracker: ReturnType<typeof createCodexScreenTracker>;

  beforeEach(() => {
    now = 10_000;
    tracker = createCodexScreenTracker({ now: () => now });
  });

  it('reads the hook review and marks the screen blocking', () => {
    const snapshot = tracker.observe('tab-a', fixture('hooks-review'));

    expect(snapshot.hooksReview?.changedCount).toBe(3);
    expect(snapshot.blocking).toBe(true);
    expect(snapshot.tuiReady).toBe(false);
  });

  it('keeps the card hidden for a second after a response, then shows it again', () => {
    tracker.observe('tab-a', fixture('hooks-review'));
    tracker.markResponded('tab-a');

    now += CODEX_RESPONSE_SUPPRESS_MS - 1;
    expect(tracker.observe('tab-a', fixture('hooks-review')).hooksReview).toBeNull();

    now += 1;
    expect(tracker.observe('tab-a', fixture('hooks-review')).hooksReview).not.toBeNull();
  });

  it('still shows the next update state right after answering the prompt', () => {
    tracker.observe('tab-a', fixture('update-prompt'));
    tracker.markResponded('tab-a');

    expect(tracker.observe('tab-a', fixture('update-prompt')).updatePrompt).toBeNull();
    expect(tracker.observe('tab-a', fixture('update-updating')).updatePrompt?.status).toBe('updating');
  });

  it('reads the update prompt', () => {
    expect(tracker.observe('tab-a', fixture('update-prompt')).updatePrompt?.status).toBe('prompt');
  });

  it('reports a ready TUI', () => {
    const snapshot = tracker.observe('tab-a', fixture('tui-ready'));

    expect(snapshot).toMatchObject({ hooksReview: null, updatePrompt: null, blocking: false, tuiReady: true });
  });

  it('has no pending check for a scope that is not starting', () => {
    tracker.startScope('tab-a', false);
    tracker.observe('tab-a', fixture('tui-ready'));

    expect(tracker.nextCheckAt('tab-a')).toBeNull();
  });

  it('drops the earlier response when the scope changes', () => {
    tracker.observe('tab-a', fixture('hooks-review'));
    tracker.markResponded('tab-a');

    expect(tracker.observe('tab-b', fixture('hooks-review')).hooksReview).not.toBeNull();
    expect(tracker.tick('tab-b', fixture('tui-ready')).hooksReview).toBeNull();
  });

  it('startScope clears a response left from the same scope', () => {
    tracker.observe('tab-a', fixture('hooks-review'));
    tracker.markResponded('tab-a');
    tracker.startScope('tab-a', true);

    expect(tracker.observe('tab-a', fixture('hooks-review')).hooksReview).not.toBeNull();
  });

  describe('tuiReady while starting', () => {
    beforeEach(() => tracker.startScope('tab-a', true));

    it('waits for the settle time even when the first read already shows the input box', () => {
      tracker.startScope('tab-b', true);
      expect(tracker.observe('tab-b', fixture('tui-ready')).tuiReady).toBe(false);
      now += CODEX_TUI_READY_SETTLE_MS;
      expect(tracker.tick('tab-b', fixture('tui-ready')).tuiReady).toBe(true);
    });

    it('is false on an empty screen', () => {
      expect(tracker.observe('tab-a', '').tuiReady).toBe(false);
    });

    it('is not ready at first sight of the input box and reports when to check again', () => {
      expect(tracker.nextCheckAt('tab-a')).toBeNull();
      expect(tracker.observe('tab-a', fixture('tui-ready')).tuiReady).toBe(false);
      expect(tracker.nextCheckAt('tab-a')).toBe(now + CODEX_TUI_READY_SETTLE_MS);

      now += CODEX_TUI_READY_SETTLE_MS;
      expect(tracker.tick('tab-a', fixture('tui-ready')).tuiReady).toBe(true);
      expect(tracker.nextCheckAt('tab-a')).toBeNull();
    });

    it('drops the wait when a review screen covers the input box, then counts again', () => {
      const start = now;
      tracker.observe('tab-a', fixture('tui-ready'));
      now = start + 500;
      expect(tracker.observe('tab-a', fixture('hooks-review')).tuiReady).toBe(false);
      expect(tracker.nextCheckAt('tab-a')).toBeNull();

      now = start + 1000;
      tracker.observe('tab-a', fixture('tui-ready'));
      expect(tracker.nextCheckAt('tab-a')).toBe(start + 1000 + CODEX_TUI_READY_SETTLE_MS);
      now = start + 1000 + CODEX_TUI_READY_SETTLE_MS - 1;
      expect(tracker.tick('tab-a', fixture('tui-ready')).tuiReady).toBe(false);
      now += 1;
      expect(tracker.tick('tab-a', fixture('tui-ready')).tuiReady).toBe(true);
    });

    it('stays latched on a later plain screen', () => {
      tracker.observe('tab-a', fixture('tui-ready'));
      now += CODEX_TUI_READY_SETTLE_MS;
      expect(tracker.tick('tab-a', fixture('tui-ready')).tuiReady).toBe(true);
      expect(tracker.observe('tab-a', 'working...').tuiReady).toBe(true);
    });

    it('turns true after the timeout with no screen data', () => {
      now += CODEX_TUI_READY_TIMEOUT_MS - 1;
      expect(tracker.tick('tab-a', '').tuiReady).toBe(false);
      now += 1;
      expect(tracker.tick('tab-a', '').tuiReady).toBe(true);
    });

    it('stays locked after the timeout on an update prompt or a review screen', () => {
      now += CODEX_TUI_READY_TIMEOUT_MS;
      expect(tracker.tick('tab-a', fixture('update-prompt')).tuiReady).toBe(false);
      expect(tracker.tick('tab-a', fixture('hooks-review')).tuiReady).toBe(false);
    });
  });

  it('treats a screen of an already running session as ready unless it is blocking', () => {
    tracker.startScope('tab-a', false);

    expect(tracker.observe('tab-a', 'Do you want to continue?\n› 1. Yes\n  2. No').tuiReady).toBe(true);
    expect(tracker.observe('tab-a', fixture('hooks-review')).tuiReady).toBe(false);
  });
});

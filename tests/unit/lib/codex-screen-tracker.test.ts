import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';

import { CODEX_RESPONSE_SUPPRESS_MS, createCodexScreenTracker } from '@/lib/codex-screen-tracker';

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
});

import { describe, expect, it } from 'vitest';

import { reduceCodexState, reduceHookState } from '@/lib/status-state-machine';

describe('reduceHookState', () => {
  it('keeps a running Codex turn busy when the session-start hook arrives after prompt-submit', () => {
    // Codex runs its SessionStart hook on the first turn, after UserPromptSubmit.
    const decision = reduceHookState({
      currentState: 'busy',
      eventName: 'session-start',
      providerId: 'codex',
      statusBehavior: {
        watchJsonlWhenBound: true,
        deferStopHookUntilJsonlIdle: true,
        sessionStartMayArriveMidTurn: true,
      },
    });

    expect(decision).toMatchObject({ nextState: 'busy', changed: false, deferStopHook: false });
  });

  it('moves a busy Claude tab to idle on session-start when sessionStartMayArriveMidTurn is not set', () => {
    const decision = reduceHookState({
      currentState: 'busy',
      eventName: 'session-start',
      providerId: 'claude',
      statusBehavior: {
        watchJsonlWhenBound: false,
        deferStopHookUntilJsonlIdle: false,
      },
    });

    expect(decision).toMatchObject({ nextState: 'idle', changed: true, deferStopHook: false });
  });

  it('still moves a waiting tab to idle on session-start', () => {
    for (const currentState of ['unknown', 'inactive', 'ready-for-review'] as const) {
      expect(reduceHookState({ currentState, eventName: 'session-start', providerId: 'claude' }))
        .toMatchObject({ nextState: 'idle', changed: true });
    }
  });

  it('keeps provider stop hooks out of direct ready-for-review transitions when the adapter requests JSONL verification', () => {
    const decision = reduceHookState({
      currentState: 'busy',
      eventName: 'stop',
      providerId: 'codex',
      statusBehavior: {
        watchJsonlWhenBound: true,
        deferStopHookUntilJsonlIdle: true,
      },
    });

    expect(decision).toMatchObject({
      nextState: 'busy',
      changed: false,
      deferStopHook: true,
    });
  });

  it('allows non-Codex stop hooks to move to ready-for-review', () => {
    const decision = reduceHookState({
      currentState: 'busy',
      eventName: 'stop',
      providerId: null,
    });

    expect(decision).toMatchObject({
      nextState: 'ready-for-review',
      changed: true,
      deferStopHook: false,
    });
  });

  it('does not transition cancelled tabs from hook events', () => {
    const decision = reduceHookState({
      currentState: 'cancelled',
      eventName: 'stop',
      providerId: 'codex',
    });

    expect(decision).toMatchObject({
      nextState: 'cancelled',
      changed: false,
      deferStopHook: false,
    });
  });
});

describe('reduceCodexState', () => {
  it('moves active completed Codex turns to ready-for-review with notification enabled', () => {
    const decision = reduceCodexState({
      currentState: 'busy',
      running: true,
      hasJsonlPath: true,
      idle: true,
      hasCompletionSnippet: true,
    });

    expect(decision).toEqual({
      nextState: 'ready-for-review',
      changed: true,
      silent: false,
      skipHistory: false,
    });
  });

  it('keeps incomplete Codex turns busy even when JSONL has assistant text', () => {
    const decision = reduceCodexState({
      currentState: 'ready-for-review',
      running: true,
      hasJsonlPath: true,
      idle: false,
      hasCompletionSnippet: true,
    });

    expect(decision).toEqual({
      nextState: 'busy',
      changed: true,
      silent: false,
    });
  });

  it('does not send review notifications for restored completed turns', () => {
    const decision = reduceCodexState({
      currentState: 'idle',
      running: true,
      hasJsonlPath: true,
      idle: true,
      hasCompletionSnippet: true,
    });

    expect(decision).toEqual({
      nextState: 'ready-for-review',
      changed: true,
      silent: true,
      skipHistory: true,
    });
  });

  it('moves unknown tabs without a bound JSONL to busy silently', () => {
    const decision = reduceCodexState({
      currentState: 'unknown',
      running: true,
      hasJsonlPath: false,
      idle: false,
      hasCompletionSnippet: false,
    });

    expect(decision).toEqual({
      nextState: 'busy',
      changed: true,
      silent: true,
    });
  });

  it('treats a running Codex tab without a JSONL as idle silently when composerIdle is true', () => {
    expect(reduceCodexState({
      currentState: 'busy',
      running: true,
      hasJsonlPath: false,
      idle: false,
      hasCompletionSnippet: false,
      composerIdle: true,
    })).toEqual({
      nextState: 'idle',
      changed: true,
      silent: true,
      skipHistory: true,
    });

    expect(reduceCodexState({
      currentState: 'unknown',
      running: true,
      hasJsonlPath: false,
      idle: false,
      hasCompletionSnippet: false,
      composerIdle: true,
    })).toEqual({
      nextState: 'idle',
      changed: true,
      silent: true,
      skipHistory: true,
    });

    expect(reduceCodexState({
      currentState: 'idle',
      running: true,
      hasJsonlPath: false,
      idle: false,
      hasCompletionSnippet: false,
      composerIdle: true,
    })).toEqual({
      nextState: 'idle',
      changed: false,
    });
  });

  it('keeps a running Codex tab without a JSONL busy when composerIdle is false', () => {
    expect(reduceCodexState({
      currentState: 'idle',
      running: true,
      hasJsonlPath: false,
      idle: false,
      hasCompletionSnippet: false,
      composerIdle: false,
    })).toEqual({
      nextState: 'busy',
      changed: true,
      silent: false,
    });
  });

  it('keeps pending input tabs in needs-input while Codex is waiting', () => {
    const decision = reduceCodexState({
      currentState: 'needs-input',
      running: true,
      hasJsonlPath: true,
      idle: false,
      hasCompletionSnippet: false,
    });

    expect(decision).toEqual({
      nextState: 'needs-input',
      changed: false,
    });
  });
});

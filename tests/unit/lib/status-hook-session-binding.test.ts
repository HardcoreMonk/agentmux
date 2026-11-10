import { describe, expect, it } from 'vitest';
import { decideHookSessionRebind, decideNeedsInputJsonlExit } from '@/lib/status/hook-session-binding';
import type { IAgentProviderStatusBehavior } from '@/lib/providers';

const behavior = (overrides: Partial<IAgentProviderStatusBehavior> = {}): IAgentProviderStatusBehavior => ({
  watchJsonlWhenBound: true,
  deferStopHookUntilJsonlIdle: false,
  reconcileStateFromJsonl: false,
  recoverPaneInput: false,
  bindSessionFromHook: true,
  leaveNeedsInputOnJsonlGrowth: true,
  ...overrides,
});

describe('decideHookSessionRebind', () => {
  it('rebinds when the hook session differs from the current one', () => {
    expect(decideHookSessionRebind({
      behavior: behavior(),
      currentSessionId: 'old',
      hookSessionId: 'new',
      transcriptPath: '/home/test/.claude/projects/x/new.jsonl',
    })).toEqual({ rebind: true, sessionId: 'new', jsonlPath: '/home/test/.claude/projects/x/new.jsonl' });
  });

  it('returns a null jsonl path when the transcript path is missing', () => {
    expect(decideHookSessionRebind({
      behavior: behavior(),
      currentSessionId: null,
      hookSessionId: 'new',
    })).toEqual({ rebind: true, sessionId: 'new', jsonlPath: null });
  });

  it('does not rebind for the same session id', () => {
    expect(decideHookSessionRebind({
      behavior: behavior(),
      currentSessionId: 'same',
      hookSessionId: 'same',
    })).toEqual({ rebind: false });
  });

  it('does not rebind without a hook session id', () => {
    expect(decideHookSessionRebind({ behavior: behavior(), currentSessionId: 'a' })).toEqual({ rebind: false });
  });

  it('does not rebind when the provider flag is off or the provider is unknown', () => {
    const input = { currentSessionId: 'old', hookSessionId: 'new' };
    expect(decideHookSessionRebind({ ...input, behavior: behavior({ bindSessionFromHook: false }) })).toEqual({ rebind: false });
    expect(decideHookSessionRebind({ ...input, behavior: null })).toEqual({ rebind: false });
  });
});

describe('decideNeedsInputJsonlExit', () => {
  const input = {
    behavior: behavior(),
    cliState: 'needs-input' as const,
    needsInputSince: 1_000,
    lastEntryTs: 2_000,
    interrupted: false,
  };

  it('returns busy when the transcript grew after needs-input', () => {
    expect(decideNeedsInputJsonlExit(input)).toBe('busy');
  });

  it('returns idle when the newest entry is an interrupt', () => {
    expect(decideNeedsInputJsonlExit({ ...input, interrupted: true })).toBe('idle');
  });

  it('returns none when the transcript has not grown past needs-input', () => {
    expect(decideNeedsInputJsonlExit({ ...input, lastEntryTs: 1_000 })).toBe('none');
    expect(decideNeedsInputJsonlExit({ ...input, lastEntryTs: null })).toBe('none');
  });

  it('returns none outside needs-input or when the flag is off', () => {
    expect(decideNeedsInputJsonlExit({ ...input, cliState: 'busy' })).toBe('none');
    expect(decideNeedsInputJsonlExit({
      ...input,
      behavior: behavior({ leaveNeedsInputOnJsonlGrowth: false }),
    })).toBe('none');
    expect(decideNeedsInputJsonlExit({ ...input, behavior: null })).toBe('none');
  });

  it('returns none when the needs-input time is unknown', () => {
    expect(decideNeedsInputJsonlExit({ ...input, needsInputSince: null })).toBe('none');
  });
});

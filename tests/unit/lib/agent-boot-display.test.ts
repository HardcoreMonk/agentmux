import { describe, expect, it } from 'vitest';
import { isAgentBootActive, resolveAgentBootDisplay } from '@/lib/agent-boot-display';
import type { TCliState } from '@/types/timeline';

const base = {
  view: 'check' as const,
  agentProcess: null as boolean | null,
  hasEntries: false,
  trustPrompt: false,
  bypassPrompt: false,
  startingPrompt: false,
  cliState: undefined as TCliState | undefined,
  elapsedMs: 0,
};

describe('resolveAgentBootDisplay', () => {
  it('returns trust even after the agent process is detected', () => {
    expect(resolveAgentBootDisplay({
      ...base, view: 'timeline', agentProcess: true, trustPrompt: true,
    })).toBe('trust');
  });

  it('returns bypass in the check view when a bypass prompt is shown', () => {
    expect(resolveAgentBootDisplay({ ...base, bypassPrompt: true })).toBe('bypass');
  });

  it('returns starting in the check view without a prompt', () => {
    expect(resolveAgentBootDisplay(base)).toBe('starting');
  });

  it('returns waiting-session for an empty timeline with a running agent', () => {
    expect(resolveAgentBootDisplay({
      ...base, view: 'timeline', agentProcess: true,
    })).toBe('waiting-session');
  });

  it('returns recover after 60 seconds without entries', () => {
    expect(resolveAgentBootDisplay({ ...base, elapsedMs: 60_000 })).toBe('recover');
    expect(resolveAgentBootDisplay({
      ...base, view: 'timeline', agentProcess: true, elapsedMs: 61_000,
    })).toBe('recover');
    expect(resolveAgentBootDisplay({ ...base, elapsedMs: 59_999 })).toBe('starting');
  });

  it('returns null once the timeline has entries', () => {
    expect(resolveAgentBootDisplay({
      ...base, view: 'timeline', agentProcess: true, hasEntries: true, elapsedMs: 90_000,
    })).toBeNull();
  });

  it('returns null in the session list and for a stopped agent', () => {
    expect(resolveAgentBootDisplay({ ...base, view: 'session-list' })).toBeNull();
    expect(resolveAgentBootDisplay({ ...base, view: 'timeline', agentProcess: false })).toBeNull();
  });

  it('keeps the timeline for a ready agent without entries', () => {
    const ready = { ...base, view: 'timeline' as const, agentProcess: true, cliState: 'idle' as const };
    expect(resolveAgentBootDisplay(ready)).toBeNull();
    expect(resolveAgentBootDisplay({ ...ready, elapsedMs: 60_000 })).toBeNull();
    expect(isAgentBootActive(ready)).toBe(false);
  });

  it('waits only while the agent has not reported a state', () => {
    const waiting = { ...base, view: 'timeline' as const, agentProcess: true };
    expect(resolveAgentBootDisplay({ ...waiting, cliState: 'inactive' })).toBe('waiting-session');
    expect(resolveAgentBootDisplay({ ...waiting, cliState: 'unknown', elapsedMs: 60_000 })).toBe('recover');
    expect(isAgentBootActive({ ...waiting, cliState: 'unknown' })).toBe(true);
  });

  it('offers recovery at once for a non-bypass startup prompt', () => {
    expect(resolveAgentBootDisplay({ ...base, startingPrompt: true })).toBe('recover');
  });
});

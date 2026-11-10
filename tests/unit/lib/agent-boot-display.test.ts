import { describe, expect, it } from 'vitest';
import { resolveAgentBootDisplay } from '@/lib/agent-boot-display';

const base = {
  view: 'check' as const,
  agentProcess: null as boolean | null,
  hasEntries: false,
  trustPrompt: false,
  bypassPrompt: false,
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
});

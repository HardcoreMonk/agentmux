import { describe, expect, it, vi } from 'vitest';
import { resolveSessionCwd } from '@/lib/session-cwd';

describe('resolveSessionCwd', () => {
  it('queries getTerminalSessionInfo for rtv2- sessions when Runtime v2 is enabled', async () => {
    const hasSession = vi.fn();
    const getSessionCwd = vi.fn();
    const getTerminalSessionInfo = vi.fn().mockResolvedValue({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      exists: true,
      cwd: '/tmp/repo-a',
      command: 'zsh',
      pid: 4242,
      startedAt: 1700000000000,
      metadataSource: 'terminal-runtime' as const,
    });

    const result = await resolveSessionCwd('rtv2-ws-a-pane-b-tab-c', {
      hasSession,
      getSessionCwd,
      getTerminalSessionInfo,
      isRuntimeV2Enabled: () => true,
    });

    expect(result).toEqual({ exists: true, cwd: '/tmp/repo-a' });
    expect(getTerminalSessionInfo).toHaveBeenCalledTimes(1);
    expect(getTerminalSessionInfo).toHaveBeenCalledWith({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
    });
    expect(hasSession).not.toHaveBeenCalled();
    expect(getSessionCwd).not.toHaveBeenCalled();
  });

  it('does not call getTerminalSessionInfo for rtv2- sessions when Runtime v2 is disabled', async () => {
    const hasSession = vi.fn();
    const getSessionCwd = vi.fn();
    const getTerminalSessionInfo = vi.fn();

    const result = await resolveSessionCwd('rtv2-ws-a-pane-b-tab-c', {
      hasSession,
      getSessionCwd,
      getTerminalSessionInfo,
      isRuntimeV2Enabled: () => false,
    });

    expect(result).toEqual({ exists: false, cwd: null });
    expect(getTerminalSessionInfo).not.toHaveBeenCalled();
    expect(hasSession).not.toHaveBeenCalled();
    expect(getSessionCwd).not.toHaveBeenCalled();
  });

  it('uses legacy tmux helpers for non-rtv2 session names', async () => {
    const hasSession = vi.fn().mockResolvedValue(true);
    const getSessionCwd = vi.fn().mockResolvedValue('/tmp/legacy-repo');
    const getTerminalSessionInfo = vi.fn();

    const result = await resolveSessionCwd('pt-ws-a-pane-b-tab-c', {
      hasSession,
      getSessionCwd,
      getTerminalSessionInfo,
      isRuntimeV2Enabled: () => true,
    });

    expect(result).toEqual({ exists: true, cwd: '/tmp/legacy-repo' });
    expect(hasSession).toHaveBeenCalledTimes(1);
    expect(hasSession).toHaveBeenCalledWith('pt-ws-a-pane-b-tab-c');
    expect(getSessionCwd).toHaveBeenCalledTimes(1);
    expect(getSessionCwd).toHaveBeenCalledWith('pt-ws-a-pane-b-tab-c');
    expect(getTerminalSessionInfo).not.toHaveBeenCalled();
  });

  it('returns exists: false when supervisor returns null or exists: false', async () => {
    const hasSession = vi.fn();
    const getSessionCwd = vi.fn();
    const getTerminalSessionInfo = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
      sessionName: 'rtv2-ws-a-pane-b-tab-c',
      exists: false,
      cwd: '/tmp/stale',
      command: null,
      pid: null,
      startedAt: null,
      metadataSource: 'unavailable' as const,
    });

    const first = await resolveSessionCwd('rtv2-ws-a-pane-b-tab-c', {
      hasSession,
      getSessionCwd,
      getTerminalSessionInfo,
      isRuntimeV2Enabled: () => true,
    });
    expect(first).toEqual({ exists: false, cwd: null });

    const second = await resolveSessionCwd('rtv2-ws-a-pane-b-tab-c', {
      hasSession,
      getSessionCwd,
      getTerminalSessionInfo,
      isRuntimeV2Enabled: () => true,
    });
    expect(second).toEqual({ exists: false, cwd: null });
  });

  it('returns exists: false for a malformed rtv2- name without asking the supervisor', async () => {
    const getTerminalSessionInfo = vi.fn();

    const result = await resolveSessionCwd('rtv2-Bad_Name', {
      hasSession: vi.fn(),
      getSessionCwd: vi.fn(),
      getTerminalSessionInfo,
      isRuntimeV2Enabled: () => true,
    });

    expect(result).toEqual({ exists: false, cwd: null });
    expect(getTerminalSessionInfo).not.toHaveBeenCalled();
  });
});

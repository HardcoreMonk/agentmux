import { describe, expect, it, vi } from 'vitest';

import {
  StatusPollRecoveryService,
  recoverStatusPollPaneInput,
  resolveStatusPollUpdateAction,
  shouldCheckStatusPollBusyStuck,
} from '@/lib/status/poll-recovery-service';

describe('status poll recovery service', () => {
  it('checks busy-stuck only for stale busy entries with a last event', () => {
    expect(shouldCheckStatusPollBusyStuck({
      currentState: 'busy',
      lastEventAt: 1_000,
      now: 12_000,
      busyStuckMs: 10_000,
    })).toBe(true);
    expect(shouldCheckStatusPollBusyStuck({
      currentState: 'busy',
      lastEventAt: 9_000,
      now: 12_000,
      busyStuckMs: 10_000,
    })).toBe(false);
    expect(shouldCheckStatusPollBusyStuck({
      currentState: 'idle',
      lastEventAt: 1_000,
      now: 12_000,
      busyStuckMs: 10_000,
    })).toBe(false);
  });

  it('forces idle when stale busy entry has no running agent process', async () => {
    const forceIdle = vi.fn();
    const service = new StatusPollRecoveryService({ busyStuckMs: 10_000 });

    const recovered = await service.recoverBusyStuck({
      currentState: 'busy',
      lastEventAt: 1_000,
      now: 12_000,
      paneInfo: {
        command: 'codex',
        path: '/repo',
        pid: 123,
        windowActivity: 1,
      },
      provider: {
        isAgentRunning: vi.fn(async () => false),
      },
      getChildPids: vi.fn(async () => [456]),
      forceIdle,
    });

    expect(recovered).toBe(true);
    expect(forceIdle).toHaveBeenCalledTimes(1);
  });

  it('does not force idle when stale busy entry still has a running agent', async () => {
    const forceIdle = vi.fn();
    const service = new StatusPollRecoveryService({ busyStuckMs: 10_000 });

    const recovered = await service.recoverBusyStuck({
      currentState: 'busy',
      lastEventAt: 1_000,
      now: 12_000,
      paneInfo: {
        command: 'codex',
        path: '/repo',
        pid: 123,
        windowActivity: 1,
      },
      provider: {
        isAgentRunning: vi.fn(async () => true),
      },
      getChildPids: vi.fn(async () => [456]),
      forceIdle,
    });

    expect(recovered).toBe(false);
    expect(forceIdle).not.toHaveBeenCalled();
  });

  it('runs pane recovery in pending-then-interrupted order', async () => {
    const recoverPending = vi.fn(async () => ({ recovered: false }));
    const recoverInterrupted = vi.fn(async () => ({ recovered: true }));

    await expect(recoverStatusPollPaneInput({
      recoverPaneInput: true,
      running: true,
      recoverPending,
      recoverInterrupted,
    })).resolves.toEqual({ recovered: true });
    expect(recoverPending).toHaveBeenCalledTimes(1);
    expect(recoverInterrupted).toHaveBeenCalledTimes(1);
  });

  it('skips interrupted recovery when pending recovery succeeds or the provider does not recover pane input', async () => {
    const recoverPending = vi.fn(async () => ({ recovered: true }));
    const recoverInterrupted = vi.fn(async () => ({ recovered: true }));

    await expect(recoverStatusPollPaneInput({
      recoverPaneInput: true,
      running: true,
      recoverPending,
      recoverInterrupted,
    })).resolves.toEqual({ recovered: true });
    expect(recoverInterrupted).not.toHaveBeenCalled();

    await expect(recoverStatusPollPaneInput({
      recoverPaneInput: false,
      running: true,
      recoverPending,
      recoverInterrupted,
    })).resolves.toEqual({ recovered: false });
  });

  it('does not touch the pane when the provider does not recover pane input', async () => {
    const recoverPending = vi.fn();
    const recoverInterrupted = vi.fn();

    await expect(recoverStatusPollPaneInput({
      recoverPaneInput: false,
      running: true,
      recoverPending,
      recoverInterrupted,
    })).resolves.toEqual({ recovered: false });
    expect(recoverPending).not.toHaveBeenCalled();
    expect(recoverInterrupted).not.toHaveBeenCalled();
  });

  it('resolves post-recovery broadcast action', () => {
    expect(resolveStatusPollUpdateAction({
      paneRecovered: true,
      shouldBroadcastUpdate: true,
      metadataChanged: true,
      codexStateChanged: true,
    })).toBe('count-only');
    expect(resolveStatusPollUpdateAction({
      paneRecovered: false,
      shouldBroadcastUpdate: true,
      metadataChanged: false,
      codexStateChanged: false,
    })).toBe('broadcast');
    expect(resolveStatusPollUpdateAction({
      paneRecovered: false,
      shouldBroadcastUpdate: false,
      metadataChanged: false,
      codexStateChanged: false,
    })).toBe('none');
  });
});

import { describe, expect, it } from 'vitest';
import {
  parseRuntimeEventPayload,
  parseRuntimeReplyPayload,
} from '@/lib/runtime/ipc';

const data = (ts: number) => ({
  ts,
  five_hour: { used_percentage: 10, resets_at: 100 },
  seven_day: null,
});

describe('per-provider rate limits IPC schemas', () => {
  it('parses a rate-limits update event carrying providerId', () => {
    expect(parseRuntimeEventPayload('status.rate-limits-update', {
      providerId: 'codex',
      data: data(1),
    })).toEqual({ providerId: 'codex', data: data(1) });
  });

  it('rejects a rate-limits update event without a known providerId', () => {
    expect(() => parseRuntimeEventPayload('status.rate-limits-update', { data: data(1) })).toThrow();
    expect(() => parseRuntimeEventPayload('status.rate-limits-update', {
      providerId: 'future-agent',
      data: data(1),
    })).toThrow();
  });

  it('parses a live sync reply with a per-provider rate limits record', () => {
    const reply = { tabs: {}, rateLimits: { codex: data(1), claude: data(2) } };
    expect(parseRuntimeReplyPayload('status.live-request-sync', reply)).toEqual(reply);
    expect(parseRuntimeReplyPayload('status.live-request-sync', { tabs: {}, rateLimits: { claude: data(2) } }))
      .toEqual({ tabs: {}, rateLimits: { claude: data(2) } });
  });

  it('parses a status.sync event with a per-provider rate limits record', () => {
    const payload = { tabs: {}, rateLimits: { claude: data(2) } };
    expect(parseRuntimeEventPayload('status.sync', payload)).toEqual(payload);
  });
});

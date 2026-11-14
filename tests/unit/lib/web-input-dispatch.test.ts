import { describe, expect, it } from 'vitest';
import { decideWebInputDispatch } from '@/lib/web-input-dispatch';

const base = {
  mode: 'input' as const,
  connected: true,
  sendBlocked: false,
  hasText: true,
  hasAttachments: false,
};

describe('decideWebInputDispatch', () => {
  it('sends text or attachments when nothing blocks', () => {
    expect(decideWebInputDispatch(base)).toBe('send');
    expect(decideWebInputDispatch({ ...base, hasText: false, hasAttachments: true })).toBe('send');
  });

  it('blocks a text-only or an attachment-only send while sendBlocked', () => {
    expect(decideWebInputDispatch({ ...base, sendBlocked: true })).toBe('blocked');
    expect(decideWebInputDispatch({ ...base, sendBlocked: true, hasText: false, hasAttachments: true })).toBe('blocked');
  });

  it('reports a lost connection and a disabled mode', () => {
    expect(decideWebInputDispatch({ ...base, connected: false })).toBe('disconnected');
    expect(decideWebInputDispatch({ ...base, mode: 'disabled' })).toBe('disabled');
  });

  it('reports an empty input', () => {
    expect(decideWebInputDispatch({ ...base, hasText: false })).toBe('empty');
  });

  it('blocks a send in interrupt mode while sendBlocked', () => {
    expect(decideWebInputDispatch({ ...base, mode: 'interrupt', sendBlocked: true })).toBe('blocked');
  });
});

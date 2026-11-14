import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isCodexHookFingerprintTrusted: vi.fn(async () => true),
}));

vi.mock('@/lib/codex-hook-trust', () => ({
  isCodexHookFingerprintTrusted: mocks.isCodexHookFingerprintTrusted,
}));

import handler from '@/pages/api/status/codex-hook-trust';

const request = async (method: string) => {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
    setHeader: vi.fn(),
  } as unknown as NextApiResponse;
  await handler({ method, headers: {} } as unknown as NextApiRequest, res);
  return res;
};

describe('codex hook trust api', () => {
  beforeEach(() => mocks.isCodexHookFingerprintTrusted.mockReset());

  it.each([true, false])('returns trusted: %s on GET', async (trusted) => {
    mocks.isCodexHookFingerprintTrusted.mockResolvedValue(trusted);
    const res = await request('GET');

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ trusted });
  });

  it('rejects other methods with 405 and an Allow header', async () => {
    const res = await request('POST');

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.setHeader).toHaveBeenCalledWith('Allow', 'GET');
    expect(mocks.isCodexHookFingerprintTrusted).not.toHaveBeenCalled();
  });
});

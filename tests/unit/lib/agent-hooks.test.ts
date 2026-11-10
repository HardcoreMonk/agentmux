import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/cli-token', () => ({ getCliToken: () => 'test-token' }));

import { createAgentHookCapability, verifyAgentHookCapability } from '@/lib/agent-hooks';

describe('agent hook capability', () => {
  const session = 'pt-ws-a-pane-b-tab-c';
  const ttl = 30 * 24 * 60 * 60 * 1000;

  it('signs capabilities for one tab and session with an expiry', () => {
    const capability = createAgentHookCapability('tab-1', session, 1_000);
    expect(verifyAgentHookCapability(capability, session, 2_000)).toMatchObject({ v: 1, tabId: 'tab-1' });
    expect(verifyAgentHookCapability(capability, 'pt-ws-other', 2_000)).toBeNull();
    expect(verifyAgentHookCapability(capability, session, 1_000 + ttl)).toBeNull();
    expect(verifyAgentHookCapability(`${capability}.extra`, session, 2_000)).toBeNull();
  });

  it('keeps the wire format stable', () => {
    const capability = createAgentHookCapability('tab-1', session, 1_000);
    expect(JSON.parse(Buffer.from(capability.split('.')[0], 'base64url').toString())).toEqual({
      v: 1,
      tabId: 'tab-1',
      sessionName: session,
      expiresAt: 1_000 + ttl,
    });
  });

  it('matches the golden capability produced by the pre-provider Codex implementation', () => {
    const golden = 'eyJ2IjoxLCJ0YWJJZCI6InRhYi0xIiwic2Vzc2lvbk5hbWUiOiJwdC13cy1hLXBhbmUtYi10YWItYyIsImV4cGlyZXNBdCI6MjU5MjAwMTAwMH0.hV9VT9o3VK3-KDdPXEjwR30-7psbcWErbV0thQGaebc';
    expect(createAgentHookCapability('tab-1', session, 1_000)).toBe(golden);
    expect(verifyAgentHookCapability(golden, session, 2_000)).toEqual({
      v: 1,
      tabId: 'tab-1',
      sessionName: session,
      expiresAt: 1_000 + ttl,
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  dispatchSendToAgent,
  listenSendToAgent,
  SEND_TO_AGENT_EVENT,
  type ISendToAgentDetail,
} from '@/lib/send-to-agent-event';

describe('send-to-agent-event', () => {
  it('delivers the detail to listeners and stops after unsubscribe', () => {
    const target = new EventTarget();
    const received: ISendToAgentDetail[] = [];
    const unsubscribe = listenSendToAgent(target, (detail) => {
      received.push(detail);
    });

    const detail: ISendToAgentDetail = { paneId: 'pane-1', tabId: 'tab-1', text: 'Explain this diff' };
    dispatchSendToAgent(target, detail);
    expect(received).toEqual([detail]);

    unsubscribe();
    dispatchSendToAgent(target, { paneId: 'pane-1', tabId: 'tab-1', text: 'Second' });
    expect(received).toHaveLength(1);
    expect(SEND_TO_AGENT_EVENT).toBe('agentmux:send-to-agent');
  });

  it('invokes handler with CustomEvent detail', () => {
    const target = new EventTarget();
    const spy = vi.fn();
    const off = listenSendToAgent(target, spy);
    dispatchSendToAgent(target, { paneId: 'p', tabId: 't', text: 'hi' });
    expect(spy).toHaveBeenCalledWith({ paneId: 'p', tabId: 't', text: 'hi' });
    off();
  });
});

export const SEND_TO_AGENT_EVENT = 'agentmux:send-to-agent';

export interface ISendToAgentDetail {
  paneId: string;
  tabId: string;
  text: string;
}

export const dispatchSendToAgent = (target: EventTarget, detail: ISendToAgentDetail): void => {
  target.dispatchEvent(new CustomEvent<ISendToAgentDetail>(SEND_TO_AGENT_EVENT, { detail }));
};

export const listenSendToAgent = (
  target: EventTarget,
  handler: (detail: ISendToAgentDetail) => void,
): (() => void) => {
  const listener: EventListener = (event) => {
    const detail = (event as CustomEvent<ISendToAgentDetail>).detail;
    if (detail) handler(detail);
  };
  target.addEventListener(SEND_TO_AGENT_EVENT, listener);
  return () => {
    target.removeEventListener(SEND_TO_AGENT_EVENT, listener);
  };
};

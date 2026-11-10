import type { TCliState } from '@/types/timeline';
import type { TEventName } from '@/types/status';
import type { TAgentHookStatusBehavior } from '@/lib/providers/types';

export interface IStateDecision {
  nextState: TCliState;
  changed: boolean;
  silent?: boolean;
  skipHistory?: boolean;
}

export interface IHookStateDecision extends IStateDecision {
  deferStopHook: boolean;
}

export interface IHookStateInput {
  currentState: TCliState;
  eventName: TEventName;
  providerId?: string | null;
  statusBehavior?: TAgentHookStatusBehavior | null;
}

export interface ICodexStateInput {
  currentState: TCliState;
  running: boolean;
  hasJsonlPath: boolean;
  idle: boolean;
  hasCompletionSnippet: boolean;
}

const unchanged = (currentState: TCliState): IStateDecision => ({
  nextState: currentState,
  changed: false,
});

const hookEventTargetState = (eventName: TEventName): TCliState => {
  switch (eventName) {
    case 'session-start': return 'idle';
    case 'prompt-submit': return 'busy';
    case 'notification': return 'needs-input';
    case 'stop': return 'ready-for-review';
    case 'interrupt': return 'idle';
  }
};

export const reduceHookState = ({
  currentState,
  eventName,
  statusBehavior,
}: IHookStateInput): IHookStateDecision => {
  if (currentState === 'cancelled') {
    return {
      nextState: currentState,
      changed: false,
      deferStopHook: false,
    };
  }

  if (eventName === 'stop' && statusBehavior?.deferStopHookUntilJsonlIdle) {
    return {
      nextState: currentState,
      changed: false,
      deferStopHook: true,
    };
  }

  const nextState = hookEventTargetState(eventName);
  return {
    nextState,
    changed: currentState !== nextState,
    deferStopHook: false,
  };
};

export const reduceCodexState = ({
  currentState,
  running,
  hasJsonlPath,
  idle,
  hasCompletionSnippet,
}: ICodexStateInput): IStateDecision => {
  if (!running) {
    if (currentState === 'busy' || currentState === 'unknown' || currentState === 'inactive') {
      return { nextState: 'idle', changed: true, silent: true, skipHistory: true };
    }
    return unchanged(currentState);
  }

  if (!hasJsonlPath) {
    if (currentState === 'needs-input') return unchanged(currentState);
    if (currentState !== 'busy') {
      return {
        nextState: 'busy',
        changed: true,
        silent: currentState !== 'idle',
      };
    }
    return unchanged(currentState);
  }

  if (idle && hasCompletionSnippet) {
    if (currentState !== 'ready-for-review') {
      const fromActiveTurn = currentState === 'busy' || currentState === 'needs-input';
      return {
        nextState: 'ready-for-review',
        changed: true,
        silent: !fromActiveTurn,
        skipHistory: !fromActiveTurn,
      };
    }
    return unchanged(currentState);
  }

  if (currentState === 'needs-input' && !idle) {
    return unchanged(currentState);
  }

  if (!idle) {
    if (currentState !== 'busy') {
      return {
        nextState: 'busy',
        changed: true,
        silent: currentState !== 'idle' && currentState !== 'ready-for-review',
      };
    }
    return unchanged(currentState);
  }

  if (currentState === 'busy' || currentState === 'unknown' || currentState === 'inactive') {
    return { nextState: 'idle', changed: true, silent: true, skipHistory: true };
  }

  return unchanged(currentState);
};

import type { ICurrentAction } from '@/types/status';
import type { TCliState } from '@/types/timeline';

interface IStatusJsonlWatchInput {
  cliState: TCliState;
  watchJsonlWhenBound: boolean;
}

interface ISyntheticJsonlInterruptInput {
  currentState: TCliState;
  interrupted: boolean;
  lastEntryTs: number | null;
  lastInterruptTs?: number | null;
  lastEventAt?: number | null;
}

interface IDelayedJsonlInputRecoveryInput {
  currentState: TCliState;
  currentAction?: ICurrentAction | null;
}

export const shouldKeepStatusJsonlWatch = ({
  cliState,
  watchJsonlWhenBound,
}: IStatusJsonlWatchInput): boolean => watchJsonlWhenBound
  || cliState === 'busy'
  || cliState === 'needs-input'
  || cliState === 'unknown'
  || cliState === 'ready-for-review';

export const shouldEmitSyntheticJsonlInterrupt = ({
  currentState,
  interrupted,
  lastEntryTs,
  lastInterruptTs,
  lastEventAt,
}: ISyntheticJsonlInterruptInput): boolean => interrupted
  && currentState === 'busy'
  && lastEntryTs !== null
  && lastEntryTs > (lastInterruptTs ?? 0)
  && lastEntryTs > (lastEventAt ?? 0);

export const shouldScheduleDelayedJsonlInputRecovery = ({
  currentState,
  currentAction,
}: IDelayedJsonlInputRecoveryInput): boolean => currentState === 'busy' && !!currentAction?.toolName;

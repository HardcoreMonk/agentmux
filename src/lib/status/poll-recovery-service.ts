import type { IAgentProvider } from '@/lib/providers';
import type { IPaneInfo } from '@/lib/tmux';
import type { TCliState } from '@/types/timeline';

interface IStatusPollBusyStuckInput {
  currentState: TCliState;
  lastEventAt?: number | null;
  now: number;
  busyStuckMs: number;
}

interface IRecoverStatusPollBusyStuckInput {
  currentState: TCliState;
  lastEventAt?: number | null;
  now: number;
  paneInfo?: IPaneInfo;
  provider?: Pick<IAgentProvider, 'isAgentRunning'> | null;
  getChildPids: (paneInfo: IPaneInfo | undefined) => Promise<number[]>;
  forceIdle: () => void;
}

interface IStatusPollRecoveryServiceOptions {
  busyStuckMs: number;
}

interface IStatusPollPaneRecoveryResult {
  recovered: boolean;
}

interface IRecoverStatusPollPaneInput {
  recoverPaneInput: boolean;
  running: boolean;
  recoverPending: () => Promise<IStatusPollPaneRecoveryResult>;
  recoverInterrupted: () => Promise<IStatusPollPaneRecoveryResult>;
}

interface IResolveStatusPollUpdateActionInput {
  paneRecovered: boolean;
  shouldBroadcastUpdate: boolean;
  metadataChanged: boolean;
  codexStateChanged: boolean;
}

export type TStatusPollUpdateAction = 'none' | 'broadcast' | 'count-only';

export const shouldCheckStatusPollBusyStuck = ({
  currentState,
  lastEventAt,
  now,
  busyStuckMs,
}: IStatusPollBusyStuckInput): boolean =>
  currentState === 'busy'
  && lastEventAt != null
  && now - lastEventAt > busyStuckMs;

export const recoverStatusPollPaneInput = async ({
  recoverPaneInput,
  running,
  recoverPending,
  recoverInterrupted,
}: IRecoverStatusPollPaneInput): Promise<IStatusPollPaneRecoveryResult> => {
  if (!recoverPaneInput || !running) {
    return { recovered: false };
  }

  const pending = await recoverPending();
  if (pending.recovered) return pending;
  return recoverInterrupted();
};

export const resolveStatusPollUpdateAction = ({
  paneRecovered,
  shouldBroadcastUpdate,
  metadataChanged,
  codexStateChanged,
}: IResolveStatusPollUpdateActionInput): TStatusPollUpdateAction => {
  if (paneRecovered) return 'count-only';
  if (shouldBroadcastUpdate || metadataChanged || codexStateChanged) return 'broadcast';
  return 'none';
};

export class StatusPollRecoveryService {
  constructor(private readonly options: IStatusPollRecoveryServiceOptions) {}

  async recoverBusyStuck({
    currentState,
    lastEventAt,
    now,
    paneInfo,
    provider,
    getChildPids,
    forceIdle,
  }: IRecoverStatusPollBusyStuckInput): Promise<boolean> {
    if (!shouldCheckStatusPollBusyStuck({
      currentState,
      lastEventAt,
      now,
      busyStuckMs: this.options.busyStuckMs,
    })) {
      return false;
    }

    const childPids = await getChildPids(paneInfo);
    const agentRunning = paneInfo?.pid && provider
      ? await provider.isAgentRunning(paneInfo.pid, childPids)
      : false;
    if (agentRunning) return false;

    forceIdle();
    return true;
  }
}

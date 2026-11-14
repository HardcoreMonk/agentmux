import type { TWebInputMode } from '@/hooks/use-web-input';

export type TWebInputDispatch = 'send' | 'blocked' | 'disconnected' | 'disabled' | 'empty';

interface IDecideWebInputDispatchInput {
  mode: TWebInputMode;
  connected: boolean;
  // The agent is still starting or shows a blocking screen, so a prompt would land in the wrong place.
  sendBlocked: boolean;
  hasText: boolean;
  hasAttachments: boolean;
}

// One decision for the plain send and the attachment send. Interrupt is never blocked.
export const decideWebInputDispatch = ({
  mode,
  connected,
  sendBlocked,
  hasText,
  hasAttachments,
}: IDecideWebInputDispatchInput): TWebInputDispatch => {
  if (mode === 'disabled') return 'disabled';
  if (!connected) return 'disconnected';
  if (!hasText && !hasAttachments) return 'empty';
  if (sendBlocked && mode !== 'interrupt') return 'blocked';
  return 'send';
};

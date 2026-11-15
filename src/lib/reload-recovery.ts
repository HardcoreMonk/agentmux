export const RELOAD_RECOVERY_FAILURES = 5;

export interface IReloadRecoveryInput {
  isMobile: boolean;
  visible: boolean;
  failures: number;
}

export const shouldOfferReloadRecovery = (input: IReloadRecoveryInput): boolean =>
  input.isMobile && input.visible && input.failures >= RELOAD_RECOVERY_FAILURES;

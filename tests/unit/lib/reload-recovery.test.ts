import { describe, expect, it } from 'vitest';
import {
  RELOAD_RECOVERY_FAILURES,
  shouldOfferReloadRecovery,
} from '@/lib/reload-recovery';

describe('shouldOfferReloadRecovery', () => {
  it('requires at least RELOAD_RECOVERY_FAILURES (5) consecutive failures', () => {
    expect(RELOAD_RECOVERY_FAILURES).toBe(5);
    expect(shouldOfferReloadRecovery({ isMobile: true, visible: true, failures: 4 })).toBe(false);
    expect(shouldOfferReloadRecovery({ isMobile: true, visible: true, failures: 5 })).toBe(true);
    expect(shouldOfferReloadRecovery({ isMobile: true, visible: true, failures: 8 })).toBe(true);
  });

  it('returns false when not on a mobile device', () => {
    expect(shouldOfferReloadRecovery({ isMobile: false, visible: true, failures: 5 })).toBe(false);
  });

  it('returns false when the page is not visible', () => {
    expect(shouldOfferReloadRecovery({ isMobile: true, visible: false, failures: 5 })).toBe(false);
  });
});

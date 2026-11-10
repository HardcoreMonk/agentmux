import { create } from 'zustand';
import type { IRateLimitsData, TRateLimitsByProvider } from '@/types/status';
import type { TAgentPanelType } from '@/types/terminal';

interface IRateLimitsStore {
  byProvider: TRateLimitsByProvider;
  setProviderData: (providerId: TAgentPanelType, data: IRateLimitsData) => void;
}

const useRateLimitsStore = create<IRateLimitsStore>((set) => ({
  byProvider: {},
  setProviderData: (providerId, data) =>
    set((state) => ({ byProvider: { ...state.byProvider, [providerId]: data } })),
}));

export default useRateLimitsStore;

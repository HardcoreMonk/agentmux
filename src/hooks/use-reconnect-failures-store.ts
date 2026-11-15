import { create } from 'zustand';

interface IReconnectFailuresState {
  failures: Record<string, number>;
  report: (key: string, count: number) => void;
  clear: (key: string) => void;
}

export const selectMaxReconnectFailures = (s: { failures: Record<string, number> }): number => {
  const values = Object.values(s.failures);
  return values.length === 0 ? 0 : Math.max(...values);
};

const removeKey = (
  failures: Record<string, number>,
  key: string,
): Record<string, number> => {
  if (!(key in failures)) return failures;
  const { [key]: _removed, ...rest } = failures;
  return rest;
};

const useReconnectFailuresStore = create<IReconnectFailuresState>((set) => ({
  failures: {},
  report: (key, count) => {
    set((state) => {
      if (count <= 0) {
        const next = removeKey(state.failures, key);
        return next === state.failures ? state : { failures: next };
      }
      if (state.failures[key] === count) return state;
      return { failures: { ...state.failures, [key]: count } };
    });
  },
  clear: (key) => {
    set((state) => {
      const next = removeKey(state.failures, key);
      return next === state.failures ? state : { failures: next };
    });
  },
}));

export default useReconnectFailuresStore;

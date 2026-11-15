import { useSyncExternalStore, useCallback } from 'react';

const DEFAULT_BREAKPOINT = 768;

export const buildMobileMediaQuery = (breakpoint: number): string =>
  `(max-width: ${breakpoint - 1}px), (hover: none) and (pointer: coarse)`;

const useIsMobile = (breakpoint: number = DEFAULT_BREAKPOINT): boolean => {
  const query = buildMobileMediaQuery(breakpoint);

  const subscribe = useCallback(
    (callback: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', callback);
      return () => mql.removeEventListener('change', callback);
    },
    [query],
  );

  const getSnapshot = useCallback(
    () => window.matchMedia(query).matches,
    [query],
  );

  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
};

export default useIsMobile;

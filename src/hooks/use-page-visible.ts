import { useSyncExternalStore } from 'react';

const subscribe = (onStoreChange: () => void): (() => void) => {
  if (typeof document === 'undefined') return () => {};
  document.addEventListener('visibilitychange', onStoreChange);
  return () => {
    document.removeEventListener('visibilitychange', onStoreChange);
  };
};

const getSnapshot = (): boolean => {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'hidden';
};

const getServerSnapshot = (): boolean => true;

const usePageVisible = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

export default usePageVisible;

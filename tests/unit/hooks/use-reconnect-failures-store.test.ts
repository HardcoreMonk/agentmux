import { beforeEach, describe, expect, it } from 'vitest';
import useReconnectFailuresStore, {
  selectMaxReconnectFailures,
} from '@/hooks/use-reconnect-failures-store';

describe('useReconnectFailuresStore', () => {
  beforeEach(() => {
    useReconnectFailuresStore.setState({ failures: {} });
  });

  it('returns 0 when no failures are reported', () => {
    expect(selectMaxReconnectFailures(useReconnectFailuresStore.getState())).toBe(0);
  });

  it('tracks the maximum across multiple keys and removes keys on clear', () => {
    const store = useReconnectFailuresStore.getState();
    store.report('timeline:a', 3);
    store.report('timeline:b', 6);
    expect(selectMaxReconnectFailures(useReconnectFailuresStore.getState())).toBe(6);

    store.clear('timeline:b');
    expect(selectMaxReconnectFailures(useReconnectFailuresStore.getState())).toBe(3);
    expect('timeline:b' in useReconnectFailuresStore.getState().failures).toBe(false);
  });

  it('clear on connect resets the key before subsequent failures', () => {
    const store = useReconnectFailuresStore.getState();
    store.report('timeline:k', 4);
    store.clear('timeline:k');
    store.report('timeline:k', 1);
    expect(selectMaxReconnectFailures(useReconnectFailuresStore.getState())).toBe(1);
  });

  it('removes the key when report is called with 0', () => {
    const store = useReconnectFailuresStore.getState();
    store.report('timeline:k', 4);
    store.report('timeline:k', 0);
    expect('timeline:k' in useReconnectFailuresStore.getState().failures).toBe(false);
    expect(selectMaxReconnectFailures(useReconnectFailuresStore.getState())).toBe(0);
  });
});

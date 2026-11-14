import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WEB_INPUT_FOLLOW_UP_ENTER_DELAY_MS,
  buildWebInputFrames,
} from '@/hooks/use-web-input';

const { setValueState, toastError } = vi.hoisted(() => ({ setValueState: vi.fn(), toastError: vi.fn() }));

// The hook runs outside a renderer here, so the React hooks are plain pass-throughs.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, setValueState],
  useRef: (init: unknown) => ({ current: init }),
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
}));
vi.mock('sonner', () => ({ toast: { error: toastError } }));
vi.mock('@/lib/i18n', () => ({ t: (ns: string, key: string) => `${ns}.${key}` }));

describe('use-web-input payloads', () => {
  it('submits a single-line Codex prompt as bracketed paste with Enter in the same frame', () => {
    expect(buildWebInputFrames('에페메라 0.3.3 정리')).toEqual([
      { data: '\x1b[200~에페메라 0.3.3 정리\x1b[201~\r' },
      { data: '\r', delayMs: WEB_INPUT_FOLLOW_UP_ENTER_DELAY_MS },
    ]);
  });

  it('preserves multiline prompts inside the bracketed paste frame', () => {
    expect(buildWebInputFrames('첫 줄\n둘째 줄')).toEqual([
      { data: '\x1b[200~첫 줄\n둘째 줄\x1b[201~\r' },
      { data: '\r', delayMs: WEB_INPUT_FOLLOW_UP_ENTER_DELAY_MS },
    ]);
  });
});

describe('useWebInput send while sendBlocked', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('does not send and keeps the input value', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'hello', setItem: vi.fn(), removeItem: vi.fn() });
    const { default: useWebInput } = await import('@/hooks/use-web-input');
    const sendStdin = vi.fn();
    const onMessageSent = vi.fn();

    const result = useWebInput('idle', sendStdin, true, {
      tabId: 'tab-a',
      panelType: 'codex',
      sendBlocked: true,
      onMessageSent,
    });
    result.send();

    expect(sendStdin).not.toHaveBeenCalled();
    expect(onMessageSent).not.toHaveBeenCalled();
    expect(setValueState).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('terminal.inputNotReady');
  });

  it('holds the send in interrupt mode (busy) but still sends the interrupt key', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'hello', setItem: vi.fn(), removeItem: vi.fn() });
    const { default: useWebInput } = await import('@/hooks/use-web-input');
    const sendStdin = vi.fn();

    const result = useWebInput('busy', sendStdin, true, { tabId: 'tab-a', panelType: 'codex', sendBlocked: true });
    expect(result.mode).toBe('interrupt');
    result.send();

    expect(sendStdin).not.toHaveBeenCalled();
    expect(setValueState).not.toHaveBeenCalled();

    result.interrupt();
    expect(sendStdin).toHaveBeenCalledTimes(1);
  });
});

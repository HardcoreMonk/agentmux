import {
  CODEX_TUI_READY_SETTLE_MS,
  isCodexBlockingScreen,
  isCodexTuiReadyContent,
  matchCodexHooksReview,
  matchCodexUpdatePrompt,
  type ICodexHooksReviewInfo,
  type ICodexUpdatePromptInfo,
  type TCodexUpdateStatus,
} from '@/lib/codex-screen';

export interface ICodexScreenSnapshot {
  hooksReview: ICodexHooksReviewInfo | null;
  updatePrompt: ICodexUpdatePromptInfo | null;
  blocking: boolean;
  tuiReady: boolean;
}

export const CODEX_RESPONSE_SUPPRESS_MS = 1000;
// A starting Codex counts as ready after this long even if its screen never looked ready.
export const CODEX_TUI_READY_TIMEOUT_MS = 30_000;

interface IResponded {
  at: number;
  hooksReview: boolean;
  updateStatus: TCodexUpdateStatus | null;
}

interface IScopeState {
  scopeKey: string;
  starting: boolean;
  startedAt: number;
  readyLatched: boolean;
  // When the input box was first seen in the current unbroken run; the latch waits CODEX_TUI_READY_SETTLE_MS from it.
  readySince: number | null;
  last: ICodexScreenSnapshot | null;
  responded: IResponded | null;
}

export const createCodexScreenTracker = (opts: { now: () => number }) => {
  let state: IScopeState | null = null;

  const begin = (scopeKey: string, starting: boolean): IScopeState => ({
    scopeKey,
    starting,
    startedAt: opts.now(),
    readyLatched: false,
    readySince: null,
    last: null,
    responded: null,
  });

  const enter = (scopeKey: string, starting: boolean): IScopeState => {
    if (state?.scopeKey !== scopeKey) state = begin(scopeKey, starting);
    return state;
  };

  const evaluate = (scopeKey: string, text: string): ICodexScreenSnapshot => {
    const current = enter(scopeKey, false);
    const hooksReview = matchCodexHooksReview(text);
    const updatePrompt = matchCodexUpdatePrompt(text);
    const responded = current.responded;
    const suppressing = responded !== null && opts.now() - responded.at < CODEX_RESPONSE_SUPPRESS_MS;
    const blocking = isCodexBlockingScreen(text);
    let tuiReady = false;
    if (blocking) {
      current.readySince = null;
    } else if (!current.starting) {
      tuiReady = true;
    } else {
      if (isCodexTuiReadyContent(text)) {
        current.readySince ??= opts.now();
        if (opts.now() - current.readySince >= CODEX_TUI_READY_SETTLE_MS) current.readyLatched = true;
      } else {
        current.readySince = null;
      }
      tuiReady = current.readyLatched || opts.now() - current.startedAt >= CODEX_TUI_READY_TIMEOUT_MS;
    }
    const snapshot: ICodexScreenSnapshot = {
      hooksReview: suppressing && responded.hooksReview ? null : hooksReview,
      updatePrompt: suppressing && updatePrompt?.status === responded.updateStatus ? null : updatePrompt,
      blocking,
      tuiReady,
    };
    current.last = { hooksReview, updatePrompt, blocking: snapshot.blocking, tuiReady: snapshot.tuiReady };
    return snapshot;
  };

  return {
    startScope(scopeKey: string, starting: boolean): void {
      state = begin(scopeKey, starting);
    },
    observe: evaluate,
    markResponded(scopeKey: string): void {
      const current = enter(scopeKey, false);
      current.responded = {
        at: opts.now(),
        hooksReview: current.last?.hooksReview != null,
        updateStatus: current.last?.updatePrompt?.status ?? null,
      };
    },
    tick: evaluate,
    // When a pending latch is due, so the caller can read the screen then even if no more data arrives.
    nextCheckAt(scopeKey: string): number | null {
      if (state?.scopeKey !== scopeKey || !state.starting || state.readyLatched || state.readySince === null) return null;
      return state.readySince + CODEX_TUI_READY_SETTLE_MS;
    },
  };
};

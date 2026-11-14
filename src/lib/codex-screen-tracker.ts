import {
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
    if (!blocking) {
      if (!current.starting) {
        tuiReady = true;
      } else {
        if (isCodexTuiReadyContent(text)) current.readyLatched = true;
        tuiReady = current.readyLatched || opts.now() - current.startedAt >= CODEX_TUI_READY_TIMEOUT_MS;
      }
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
  };
};

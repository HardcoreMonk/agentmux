import { matchTrustPrompt } from '@/lib/trust-prompt-detector';

export type TAgentStartupScreen = 'trust' | 'codex-update' | 'codex-hooks-review';

// Codex update prompt. 0.167.0 (`tui/src/update_prompt.rs`) draws "Update available · <current> → <latest>";
// older builds drew "Update available! <current> -> <latest>". Both offer "Update now (runs `<cmd>`)",
// "Skip" and "Skip until next version", and the default highlight is "Update now". Whitespace may wrap.
const CODEX_UPDATE_TITLE_RE = /Update\s+available\s*(?:!|·)/i;
const CODEX_UPDATE_ACTION_RE = /Update\s+now|Skip\s+until\s+next\s+version/i;
// Codex 0.167.0 hook review: "Hooks need review" with "Trust all and continue",
// "Continue without trusting (hooks won't run)".
const CODEX_HOOKS_REVIEW_TITLE_RE = /Hooks\s+need\s+review/i;
const CODEX_HOOKS_REVIEW_TRUST_RE = /Trust\s+all\s+and\s+continue/i;

export const matchAgentStartupScreen = (screen: string): TAgentStartupScreen | null => {
  if (matchTrustPrompt(screen)) return 'trust';
  if (CODEX_UPDATE_TITLE_RE.test(screen) && CODEX_UPDATE_ACTION_RE.test(screen)) return 'codex-update';
  if (CODEX_HOOKS_REVIEW_TITLE_RE.test(screen) && CODEX_HOOKS_REVIEW_TRUST_RE.test(screen)) return 'codex-hooks-review';
  return null;
};

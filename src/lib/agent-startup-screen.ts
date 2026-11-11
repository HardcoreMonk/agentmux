import { matchTrustPrompt } from '@/lib/trust-prompt-detector';

export type TAgentStartupScreen = 'trust' | 'codex-update' | 'codex-hooks-review';

// Codex 0.167.0 update prompt: "Update available!" with "Update now", "Skip", "Skip until next version".
const CODEX_UPDATE_TITLE = 'Update available!';
const CODEX_UPDATE_ACTION = 'Update now';
// Codex 0.167.0 hook review: "Hooks need review" with "Trust all and continue",
// "Continue without trusting (hooks won't run)".
const CODEX_HOOKS_REVIEW_TITLE_RE = /Hooks\s+need\s+review/i;
const CODEX_HOOKS_REVIEW_TRUST_RE = /Trust\s+all\s+and\s+continue/i;

export const matchAgentStartupScreen = (screen: string): TAgentStartupScreen | null => {
  if (matchTrustPrompt(screen)) return 'trust';
  if (screen.includes(CODEX_UPDATE_TITLE) && screen.includes(CODEX_UPDATE_ACTION)) return 'codex-update';
  if (CODEX_HOOKS_REVIEW_TITLE_RE.test(screen) && CODEX_HOOKS_REVIEW_TRUST_RE.test(screen)) return 'codex-hooks-review';
  return null;
};

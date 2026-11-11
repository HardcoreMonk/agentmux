import { matchTrustPrompt } from '@/lib/trust-prompt-detector';

export type TAgentStartupScreen = 'trust' | 'codex-update';

// Codex 0.167.0 update prompt: "Update available!" with "Update now", "Skip", "Skip until next version".
const CODEX_UPDATE_TITLE = 'Update available!';
const CODEX_UPDATE_ACTION = 'Update now';

export const matchAgentStartupScreen = (screen: string): TAgentStartupScreen | null => {
  if (matchTrustPrompt(screen)) return 'trust';
  if (screen.includes(CODEX_UPDATE_TITLE) && screen.includes(CODEX_UPDATE_ACTION)) return 'codex-update';
  return null;
};

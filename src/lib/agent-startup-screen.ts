import { isCodexFolderAccessScreen, matchCodexHooksReview, matchCodexUpdatePrompt } from '@/lib/codex-screen';
import { matchTrustPrompt } from '@/lib/trust-prompt-detector';

export type TAgentStartupScreen = 'trust' | 'codex-update' | 'codex-hooks-review';

export const matchAgentStartupScreen = (screen: string): TAgentStartupScreen | null => {
  if (matchTrustPrompt(screen) || isCodexFolderAccessScreen(screen)) return 'trust';
  const updateStatus = matchCodexUpdatePrompt(screen)?.status;
  if (updateStatus === 'prompt' || updateStatus === 'updating') return 'codex-update';
  if (matchCodexHooksReview(screen)) return 'codex-hooks-review';
  return null;
};

export interface ICodexSessionHookSpec {
  event: 'SessionStart' | 'UserPromptSubmit' | 'Stop';
  hookEvent: string;
  matcher?: string;
}

export const CODEX_SESSION_HOOKS: readonly ICodexSessionHookSpec[] = [
  { event: 'SessionStart', hookEvent: 'session-start', matcher: 'startup|resume' },
  { event: 'UserPromptSubmit', hookEvent: 'prompt-submit' },
  { event: 'Stop', hookEvent: 'stop' },
];

export const CODEX_SESSION_HOOK_COUNT = CODEX_SESSION_HOOKS.length;
export const CODEX_HOOK_SESSION_ENV = 'AMUX_HOOK_SESSION';
export const CODEX_HOOK_CAPABILITY_ENV = 'AMUX_HOOK_CAPABILITY';
export const CODEX_HOOK_FINGERPRINT_ENV = 'AMUX_HOOK_FINGERPRINT';

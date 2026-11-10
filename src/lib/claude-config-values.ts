// Client-safe Claude config values shared by the API validation and the settings dialog.
// Do not import Node or server-only modules here.
export const CLAUDE_PERMISSION_MODES = ['acceptEdits', 'auto', 'bypassPermissions', 'manual', 'dontAsk', 'plan'] as const;
export type TClaudePermissionMode = typeof CLAUDE_PERMISSION_MODES[number];

export const isClaudePermissionMode = (value: unknown): value is TClaudePermissionMode =>
  typeof value === 'string' && (CLAUDE_PERMISSION_MODES as readonly string[]).includes(value);

export const CLAUDE_MODEL_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export const isValidClaudeModel = (value: unknown): boolean =>
  value === null || (typeof value === 'string' && CLAUDE_MODEL_RE.test(value));

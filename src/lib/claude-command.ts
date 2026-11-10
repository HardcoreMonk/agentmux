import { shQuote } from '@/lib/statusline-script';

export const CLAUDE_PERMISSION_MODES = ['acceptEdits', 'auto', 'bypassPermissions', 'manual', 'dontAsk', 'plan'] as const;
export type TClaudePermissionMode = typeof CLAUDE_PERMISSION_MODES[number];

export const isClaudePermissionMode = (value: unknown): value is TClaudePermissionMode =>
  typeof value === 'string' && (CLAUDE_PERMISSION_MODES as readonly string[]).includes(value);

export interface IClaudeCommandOptions {
  settingsPath: string;
  model?: string;
  permissionMode?: TClaudePermissionMode;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isValidClaudeSessionId = (id: unknown): id is string =>
  typeof id === 'string' && UUID_RE.test(id);

const buildCommand = (
  sessionFlag: '--session-id' | '--resume',
  sessionId: string,
  { settingsPath, model, permissionMode }: IClaudeCommandOptions,
): string => {
  if (!isValidClaudeSessionId(sessionId)) throw new Error('Invalid Claude session id');
  const parts = ['claude', '--settings', shQuote(settingsPath), sessionFlag, sessionId];
  if (model) parts.push('--model', shQuote(model));
  if (permissionMode) parts.push('--permission-mode', permissionMode);
  return parts.join(' ');
};

export const buildClaudeLaunchCommand = (sessionId: string, options: IClaudeCommandOptions): string =>
  buildCommand('--session-id', sessionId, options);

export const buildClaudeResumeCommand = (sessionId: string, options: IClaudeCommandOptions): string =>
  buildCommand('--resume', sessionId, options);

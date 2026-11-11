import { shQuote } from '@/lib/statusline-script';

import { CLAUDE_PERMISSION_MODES, isClaudePermissionMode, type TClaudePermissionMode } from '@/lib/claude-config-values';

export { CLAUDE_PERMISSION_MODES, isClaudePermissionMode };
export type { TClaudePermissionMode };

export interface IClaudeCommandOptions {
  settingsPath: string;
  model?: string;
  permissionMode?: TClaudePermissionMode;
  envPrefix?: string;
  appendSystemPromptFile?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isValidClaudeSessionId = (id: unknown): id is string =>
  typeof id === 'string' && UUID_RE.test(id);

const buildCommand = (
  sessionFlag: '--session-id' | '--resume',
  sessionId: string,
  { settingsPath, model, permissionMode, envPrefix = '', appendSystemPromptFile }: IClaudeCommandOptions,
): string => {
  if (!isValidClaudeSessionId(sessionId)) throw new Error('Invalid Claude session id');
  const parts = ['claude', '--settings', shQuote(settingsPath), sessionFlag, sessionId];
  if (appendSystemPromptFile) parts.push('--append-system-prompt-file', shQuote(appendSystemPromptFile));
  if (model) parts.push('--model', shQuote(model));
  if (permissionMode) parts.push('--permission-mode', permissionMode);
  return `${envPrefix}${parts.join(' ')}`;
};

export const buildClaudeLaunchCommand = (sessionId: string, options: IClaudeCommandOptions): string =>
  buildCommand('--session-id', sessionId, options);

export const buildClaudeResumeCommand = (sessionId: string, options: IClaudeCommandOptions): string =>
  buildCommand('--resume', sessionId, options);

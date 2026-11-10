const COMMAND_WRAPPER_RE = /^\s*<(command-name|command-message|command-args|local-command-stdout|local-command-caveat)>/;

interface IClaudeUserRecord {
  type?: unknown;
  isMeta?: unknown;
  isSidechain?: unknown;
  message?: { content?: unknown };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const collectPromptText = (content: unknown): string | null => {
  if (typeof content === 'string') return content.length > 0 ? content : null;
  if (!Array.isArray(content)) return null;
  const pieces = content.filter((item) => isObject(item) && item.type !== 'tool_result');
  if (pieces.length === 0) return null;
  return pieces
    .map((item) => (item.type === 'text' && typeof item.text === 'string' ? item.text : ''))
    .join('');
};

export const extractClaudeUserPromptText = (record: unknown): string | null => {
  if (!isObject(record)) return null;
  const { type, isMeta, isSidechain, message } = record as IClaudeUserRecord;
  if (type !== 'user' || isMeta === true || isSidechain === true) return null;
  const text = collectPromptText(message?.content);
  if (text === null || COMMAND_WRAPPER_RE.test(text)) return null;
  return text;
};

export const isClaudeUserPrompt = (record: unknown): boolean =>
  extractClaudeUserPromptText(record) !== null;

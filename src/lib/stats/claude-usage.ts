import { isClaudeUserPrompt } from '@/lib/providers/claude/user-prompt';

export interface IClaudeUsage {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  cacheCreation5m: number;
  cacheCreation1h: number;
}

// Keys already counted. One instance must span a whole computation: a response is written as several lines
// with the same usage, and resumed or forked transcripts copy earlier lines into other files.
export interface IClaudeSeen {
  usage: Set<string>;
  prompts: Set<string>;
  toolUses: Set<string>;
}

export const createClaudeSeen = (): IClaudeSeen => ({
  usage: new Set(),
  prompts: new Set(),
  toolUses: new Set(),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toCount = (value: unknown): number => {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
};

const readString = (value: unknown): string => (typeof value === 'string' ? value : '');

// Lines without a key cannot be matched, so they are always counted.
const isFirstSeen = (seen: Set<string>, key: string): boolean => {
  if (!key) return true;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
};

const responseKey = (entry: Record<string, unknown>, message: Record<string, unknown>): string =>
  readString(message.id) || readString(entry.requestId);

export const isCountableClaudeModel = (model: string): boolean => model !== '' && !model.startsWith('<');

export const takeClaudeUserPrompt = (entry: unknown, seen: IClaudeSeen): boolean =>
  isClaudeUserPrompt(entry) && isRecord(entry) && isFirstSeen(seen.prompts, readString(entry.uuid));

export const takeClaudeAssistantUsage = (entry: unknown, seen: IClaudeSeen): IClaudeUsage | null => {
  if (!isRecord(entry) || entry.type !== 'assistant' || !isRecord(entry.message)) return null;
  const { message } = entry;
  const model = readString(message.model);
  if (!isCountableClaudeModel(model) || !isRecord(message.usage)) return null;
  if (!isFirstSeen(seen.usage, responseKey(entry, message))) return null;

  const { usage } = message;
  const cacheCreation = toCount(usage.cache_creation_input_tokens);
  const breakdown = isRecord(usage.cache_creation) ? usage.cache_creation : null;
  const cacheCreation1h = toCount(breakdown?.ephemeral_1h_input_tokens);
  const cacheCreation5m = breakdown?.ephemeral_5m_input_tokens != null
    ? toCount(breakdown.ephemeral_5m_input_tokens)
    : Math.max(0, cacheCreation - cacheCreation1h);

  return {
    model,
    input: toCount(usage.input_tokens),
    output: toCount(usage.output_tokens),
    cacheRead: toCount(usage.cache_read_input_tokens),
    cacheCreation,
    cacheCreation5m,
    cacheCreation1h,
  };
};

// A response's tool_use blocks sit on separate lines sharing one message id, so each block is keyed by the
// response and its own tool_use id.
export const takeClaudeToolUses = (entry: Record<string, unknown>, seen: IClaudeSeen): number => {
  const message = isRecord(entry.message) ? entry.message : null;
  if (!message || !Array.isArray(message.content)) return 0;

  const response = responseKey(entry, message);
  return message.content.filter((item) => {
    if (!isRecord(item) || item.type !== 'tool_use') return false;
    const toolUseId = readString(item.id);
    return isFirstSeen(seen.toolUses, toolUseId ? `${response}/${toolUseId}` : '');
  }).length;
};

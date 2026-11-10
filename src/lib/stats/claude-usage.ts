export interface IClaudeUsage {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  cacheCreation5m: number;
  cacheCreation1h: number;
}

// Keys of API responses already counted. One set must span a whole computation: a response is
// written as several lines with the same usage, and resumed or forked transcripts copy it to other files.
export type TClaudeUsageSeen = Set<string>;

export const createClaudeUsageSeen = (): TClaudeUsageSeen => new Set();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toCount = (value: unknown): number => {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
};

export const isCountableClaudeModel = (model: string): boolean => model !== '' && !model.startsWith('<');

export const takeClaudeAssistantUsage = (entry: unknown, seen: TClaudeUsageSeen): IClaudeUsage | null => {
  if (!isRecord(entry) || entry.type !== 'assistant' || !isRecord(entry.message)) return null;
  const { message } = entry;
  const model = typeof message.model === 'string' ? message.model : '';
  if (!isCountableClaudeModel(model) || !isRecord(message.usage)) return null;

  const key = typeof message.id === 'string' && message.id
    ? message.id
    : typeof entry.requestId === 'string' ? entry.requestId : '';
  if (key) {
    if (seen.has(key)) return null;
    seen.add(key);
  }

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

export const countClaudeToolUses = (entry: Record<string, unknown>): number => {
  const message = isRecord(entry.message) ? entry.message : null;
  if (!message || !Array.isArray(message.content)) return 0;
  return message.content.filter((item) => isRecord(item) && item.type === 'tool_use').length;
};

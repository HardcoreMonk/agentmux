// USD per 1M tokens. Keep this table deliberately small and OpenAI-only;
// unknown models (Claude included) return no estimate instead of falling back to unrelated rates.
interface IModelPricing {
  input: number;
  cachedInput: number | null;
  output: number;
}

const MODEL_PRICING: Record<string, IModelPricing> = {
  'gpt-5.5': { input: 5, cachedInput: 0.5, output: 30 },
  'gpt-5.4': { input: 2.5, cachedInput: 0.25, output: 15 },
  'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, output: 4.5 },
  'gpt-5.2': { input: 1.75, cachedInput: 0.175, output: 14 },
  'gpt-5.2-chat-latest': { input: 1.75, cachedInput: 0.175, output: 14 },
  'gpt-5.2-codex': { input: 1.75, cachedInput: 0.175, output: 14 },
  'gpt-5.1': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5.1-chat-latest': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5.1-codex': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5.1-codex-max': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5-chat-latest': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5-codex': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'gpt-5-nano': { input: 0.05, cachedInput: 0.005, output: 0.4 },
  'gpt-5-pro': { input: 15, cachedInput: null, output: 120 },
  'gpt-5.2-pro': { input: 21, cachedInput: null, output: 168 },
  'gpt-4.1': { input: 2, cachedInput: 0.5, output: 8 },
  'gpt-4.1-mini': { input: 0.4, cachedInput: 0.1, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, cachedInput: 0.025, output: 0.4 },
  'gpt-4o': { input: 2.5, cachedInput: 1.25, output: 10 },
  'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6 },
};

const MODEL_ALIASES: Record<string, string> = {
  'gpt-5.4-mini': 'gpt-5.4-mini',
  'gpt-5.4 mini': 'gpt-5.4-mini',
};

const stripVersionSuffix = (value: string): string =>
  value
    .replace(/\[.*?\]$/, '')
    .replace(/:\d+$/, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '')
    .replace(/-\d{8}$/, '');

const extractModelKey = (modelId: string): string | null => {
  const cleaned = stripVersionSuffix(modelId.trim().toLowerCase());
  const alias = MODEL_ALIASES[cleaned];
  if (alias) return alias;
  if (MODEL_PRICING[cleaned]) return cleaned;

  const keys = Object.keys(MODEL_PRICING).sort((a, b) => b.length - a.length);
  return keys.find((key) => cleaned === key || cleaned.startsWith(`${key}-`)) ?? null;
};

export const normalizeModelName = (modelId: string): string => {
  return extractModelKey(modelId) ?? modelId;
};

export const hasModelPricing = (modelId: string): boolean => extractModelKey(modelId) !== null;

// claude-opus-4-5-20251101 -> Claude Opus 4.5, claude-3-5-sonnet-20241022 -> Claude 3.5 Sonnet
const formatClaudeModelName = (modelId: string): string | null => {
  const cleaned = stripVersionSuffix(modelId.trim().toLowerCase());
  if (!cleaned.startsWith('claude-')) return null;

  const words: string[] = [];
  for (const part of cleaned.slice('claude-'.length).split('-').filter(Boolean)) {
    const previous = words[words.length - 1];
    if (/^\d+$/.test(part) && previous && /^\d+(\.\d+)*$/.test(previous)) {
      words[words.length - 1] = `${previous}.${part}`;
    } else {
      words.push(/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1));
    }
  }
  return ['Claude', ...words].join(' ');
};

export const formatModelDisplayName = (modelId: string): string => {
  const claudeName = formatClaudeModelName(modelId);
  if (claudeName) return claudeName;
  const key = extractModelKey(modelId) ?? modelId;
  return key
    .replace(/^gpt/, 'GPT')
    .split('-')
    .map((part, index) => index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join('-')
    .replace(/-Mini$/, ' Mini')
    .replace(/-Nano$/, ' Nano')
    .replace(/-Pro$/, ' Pro')
    .replace(/-Codex$/, ' Codex')
    .replace(/-Max$/, ' Max')
    .replace(/-Chat-Latest$/, ' Chat Latest');
};

const computeCost = (
  pricing: IModelPricing,
  input: number,
  output: number,
  cacheCreation5m: number,
  cacheCreation1h: number,
  cacheRead: number,
): number => {
  const mtok = 1_000_000;
  const uncachedInput = input + cacheCreation5m + cacheCreation1h;
  const cachedRate = pricing.cachedInput ?? pricing.input;
  return (
    (uncachedInput / mtok) * pricing.input +
    (cacheRead / mtok) * cachedRate +
    (output / mtok) * pricing.output
  );
};

export const calculateCost = (
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreation5mTokens: number,
  cacheCreation1hTokens: number,
  cacheReadTokens: number,
  _isFastMode = false,
): number | null => {
  const key = extractModelKey(modelId);
  if (!key) return null;
  const pricing = MODEL_PRICING[key];
  if (!pricing) return null;

  return computeCost(
    pricing,
    inputTokens,
    outputTokens,
    cacheCreation5mTokens,
    cacheCreation1hTokens,
    cacheReadTokens,
  );
};

export const calculateCostByFullId = (
  fullModelId: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreation5mTokens: number,
  cacheCreation1hTokens: number,
  cacheReadTokens: number,
): number => {
  return calculateCost(
    fullModelId,
    inputTokens,
    outputTokens,
    cacheCreation5mTokens,
    cacheCreation1hTokens,
    cacheReadTokens,
  ) ?? 0;
};

export const formatTokenCount = (count: number): string => {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toLocaleString();
};

export const formatTokenDetail = (count: number): string => {
  return count.toLocaleString();
};

export const formatCost = (cost: number): string => {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  if (cost >= 1_000) return `$${cost.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  return `$${cost.toFixed(2)}`;
};

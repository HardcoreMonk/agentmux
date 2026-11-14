import { matchTrustPrompt } from '@/lib/trust-prompt-detector';

export type TCodexUpdateStatus = 'prompt' | 'updating' | 'success' | 'failed';

export interface ICodexUpdatePromptInfo {
  status: TCodexUpdateStatus;
  currentVersion: string | null;
  latestVersion: string | null;
  updateCommand: string | null;
}

export interface ICodexHooksReviewInfo {
  changedCount: number | null;
  options: string[];
  selectedIndex: number;
  trusting: boolean;
}

export type TCodexHooksAnswer = 'trust' | 'skip';
export type TCodexUpdateAnswer = 'update' | 'skip' | 'skip-version';

// 0.167.0 draws "Update available · <cur> → <latest>"; older builds drew "Update available! <cur> -> <latest>".
const UPDATE_TITLE_RE = /Update available\s*(?:!|·)\s*(\S+)\s*(?:→|->)\s*(\S+)/i;
const UPDATE_NOW_RE = /Update now(?:\s*\(runs\s*`([^`]*)`\))?/i;
const UPDATE_SKIP_VERSION_RE = /Skip until next version/i;
const UPDATING_RE = /Updating Codex via\s*`([^`]*)`/i;
const UPDATE_SUCCESS_RE = /Update ran successfully! Please restart Codex\./i;
const UPDATE_FAILED_RE = /failed with status/i;

const HOOKS_TITLE_RE = /Hooks\s+need\s+review/i;
const HOOKS_TRUST_RE = /Trust\s+all\s+and\s+continue/i;
const HOOKS_SKIP_RE = /Continue\s+without\s+trusting/i;
const HOOKS_REVIEW_OPTION_RE = /Review\s+hooks/i;
const HOOKS_COUNT_RE = /(\d+)\s+hooks?\s+(?:is|are)\s+new\s+or\s+changed/i;
const HOOKS_TRUSTING_RE = /Trusting\s+hooks\.\.\./i;
const HOOKS_FOOTER_RE = /^\s*enter\s+\w+/i;

const INPUT_DISABLED_RE = /^\s*›?\s*Input disabled\./m;
const INPUT_LINE_RE = /^\s*›(?:\s*$|\s+(?!\d+\.)(?!\[[ x-]\])[^\n]*)$/m;
const INPUT_TAIL_LINES = 8;

const MARK_RE = /^\s*›?\s*/;
const collapse = (text: string): string => text.replace(/\s+/g, ' ');

export const matchCodexUpdatePrompt = (text: string): ICodexUpdatePromptInfo | null => {
  const flat = collapse(text);
  const title = UPDATE_TITLE_RE.exec(flat);
  const now = UPDATE_NOW_RE.exec(flat);
  const info = (status: TCodexUpdateStatus, updateCommand: string | null): ICodexUpdatePromptInfo => ({
    status,
    currentVersion: title?.[1] ?? null,
    latestVersion: title?.[2] ?? null,
    updateCommand,
  });

  if (now && UPDATE_SKIP_VERSION_RE.test(flat)) return info('prompt', now[1] ?? null);
  const updating = UPDATING_RE.exec(flat);
  // The result lines follow the "Updating Codex via" line, so they are checked first.
  if (UPDATE_SUCCESS_RE.test(flat)) return info('success', updating?.[1] ?? null);
  if (updating && UPDATE_FAILED_RE.test(flat)) return info('failed', updating[1]);
  if (updating) return info('updating', updating[1]);
  return null;
};

const readOptions = (lines: string[]): { options: string[]; selectedIndex: number } => {
  const labelRes = [HOOKS_REVIEW_OPTION_RE, HOOKS_TRUST_RE, HOOKS_SKIP_RE];
  const titleIdx = lines.findIndex((line) => HOOKS_TITLE_RE.test(line));
  const options: string[] = [];
  let selectedIndex = 0;

  for (let i = Math.max(0, titleIdx); i < lines.length; i += 1) {
    const line = lines[i];
    if (!labelRes.some((re) => re.test(line)) || HOOKS_TITLE_RE.test(line)) continue;
    let label = line.replace(MARK_RE, '').trim();
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j];
      if (!next.trim() || HOOKS_FOOTER_RE.test(next) || labelRes.some((re) => re.test(next))) break;
      label = `${label} ${next.trim()}`;
    }
    if (/^\s*›/.test(line)) selectedIndex = options.length;
    options.push(label);
  }
  return { options, selectedIndex };
};

export const matchCodexHooksReview = (text: string): ICodexHooksReviewInfo | null => {
  const flat = collapse(text);
  if (!HOOKS_TITLE_RE.test(flat) || !HOOKS_TRUST_RE.test(flat)) return null;
  const count = HOOKS_COUNT_RE.exec(flat);
  return {
    changedCount: count ? Number(count[1]) : null,
    ...readOptions(text.split('\n')),
    trusting: HOOKS_TRUSTING_RE.test(flat),
  };
};

export const codexHooksReviewKeys = (info: ICodexHooksReviewInfo, answer: TCodexHooksAnswer): string | null => {
  if (info.trusting) return null;
  const index = info.options.findIndex((option) => (answer === 'trust' ? HOOKS_TRUST_RE : HOOKS_SKIP_RE).test(option));
  if (index < 0) return null;
  const number = /^(\d+)\./.exec(info.options[index])?.[1] ?? String(index + 1);
  return answer === 'trust' ? `${number}\r` : number;
};

export const codexUpdateAnswerKeys = (answer: TCodexUpdateAnswer): string =>
  ({ update: '1', skip: '2', 'skip-version': '3' })[answer];

const isUpdateBlocking = (text: string): boolean => {
  const status = matchCodexUpdatePrompt(text)?.status;
  return status === 'prompt' || status === 'updating';
};

export const isCodexTuiReadyContent = (text: string): boolean => {
  if (isUpdateBlocking(text) || matchCodexHooksReview(text) || INPUT_DISABLED_RE.test(text)) return false;
  const lines = text.split('\n');
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  return INPUT_LINE_RE.test(lines.slice(-INPUT_TAIL_LINES).join('\n'));
};

export const isCodexBlockingScreen = (text: string): boolean =>
  isUpdateBlocking(text)
  || matchCodexHooksReview(text) !== null
  || matchTrustPrompt(text)?.agent === 'codex';

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
// Markers are matched against whole screen lines so a quoted or diffed copy in the conversation is not mistaken for a card.
const UPDATE_TITLE_RE = /^\s*Update available\s*(?:!|·)\s*(\S+)\s*(?:→|->)\s*(\S+)\s*$/i;
const UPDATE_NOW_RE = /^\s*(?:›\s*)?\d+\.\s+Update now\b/;
const UPDATE_SKIP_VERSION_RE = /^\s*(?:›\s*)?\d+\.\s+Skip until next version\s*$/;
const UPDATE_COMMAND_RE = /\(runs\s*`([^`]*)`\)/;
const UPDATING_RE = /^\s*Updating Codex via\s+`([^`]*)`/;
const UPDATE_SUCCESS_RE = /^\s*(?:🎉\s*)?Update ran successfully!/;
const UPDATE_ERROR_RE = /^\s*Error:\s+/;
const UPDATE_FAILED_RE = /failed with status/i;

const HOOKS_TITLE_RE = /^\s*Hooks need review\s*$/;
const HOOKS_TRUST_LINE_RE = /^\s*(?:›\s*)?(?:\d+\.\s+)?Trust all and continue\s*$/;
const HOOKS_OPTION_RE = /^\s*(?:›\s*)?(?:(\d+)\.\s+)?(Review hooks|Trust all and continue|Continue without trusting\b.*)$/;
const HOOKS_TRUST_RE = /Trust\s+all\s+and\s+continue/i;
const HOOKS_SKIP_RE = /Continue\s+without\s+trusting/i;
const HOOKS_COUNT_RE = /^\s*(\d+) hooks? (?:is|are) new or changed\.\s*$/;
const HOOKS_TRUSTING_RE = /^\s*Trusting hooks\.\.\.\s*$/;
const HOOKS_FOOTER_RE = /^\s*enter\s+\w+/i;

const INPUT_DISABLED_RE = /^\s*›?\s*Input disabled\./m;
const INPUT_LINE_RE = /^\s*›(?:\s*$|\s+(?!\d+\.)(?!\[[ x-]\])[^\n]*)$/m;
const INPUT_TAIL_LINES = 8;

const collapse = (text: string): string => text.replace(/\s+/g, ' ');
const splitLines = (text: string): string[] => text.split('\n').map((line) => line.replace(/\r$/, ''));
const collapseFrom = (lines: string[], index: number): string => collapse(lines.slice(index).join('\n'));

export const matchCodexUpdatePrompt = (text: string): ICodexUpdatePromptInfo | null => {
  const lines = splitLines(text);
  const skipIdx = lines.findLastIndex((line) => UPDATE_SKIP_VERSION_RE.test(line));
  const nowIdx = lines.findLastIndex((line, i) => i < skipIdx && UPDATE_NOW_RE.test(line));
  const updatingIdx = lines.findLastIndex((line) => UPDATING_RE.test(line));
  const successIdx = lines.findLastIndex((line) => UPDATE_SUCCESS_RE.test(line));
  const failedIdx = lines.findLastIndex(
    (line, i) => UPDATE_ERROR_RE.test(line) && UPDATE_FAILED_RE.test(collapseFrom(lines, i)),
  );

  const markers: { status: TCodexUpdateStatus; index: number }[] = [
    { status: 'prompt', index: nowIdx >= 0 ? skipIdx : -1 },
    { status: 'updating', index: updatingIdx },
    { status: 'success', index: successIdx },
    { status: 'failed', index: failedIdx },
  ];
  const latest = markers.reduce((best, marker) => (marker.index > best.index ? marker : best));
  if (latest.index < 0) return null;

  const title = lines.map((line) => UPDATE_TITLE_RE.exec(line)).findLast((match) => match !== null) ?? null;
  const updateCommand = latest.status === 'prompt'
    ? UPDATE_COMMAND_RE.exec(collapseFrom(lines, nowIdx))?.[1] ?? null
    : updatingIdx >= 0 ? UPDATING_RE.exec(lines[updatingIdx])?.[1] ?? null : null;
  return {
    status: latest.status,
    currentVersion: title?.[1] ?? null,
    latestVersion: title?.[2] ?? null,
    updateCommand,
  };
};

const readOptions = (lines: string[], titleIdx: number): { options: string[]; selectedIndex: number } => {
  const isOptionLine = (line: string): boolean => HOOKS_OPTION_RE.test(line);
  const options: string[] = [];
  let selectedIndex = 0;

  for (let i = titleIdx + 1; i < lines.length; i += 1) {
    const match = HOOKS_OPTION_RE.exec(lines[i]);
    if (!match) continue;
    let label = match[1] ? `${match[1]}. ${match[2].trim()}` : match[2].trim();
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j];
      if (!next.trim() || HOOKS_FOOTER_RE.test(next) || isOptionLine(next)) break;
      label = `${label} ${next.trim()}`;
    }
    if (/^\s*›/.test(lines[i])) selectedIndex = options.length;
    options.push(label);
  }
  return { options, selectedIndex };
};

export const matchCodexHooksReview = (text: string): ICodexHooksReviewInfo | null => {
  const lines = splitLines(text);
  const titleIdx = lines.findLastIndex((line) => HOOKS_TITLE_RE.test(line));
  if (titleIdx < 0 || !lines.some((line, i) => i > titleIdx && HOOKS_TRUST_LINE_RE.test(line))) return null;
  const count = lines.map((line) => HOOKS_COUNT_RE.exec(line)).find((match) => match !== null);
  return {
    changedCount: count ? Number(count[1]) : null,
    ...readOptions(lines, titleIdx),
    trusting: lines.some((line) => HOOKS_TRUSTING_RE.test(line)),
  };
};

export const codexHooksReviewKeys = (info: ICodexHooksReviewInfo, answer: TCodexHooksAnswer): string | null => {
  if (info.trusting) return null;
  const option = info.options.find((candidate) => (answer === 'trust' ? HOOKS_TRUST_RE : HOOKS_SKIP_RE).test(candidate));
  const number = option ? /^(\d+)\./.exec(option)?.[1] : undefined;
  if (!number) return null;
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

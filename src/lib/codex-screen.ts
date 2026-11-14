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
// A marker must start at the beginning of a screen line (after indent, the › mark, and an option number) and may
// continue onto the next lines when the TUI wrapped it. Quoted or diffed copies in the conversation do not start there.
const HEAD_PLAIN_RE = /^\s*/;
const HEAD_OPTION_RE = /^\s*(?:›\s*)?(?:(\d+)\.\s+)?/;
const HEAD_NUMBERED_RE = /^\s*(?:›\s*)?(\d+)\.\s+/;
const HEAD_SUCCESS_RE = /^\s*(?:🎉\s*)?/;
const MARKER_MAX_EXTRA_LINES = 4;

const UPDATE_TITLE_RE = /^Update available\s?(?:!|·)\s(\S+)\s(?:→|->)\s(\S+)$/i;
const UPDATE_NOW_RE = /^Update now(?: \(runs `([^`]*)`\))?$/i;
const UPDATE_SKIP_VERSION_RE = /^Skip until next version$/i;
const UPDATING_RE = /^Updating Codex via `([^`]*)`/;
const UPDATE_SUCCESS_RE = /^Update ran successfully!/;
const UPDATE_ERROR_RE = /^Error: /;
const UPDATE_FAILED_RE = /failed with status/i;

const HOOKS_TITLE_RE = /^Hooks need review$/i;
const HOOKS_REVIEW_OPTION_RE = /^Review hooks$/i;
const HOOKS_TRUST_OPTION_RE = /^Trust all and continue$/i;
const HOOKS_SKIP_OPTION_RE = /^Continue without trusting\b/i;
const HOOKS_TRUST_RE = /Trust\s+all\s+and\s+continue/i;
const HOOKS_SKIP_RE = /Continue\s+without\s+trusting/i;
const HOOKS_COUNT_RE = /^(\d+) hooks? (?:is|are) new or changed\.$/i;
const HOOKS_TRUSTING_RE = /^Trusting hooks\.\.\.$/i;
const HOOKS_FOOTER_RE = /^\s*enter\s+\w+/i;

const INPUT_DISABLED_RE = /^\s*›?\s*Input disabled\./m;
const INPUT_LINE_RE = /^\s*›(?:\s*$|\s+(?!\d+\.)(?!\[[ x-]\])[^\n]*)$/m;
const INPUT_TAIL_LINES = 8;

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();
const splitLines = (text: string): string[] => text.split('\n').map((line) => line.replace(/\r$/, ''));
const collapseFrom = (lines: string[], index: number): string => collapse(lines.slice(index).join('\n'));

interface IMarkerMatch {
  head: RegExpExecArray;
  marker: RegExpExecArray;
}

const markerAt = (lines: string[], index: number, headRe: RegExp, markerRe: RegExp): IMarkerMatch | null => {
  const head = headRe.exec(lines[index]);
  if (!head) return null;
  let rest = lines[index].slice(head[0].length);
  let found: IMarkerMatch | null = null;
  for (let k = index; k <= index + MARKER_MAX_EXTRA_LINES; k += 1) {
    if (k > index) {
      if (lines[k] === undefined || !lines[k].trim()) break;
      rest += `\n${lines[k]}`;
    }
    const marker = markerRe.exec(collapse(rest));
    if (marker) found = { head, marker };
  }
  return found;
};

const findLastMarker = (
  lines: string[],
  headRe: RegExp,
  markerRe: RegExp,
  before = lines.length,
): { index: number; match: IMarkerMatch } | null => {
  for (let i = Math.min(before, lines.length) - 1; i >= 0; i -= 1) {
    const match = markerAt(lines, i, headRe, markerRe);
    if (match) return { index: i, match };
  }
  return null;
};

export const matchCodexUpdatePrompt = (text: string): ICodexUpdatePromptInfo | null => {
  const lines = splitLines(text);
  const skip = findLastMarker(lines, HEAD_NUMBERED_RE, UPDATE_SKIP_VERSION_RE);
  const now = skip ? findLastMarker(lines, HEAD_NUMBERED_RE, UPDATE_NOW_RE, skip.index) : null;
  const updating = findLastMarker(lines, HEAD_PLAIN_RE, UPDATING_RE);
  const success = findLastMarker(lines, HEAD_SUCCESS_RE, UPDATE_SUCCESS_RE);
  const failedIdx = lines.findLastIndex(
    (line, i) => markerAt(lines, i, HEAD_PLAIN_RE, UPDATE_ERROR_RE) !== null && UPDATE_FAILED_RE.test(collapseFrom(lines, i)),
  );

  const markers: { status: TCodexUpdateStatus; index: number }[] = [
    { status: 'prompt', index: now && skip ? skip.index : -1 },
    { status: 'updating', index: updating?.index ?? -1 },
    { status: 'success', index: success?.index ?? -1 },
    { status: 'failed', index: failedIdx },
  ];
  const latest = markers.reduce((best, marker) => (marker.index > best.index ? marker : best));
  if (latest.index < 0) return null;

  const title = findLastMarker(lines, HEAD_PLAIN_RE, UPDATE_TITLE_RE)?.match.marker ?? null;
  const updateCommand = latest.status === 'prompt' ? now?.match.marker[1] : updating?.match.marker[1];
  return {
    status: latest.status,
    currentVersion: title?.[1] ?? null,
    latestVersion: title?.[2] ?? null,
    updateCommand: updateCommand ?? null,
  };
};

const isOptionStart = (lines: string[], index: number): boolean =>
  [HOOKS_REVIEW_OPTION_RE, HOOKS_TRUST_OPTION_RE, HOOKS_SKIP_OPTION_RE].some(
    (re) => markerAt(lines, index, HEAD_OPTION_RE, re) !== null,
  );

const readOptions = (lines: string[], titleIdx: number): { options: string[]; selectedIndex: number } => {
  const options: string[] = [];
  let selectedIndex = 0;

  for (let i = titleIdx + 1; i < lines.length; i += 1) {
    if (!isOptionStart(lines, i)) continue;
    const head = HEAD_OPTION_RE.exec(lines[i])!;
    const parts = [lines[i].slice(head[0].length).trim()];
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j];
      if (!next.trim() || HOOKS_FOOTER_RE.test(next) || isOptionStart(lines, j)) break;
      parts.push(next.trim());
    }
    const label = collapse(parts.join(' '));
    if (/^\s*›/.test(lines[i])) selectedIndex = options.length;
    options.push(head[1] ? `${head[1]}. ${label}` : label);
  }
  return { options, selectedIndex };
};

export const matchCodexHooksReview = (text: string): ICodexHooksReviewInfo | null => {
  const lines = splitLines(text);
  const titleIdx = lines.findLastIndex((_, i) => markerAt(lines, i, HEAD_PLAIN_RE, HOOKS_TITLE_RE) !== null);
  if (titleIdx < 0) return null;
  const hasTrust = lines.some((_, i) => i > titleIdx && markerAt(lines, i, HEAD_OPTION_RE, HOOKS_TRUST_OPTION_RE) !== null);
  if (!hasTrust) return null;
  const count = findLastMarker(lines, HEAD_PLAIN_RE, HOOKS_COUNT_RE)?.match.marker[1];
  return {
    changedCount: count ? Number(count) : null,
    ...readOptions(lines, titleIdx),
    trusting: findLastMarker(lines, HEAD_PLAIN_RE, HOOKS_TRUSTING_RE) !== null,
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

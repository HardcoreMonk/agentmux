import {
  HEAD_NUMBERED_RE,
  HEAD_OPTION_RE,
  HEAD_PLAIN_RE,
  HEAD_SUCCESS_RE,
  INPUT_LINE_RE,
  MARKER_MAX_EXTRA_LINES,
  collapse,
  findLastMarker,
  hasInputLineBelow,
  markerAt,
  splitLines,
} from '@/lib/screen-markers';
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

const UPDATE_TITLE_RE = /^Update available\s?(?:!|·)\s(\S+)\s(?:→|->)\s(\S+)$/i;
const UPDATE_NOW_RE = /^Update now(?: \(runs `([^`]*)`\))?$/i;
const UPDATE_SKIP_VERSION_RE = /^Skip until next version$/i;
const UPDATING_RE = /^Updating Codex via `([^`]*)`/;
const UPDATE_SUCCESS_RE = /^Update ran successfully!/;
const UPDATE_FAILED_LINE_RE = /^Error: `[^`]*` failed with status/i;

const HOOKS_TITLE_RE = /^Hooks need review$/i;
const HOOKS_REVIEW_OPTION_RE = /^Review hooks$/i;
const HOOKS_TRUST_OPTION_RE = /^Trust all and continue$/i;
const HOOKS_SKIP_OPTION_RE = /^Continue without trusting\b/i;
const HOOKS_TRUST_RE = /Trust\s+all\s+and\s+continue/i;
const HOOKS_SKIP_RE = /Continue\s+without\s+trusting/i;
const HOOKS_COUNT_RE = /^(\d+) hooks? (?:is|are) new or changed\.$/i;
const HOOKS_TRUSTING_RE = /^Trusting hooks\.\.\.$/i;
const HOOKS_FOOTER_RE = /^\s*enter\s+\w+/i;

const FOLDER_ACCESS_TITLE_RE = /^Folder access\b/i;
const INPUT_DISABLED_RE = /^\s*›?\s*Input disabled\./m;
const INPUT_TAIL_LINES = 8;

const lastFooterWithin = (lines: string[], index: number): number => {
  let last = index;
  for (let i = index + 1; i < lines.length && i <= index + MARKER_MAX_EXTRA_LINES + 2; i += 1) {
    if (HOOKS_FOOTER_RE.test(lines[i])) last = i;
  }
  return last;
};

export const matchCodexUpdatePrompt = (text: string): ICodexUpdatePromptInfo | null => {
  const lines = splitLines(text);
  const skip = findLastMarker(lines, HEAD_NUMBERED_RE, UPDATE_SKIP_VERSION_RE);
  const now = skip ? findLastMarker(lines, HEAD_NUMBERED_RE, UPDATE_NOW_RE, skip.index) : null;
  const updating = findLastMarker(lines, HEAD_PLAIN_RE, UPDATING_RE);
  const success = findLastMarker(lines, HEAD_SUCCESS_RE, UPDATE_SUCCESS_RE);
  const failedIdx = lines.findLastIndex((_, i) => markerAt(lines, i, HEAD_PLAIN_RE, UPDATE_FAILED_LINE_RE) !== null);

  const markers: { status: TCodexUpdateStatus; index: number }[] = [
    { status: 'prompt', index: now && skip ? skip.index : -1 },
    { status: 'updating', index: updating?.index ?? -1 },
    { status: 'success', index: success?.index ?? -1 },
    { status: 'failed', index: failedIdx },
  ];
  const latest = markers.reduce((best, marker) => (marker.index > best.index ? marker : best));
  if (latest.index < 0) return null;
  const markerEnd = latest.status === 'prompt' ? lastFooterWithin(lines, latest.index) : latest.index;
  if (hasInputLineBelow(lines, markerEnd)) return null;

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

// Last line of the final option (with its wrapped lines) and the footer under it.
const optionsEnd = (lines: string[], titleIdx: number): number => {
  const lastStart = lines.findLastIndex((_, i) => i > titleIdx && isOptionStart(lines, i));
  if (lastStart < 0) return titleIdx;
  let end = lastStart;
  for (let j = lastStart + 1; j < lines.length; j += 1) {
    if (!lines[j].trim() || HOOKS_FOOTER_RE.test(lines[j]) || isOptionStart(lines, j)) break;
    end = j;
  }
  return lastFooterWithin(lines, end);
};

export const matchCodexHooksReview = (text: string): ICodexHooksReviewInfo | null => {
  const lines = splitLines(text);
  const titleIdx = lines.findLastIndex((_, i) => markerAt(lines, i, HEAD_PLAIN_RE, HOOKS_TITLE_RE) !== null);
  if (titleIdx < 0) return null;
  const hasTrust = lines.some((_, i) => i > titleIdx && markerAt(lines, i, HEAD_OPTION_RE, HOOKS_TRUST_OPTION_RE) !== null);
  if (!hasTrust) return null;
  if (hasInputLineBelow(lines, optionsEnd(lines, titleIdx))) return null;
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

const hasInputLineInTail = (text: string): boolean => {
  const lines = text.split('\n');
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  return INPUT_LINE_RE.test(lines.slice(-INPUT_TAIL_LINES).join('\n'));
};

// Codex 0.169 paints its input box about 350ms after launch and keeps it for 0.4-0.9s before the hook review
// screen covers it. The input box counts as ready only after it has stayed up for twice that gap.
export const CODEX_TUI_READY_SETTLE_MS = 2000;

export const isCodexTuiReadyContent = (text: string): boolean => {
  if (isUpdateBlocking(text) || matchCodexHooksReview(text) || INPUT_DISABLED_RE.test(text)) return false;
  return hasInputLineInTail(text);
};

// "Folder access" covers both the trust question and the restricted-open variant; either one blocks the input box.
export const isCodexFolderAccessScreen = (text: string): boolean => {
  const lines = splitLines(text);
  const title = findLastMarker(lines, HEAD_PLAIN_RE, FOLDER_ACCESS_TITLE_RE);
  if (!title) return false;
  if (!lines.some((line, i) => i > title.index && HEAD_NUMBERED_RE.test(line))) return false;
  return !hasInputLineBelow(lines, title.index);
};

export const isCodexBlockingScreen = (text: string): boolean =>
  isUpdateBlocking(text)
  || isCodexFolderAccessScreen(text)
  || matchCodexHooksReview(text) !== null
  || (matchTrustPrompt(text)?.agent === 'codex' && !hasInputLineInTail(text));

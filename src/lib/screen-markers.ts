// 0.167.0 draws "Update available · <cur> → <latest>"; older builds drew "Update available! <cur> -> <latest>".
// A marker must start at the beginning of a screen line (after indent, the › mark, and an option number) and may
// continue onto the next lines when the TUI wrapped it. Quoted or diffed copies in the conversation do not start there.
export const HEAD_PLAIN_RE = /^\s*/;
export const HEAD_OPTION_RE = /^\s*(?:›\s*)?(?:(\d+)\.\s+)?/;
export const HEAD_NUMBERED_RE = /^\s*(?:›\s*)?(\d+)\.\s+/;
export const HEAD_SUCCESS_RE = /^\s*(?:🎉\s*)?/;
export const MARKER_MAX_EXTRA_LINES = 4;

export const INPUT_LINE_RE = /^\s*›(?:\s*$|\s+(?!\d+\.)(?!\[[ x-]\])[^\n]*)$/m;

export const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();
export const splitLines = (text: string): string[] => text.split('\n').map((line) => line.replace(/\r$/, ''));

export interface IMarkerMatch {
  head: RegExpExecArray;
  marker: RegExpExecArray;
}

export const markerAt = (lines: string[], index: number, headRe: RegExp, markerRe: RegExp): IMarkerMatch | null => {
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

export const findLastMarker = (
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

// A real startup screen has no Codex input box under it, so an input line below a marker means the marker is a quote.
export const hasInputLineBelow = (lines: string[], index: number): boolean =>
  lines.some((line, i) => i > index && INPUT_LINE_RE.test(line));

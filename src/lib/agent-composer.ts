import type { TAgentPanelType } from '@/types/terminal';

interface IStyledChar {
  char: string;
  dim: boolean;
}

const CSI_RE = /\x1b\[([0-9;?]*)([A-Za-z])/g;

const isVisibleChar = (char: string): boolean =>
  char !== '\u00a0' && !/^\s$/.test(char);

const applySgrParams = (rawParams: string, currentDim: boolean): boolean => {
  if (rawParams === '') return false;
  const params = rawParams.split(';').map((part) => (part === '' ? 0 : Number(part)));
  let dim = currentDim;
  for (let i = 0; i < params.length; i += 1) {
    const code = params[i];
    if (code === 38 || code === 48 || code === 58) {
      if (params[i + 1] === 2) {
        i += 4;
        continue;
      }
      if (params[i + 1] === 5) {
        i += 2;
        continue;
      }
    }
    if (code === 0 || code === 22) {
      dim = false;
    } else if (code === 2) {
      dim = true;
    }
  }
  return dim;
};

const parseAnsiLine = (line: string): IStyledChar[] => {
  const result: IStyledChar[] = [];
  let dim = false;
  let cursor = 0;
  CSI_RE.lastIndex = 0;

  let match = CSI_RE.exec(line);
  while (match !== null) {
    if (match.index > cursor) {
      for (const char of line.slice(cursor, match.index)) {
        result.push({ char, dim });
      }
    }
    if (match[2] === 'm') {
      dim = applySgrParams(match[1], dim);
    }
    cursor = match.index + match[0].length;
    match = CSI_RE.exec(line);
  }

  if (cursor < line.length) {
    for (const char of line.slice(cursor)) {
      result.push({ char, dim });
    }
  }

  return result;
};

const findMarkerCharIndex = (chars: IStyledChar[], marker: string): number => {
  for (let i = 0; i < chars.length; i += 1) {
    if (!isVisibleChar(chars[i].char)) continue;
    return chars[i].char === marker ? i : -1;
  }
  return -1;
};

export const isAgentComposerEmpty = (
  provider: TAgentPanelType,
  ansiScreen: string,
): boolean | null => {
  const marker = provider === 'codex' ? '›' : '❯';
  const lines = ansiScreen.split(/\r?\n/);

  let lastMarkerLineIdx = -1;
  let lastMarkerParsed: IStyledChar[] = [];
  let lastMarkerCharIdx = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const parsed = parseAnsiLine(lines[i]);
    const markerIdx = findMarkerCharIndex(parsed, marker);
    if (markerIdx >= 0) {
      lastMarkerLineIdx = i;
      lastMarkerParsed = parsed;
      lastMarkerCharIdx = markerIdx;
    }
  }

  if (lastMarkerLineIdx < 0) return null;

  const visibleAfterMarker = lastMarkerParsed
    .slice(lastMarkerCharIdx + 1)
    .filter((entry) => isVisibleChar(entry.char));

  if (provider === 'codex') {
    return visibleAfterMarker.length > 0 && visibleAfterMarker.every((entry) => entry.dim);
  }

  if (visibleAfterMarker.length > 0 && !visibleAfterMarker.every((entry) => entry.dim)) {
    return false;
  }

  const nextLine = lines[lastMarkerLineIdx + 1];
  if (nextLine === undefined) return false;
  const nextFirstVisible = parseAnsiLine(nextLine).find((entry) => isVisibleChar(entry.char));
  return nextFirstVisible?.char === '─';
};

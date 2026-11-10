export type TTrustAnswer = 'yes' | 'no';
export type TTrustAgent = 'claude' | 'codex';

export interface ITrustPromptInfo {
  agent: TTrustAgent;
  folderPath: string | null;
  // Claude 선택지는 번호가 없어 화살표로 이동해야 하므로 순서와 현재 위치를 함께 담는다
  options: string[];
  selectedIndex: number;
}

const ARROW_DOWN = '\x1b[B';
const ARROW_UP = '\x1b[A';
const ESC = '\x1b';

const ABS_PATH_RE = /(\/[^\s│]+)/;
const CLAUDE_ANCHOR_RE = /Quick safety check/i;
const CLAUDE_WORKSPACE_RE = /Accessing workspace:/i;
const CLAUDE_YES_RE = /Yes,\s+I trust this folder/i;
const CLAUDE_NO_RE = /No,\s+exit/i;
const CODEX_YOU_ARE_IN_RE = /You are in\s+(\/\S+)/i;
const CODEX_GIT_ROOT_RE = /repository root:\s*(\/\S+)/i;
const FOCUS_MARK_RE = /^\s*[❯›>]\s*/;

const findPath = (line: string | undefined): string | null => {
  const m = line?.match(ABS_PATH_RE);
  return m && m[1].length > 1 ? m[1].trim() : null;
};

const matchClaude = (text: string, lines: string[]): ITrustPromptInfo | null => {
  if (!CLAUDE_YES_RE.test(text) || !CLAUDE_NO_RE.test(text)) return null;

  const yesIdx = lines.findLastIndex((l) => CLAUDE_YES_RE.test(l));
  const noIdx = lines.findLastIndex((l) => CLAUDE_NO_RE.test(l));
  if (yesIdx < 0 || noIdx < 0) return null;
  const first = Math.min(yesIdx, noIdx);
  const rows = [noIdx, yesIdx].sort((a, b) => a - b);
  const options = rows.map((i) => lines[i].replace(FOCUS_MARK_RE, '').trim());
  const focusedRow = rows.findIndex((i) => FOCUS_MARK_RE.test(lines[i]));

  let folderPath: string | null = null;
  const wsIdx = lines.findLastIndex((l, i) => i < first && CLAUDE_WORKSPACE_RE.test(l));
  if (wsIdx >= 0) {
    // "Accessing workspace:" 다음 줄(사이의 빈 줄은 건너뜀)
    for (let i = wsIdx + 1; i < Math.min(lines.length, wsIdx + 4); i++) {
      folderPath = findPath(lines[i]);
      if (folderPath) break;
    }
  }
  if (!folderPath) {
    const anchorIdx = lines.findIndex((l) => CLAUDE_ANCHOR_RE.test(l));
    if (anchorIdx >= 0) {
      for (let i = anchorIdx - 1; i >= Math.max(0, anchorIdx - 6); i--) {
        folderPath = findPath(lines[i]);
        if (folderPath) break;
      }
    }
  }

  return { agent: 'claude', folderPath, options, selectedIndex: Math.max(0, focusedRow) };
};

const matchCodex = (text: string, lines: string[]): ITrustPromptInfo | null => {
  const signatures = [/Do you trust the contents of this directory/i, /Yes,\s+continue/i, /No,\s+quit/i];
  if (!signatures.every((re) => re.test(text))) return null;
  let folderPath: string | null = null;
  for (const re of [CODEX_GIT_ROOT_RE, CODEX_YOU_ARE_IN_RE]) {
    for (const line of lines) {
      const m = line.match(re);
      if (m && m[1].length > 1) {
        folderPath = m[1].trim();
        break;
      }
    }
    if (folderPath) break;
  }
  if (!folderPath) return null;
  return { agent: 'codex', folderPath, options: ['Yes, continue', 'No, quit'], selectedIndex: 0 };
};

export const matchTrustPrompt = (screenText: string): ITrustPromptInfo | null => {
  const lines = screenText.split('\n');
  return matchClaude(screenText, lines) ?? matchCodex(screenText, lines);
};

export const trustAnswerKeys = (info: ITrustPromptInfo, answer: TTrustAnswer): string => {
  if (info.agent === 'codex') return answer === 'yes' ? '1' : '2';
  if (answer === 'no') return ESC;
  const target = info.options.findIndex((o) => CLAUDE_YES_RE.test(o));
  const diff = (target < 0 ? 1 : target) - info.selectedIndex;
  const arrows = (diff >= 0 ? ARROW_DOWN : ARROW_UP).repeat(Math.abs(diff));
  return `${arrows}\r`;
};

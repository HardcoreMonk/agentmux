import type { TAgentPanelType } from '@/types/terminal';

export const AGENT_REPORT_PREFIX = '[agentmux report';
export const AGENT_REPORT_MAX_MESSAGE_CHARS = 800;

export type TAgentReportEvent = 'done' | 'blocked';

export interface IAgentReportInput {
  childTabId: string;
  childName: string | null;
  provider: TAgentPanelType;
  event: TAgentReportEvent;
  lastMessage: string | null;
}

export interface IAgentReportHeader {
  childLabel: string;
  provider: TAgentPanelType;
  event: TAgentReportEvent;
}

const BLOCKED_REPORT_MESSAGE =
  '이 탭이 권한 질문을 기다립니다. 사람이 그 탭에서 답해야 합니다. agentmux는 대신 답하지 않습니다.';

const HEADER_RE = /^\[agentmux report · (.+) \((claude|codex)\) · (done|blocked)\]$/;

const hardenReportBody = (message: string): string =>
  message
    .split('\n')
    .map((line) => (line.trimStart().startsWith(AGENT_REPORT_PREFIX) ? `> ${line}` : line))
    .join('\n');

const formatDoneBodyLines = (childTabId: string, lastMessage: string | null): string[] => {
  if (lastMessage === null) {
    return [`(no final message; see agentmux tab result ${childTabId})`];
  }
  const codePoints = Array.from(lastMessage);
  if (codePoints.length > AGENT_REPORT_MAX_MESSAGE_CHARS) {
    const sliced = `${codePoints.slice(0, AGENT_REPORT_MAX_MESSAGE_CHARS).join('')}…`;
    return [
      hardenReportBody(sliced),
      `full result: agentmux tab result ${childTabId}`,
    ];
  }
  return [hardenReportBody(lastMessage)];
};

export const buildAgentReport = (input: IAgentReportInput): string => {
  const label = input.childName?.trim() || input.childTabId;
  const header = `[agentmux report · ${label} (${input.provider}) · ${input.event}]`;
  const bodyLines = input.event === 'blocked'
    ? [BLOCKED_REPORT_MESSAGE]
    : formatDoneBodyLines(input.childTabId, input.lastMessage);
  const replyLine = `reply: agentmux tab send ${input.childTabId} '...'`;
  return [header, ...bodyLines, replyLine].join('\n');
};

export const combineAgentReports = (reports: string[]): string =>
  reports.join('\n\n');

export const isAgentReportText = (text: string): boolean =>
  text.trimStart().startsWith(AGENT_REPORT_PREFIX);

export const parseAgentReportHeader = (text: string): IAgentReportHeader | null => {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith(AGENT_REPORT_PREFIX)) return null;
  const firstLine = trimmed.split(/\r?\n/, 1)[0];
  const match = HEADER_RE.exec(firstLine);
  if (!match) return null;
  const childLabel = match[1].trim();
  if (!childLabel) return null;
  return {
    childLabel,
    provider: match[2] as TAgentPanelType,
    event: match[3] as TAgentReportEvent,
  };
};

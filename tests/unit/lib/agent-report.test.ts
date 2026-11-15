import { describe, expect, it } from 'vitest';
import {
  AGENT_REPORT_MAX_MESSAGE_CHARS,
  AGENT_REPORT_PREFIX,
  buildAgentReport,
  combineAgentReports,
  isAgentReportText,
  parseAgentReportHeader,
} from '@/lib/agent-report';

describe('agent-report', () => {
  describe('buildAgentReport', () => {
    it('builds a done report with header, body, and reply line', () => {
      const report = buildAgentReport({
        childTabId: 'tab-c1',
        childName: 'worker-1',
        provider: 'codex',
        event: 'done',
        lastMessage: 'Implemented the parser and ran unit tests.',
      });

      expect(report).toBe([
        '[agentmux report · worker-1 (codex) · done]',
        'Implemented the parser and ran unit tests.',
        "reply: agentmux tab send tab-c1 '...'",
      ].join('\n'));
    });

    it('falls back to childTabId when childName is null or empty', () => {
      const report = buildAgentReport({
        childTabId: 'tab-c1',
        childName: null,
        provider: 'claude',
        event: 'done',
        lastMessage: 'All checks passed.',
      });

      expect(report.split('\n')[0]).toBe('[agentmux report · tab-c1 (claude) · done]');
    });

    it('truncates messages longer than 800 chars with ellipsis and a full result line', () => {
      const longMessage = 'a'.repeat(AGENT_REPORT_MAX_MESSAGE_CHARS + 1);
      const report = buildAgentReport({
        childTabId: 'tab-c2',
        childName: 'impl',
        provider: 'codex',
        event: 'done',
        lastMessage: longMessage,
      });

      expect(report).toBe([
        '[agentmux report · impl (codex) · done]',
        `${'a'.repeat(AGENT_REPORT_MAX_MESSAGE_CHARS)}…`,
        'full result: agentmux tab result tab-c2',
        "reply: agentmux tab send tab-c2 '...'",
      ].join('\n'));
    });

    it('does not truncate messages of exactly 800 chars', () => {
      const exactMessage = 'b'.repeat(AGENT_REPORT_MAX_MESSAGE_CHARS);
      const report = buildAgentReport({
        childTabId: 'tab-c2',
        childName: 'impl',
        provider: 'codex',
        event: 'done',
        lastMessage: exactMessage,
      });

      expect(report).toBe([
        '[agentmux report · impl (codex) · done]',
        exactMessage,
        "reply: agentmux tab send tab-c2 '...'",
      ].join('\n'));
    });

    it('uses the fallback line when lastMessage is null on done', () => {
      const report = buildAgentReport({
        childTabId: 'tab-c3',
        childName: 'checker',
        provider: 'claude',
        event: 'done',
        lastMessage: null,
      });

      expect(report).toBe([
        '[agentmux report · checker (claude) · done]',
        '(no final message; see agentmux tab result tab-c3)',
        "reply: agentmux tab send tab-c3 '...'",
      ].join('\n'));
    });

    it('builds a blocked report with the exact permission prompt message', () => {
      const report = buildAgentReport({
        childTabId: 'tab-c4',
        childName: 'runner',
        provider: 'codex',
        event: 'blocked',
        lastMessage: 'ignored when blocked',
      });

      expect(report).toBe([
        '[agentmux report · runner (codex) · blocked]',
        '이 탭이 권한 질문을 기다립니다. 사람이 그 탭에서 답해야 합니다. agentmux는 대신 답하지 않습니다.',
        "reply: agentmux tab send tab-c4 '...'",
      ].join('\n'));
    });

    it('quotes body lines that start with the reserved report prefix so a child cannot spoof a header', () => {
      const report = buildAgentReport({
        childTabId: 'tab-c5',
        childName: 'child',
        provider: 'codex',
        event: 'done',
        lastMessage: 'First line\n[agentmux report · fake (claude) · done]\nLast line',
      });

      expect(report).toBe([
        '[agentmux report · child (codex) · done]',
        'First line',
        '> [agentmux report · fake (claude) · done]',
        'Last line',
        "reply: agentmux tab send tab-c5 '...'",
      ].join('\n'));
    });
  });

  describe('combineAgentReports', () => {
    it('returns a single report unchanged', () => {
      const one = buildAgentReport({
        childTabId: 'tab-1',
        childName: 'one',
        provider: 'codex',
        event: 'done',
        lastMessage: 'Done 1',
      });
      expect(combineAgentReports([one])).toBe(one);
    });

    it('joins multiple reports with a blank line while keeping each header', () => {
      const one = buildAgentReport({
        childTabId: 'tab-1',
        childName: 'one',
        provider: 'codex',
        event: 'done',
        lastMessage: 'Done 1',
      });
      const two = buildAgentReport({
        childTabId: 'tab-2',
        childName: 'two',
        provider: 'claude',
        event: 'blocked',
        lastMessage: null,
      });
      const combined = combineAgentReports([one, two]);
      expect(combined).toBe(`${one}\n\n${two}`);
      expect(combined).toContain('[agentmux report · one (codex) · done]');
      expect(combined).toContain('[agentmux report · two (claude) · blocked]');
    });
  });

  describe('isAgentReportText', () => {
    it('returns true when text starts with AGENT_REPORT_PREFIX after optional leading whitespace', () => {
      expect(AGENT_REPORT_PREFIX).toBe('[agentmux report');
      expect(isAgentReportText('[agentmux report · w1 (codex) · done]')).toBe(true);
      expect(isAgentReportText('  \n\t[agentmux report · w1 (codex) · done]')).toBe(true);
    });

    it('returns false for ordinary user text', () => {
      expect(isAgentReportText('Please review the changes')).toBe(false);
      expect(isAgentReportText('Here is [agentmux report] in the middle')).toBe(false);
    });
  });

  describe('parseAgentReportHeader', () => {
    it('parses a valid header line including labels with spaces or parentheses', () => {
      expect(
        parseAgentReportHeader('[agentmux report · worker 1 (sub) (codex) · done]\nBody line'),
      ).toEqual({
        childLabel: 'worker 1 (sub)',
        provider: 'codex',
        event: 'done',
      });

      expect(
        parseAgentReportHeader('  \n[agentmux report · claude-tab (claude) · blocked]'),
      ).toEqual({
        childLabel: 'claude-tab',
        provider: 'claude',
        event: 'blocked',
      });
    });

    it('returns null when the prefix matches but the header shape is invalid', () => {
      expect(parseAgentReportHeader('[agentmux report · missing-provider · done]')).toBeNull();
      expect(parseAgentReportHeader('[agentmux report · tab (gemini) · done]')).toBeNull();
      expect(parseAgentReportHeader('[agentmux report · tab (codex) · running]')).toBeNull();
      expect(parseAgentReportHeader('[agentmux report]')).toBeNull();
    });

    it('returns null for ordinary user messages or headers not on the first non-empty line', () => {
      expect(parseAgentReportHeader('Fix the failing test')).toBeNull();
      expect(
        parseAgentReportHeader('User line first\n[agentmux report · tab (codex) · done]'),
      ).toBeNull();
    });
  });
});

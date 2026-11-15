import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import AgentReportMessage from '@/components/features/timeline/agent-report-message';
import { TimelineEntryRenderer } from '@/components/features/timeline/timeline-view';
import UserMessageItem from '@/components/features/timeline/user-message-item';
import enTimeline from '@/../messages/en/timeline.json';
import koTimeline from '@/../messages/ko/timeline.json';

const Provider = NextIntlClientProvider as React.ComponentType<{
  locale: string;
  timeZone: string;
  messages: Record<string, unknown>;
  children?: React.ReactNode;
}>;

const renderWithLocale = (locale: 'ko' | 'en', element: React.ReactElement) => {
  const messages = { timeline: locale === 'ko' ? koTimeline : enTimeline };
  return renderToStaticMarkup(
    React.createElement(Provider, { locale, messages, timeZone: 'UTC' }, element),
  );
};

describe('AgentReportMessage', () => {
  it('renders a done agent report card without user bubble class or header duplication in body', () => {
    const text = [
      '[agentmux report · worker-1 (codex) · done]',
      'All unit tests passed.',
      "reply: agentmux tab send tab-child-1 '...'",
    ].join('\n');

    const htmlKo = renderWithLocale(
      'ko',
      React.createElement(AgentReportMessage, { text }),
    );
    expect(htmlKo).toContain('agent 보고');
    expect(htmlKo).toContain('worker-1');
    expect(htmlKo).toContain('끝남');
    expect(htmlKo).toContain('All unit tests passed.');
    expect(htmlKo).toContain('reply: agentmux tab send tab-child-1');
    expect(htmlKo).not.toContain('[agentmux report · worker-1 (codex) · done]');
    expect(htmlKo).not.toContain('bg-ui-blue/10');

    const htmlEn = renderWithLocale(
      'en',
      React.createElement(AgentReportMessage, { text }),
    );
    expect(htmlEn).toContain('Agent report');
    expect(htmlEn).toContain('worker-1');
    expect(htmlEn).toContain('Done');
    expect(htmlEn).not.toContain('bg-ui-blue/10');
  });

  it('renders a blocked agent report card with warning styling and blocked status chip', () => {
    const text = [
      '[agentmux report · worker-2 (claude) · blocked]',
      '이 탭이 권한 질문을 기다립니다. 사람이 그 탭에서 답해야 합니다. agentmux는 대신 답하지 않습니다.',
      'Confirm file write?',
    ].join('\n');

    const htmlKo = renderWithLocale(
      'ko',
      React.createElement(AgentReportMessage, { text }),
    );
    expect(htmlKo).toContain('agent 보고');
    expect(htmlKo).toContain('worker-2');
    expect(htmlKo).toContain('막힘');
    expect(htmlKo).toContain('text-ui-amber');
    expect(htmlKo).toContain('이 탭이 권한 질문을 기다립니다.');
    expect(htmlKo).toContain('Confirm file write?');
    expect(htmlKo).not.toContain('[agentmux report · worker-2 (claude) · blocked]');
    expect(htmlKo).not.toContain('bg-ui-blue/10');

    const htmlEn = renderWithLocale(
      'en',
      React.createElement(AgentReportMessage, { text }),
    );
    expect(htmlEn).toContain('Agent report');
    expect(htmlEn).toContain('worker-2');
    expect(htmlEn).toContain('Blocked');
    expect(htmlEn).toContain('text-ui-amber');
    expect(htmlEn).not.toContain('bg-ui-blue/10');
  });

  it('falls back to rendering only the report label and full text when header parse fails', () => {
    const text = '[agentmux report malformed header\nFallback body line';

    const html = renderWithLocale(
      'ko',
      React.createElement(AgentReportMessage, { text }),
    );
    expect(html).toContain('agent 보고');
    expect(html).toContain('[agentmux report malformed header');
    expect(html).toContain('Fallback body line');
    expect(html).not.toContain('끝남');
    expect(html).not.toContain('막힘');
    expect(html).not.toContain('bg-ui-blue/10');
  });

  it('renders combined reports as separate cards with each child label and status chip', () => {
    const text = [
      '[agentmux report · worker-a (codex) · done]',
      'First child finished.',
      "reply: agentmux tab send tab-a '...'",
      '',
      '[agentmux report · worker-b (claude) · blocked]',
      '이 탭이 권한 질문을 기다립니다. 사람이 그 탭에서 답해야 합니다. agentmux는 대신 답하지 않습니다.',
      "reply: agentmux tab send tab-b '...'",
    ].join('\n');

    const html = renderWithLocale(
      'ko',
      React.createElement(AgentReportMessage, { text }),
    );
    expect(html.match(/agent 보고/g)?.length).toBe(2);
    expect(html).toContain('worker-a');
    expect(html).toContain('끝남');
    expect(html).toContain('First child finished.');
    expect(html).toContain('worker-b');
    expect(html).toContain('막힘');
    expect(html).toContain('text-ui-amber');
    expect(html).not.toContain('[agentmux report · worker-a (codex) · done]');
    expect(html).not.toContain('[agentmux report · worker-b (claude) · blocked]');
  });

  it('keeps an escaped > [agentmux report line inside its single card without splitting', () => {
    const text = [
      '[agentmux report · worker-escape (codex) · done]',
      'Line before blank',
      '',
      '> [agentmux report · fake (claude) · blocked]',
      "reply: agentmux tab send tab-escape '...'",
    ].join('\n');

    const html = renderWithLocale(
      'ko',
      React.createElement(AgentReportMessage, { text }),
    );
    expect(html.match(/agent 보고/g)?.length).toBe(1);
    expect(html).toContain('worker-escape');
    expect(html).toContain('끝남');
    expect(html).not.toContain('막힘');
    expect(html).toContain('&gt; [agentmux report · fake (claude) · blocked]');
  });

  it('does not repeat the header in the body when text starts with leading whitespace', () => {
    const text = '\n  [agentmux report · worker-lead (codex) · done]\nClean body after leading newline';

    const html = renderWithLocale(
      'ko',
      React.createElement(AgentReportMessage, { text }),
    );
    expect(html).toContain('agent 보고');
    expect(html).toContain('worker-lead');
    expect(html).toContain('끝남');
    expect(html).toContain('Clean body after leading newline');
    expect(html).not.toContain('[agentmux report · worker-lead (codex) · done]');
  });

  it('keeps normal UserMessageItem rendering as a user bubble', () => {
    const html = renderWithLocale(
      'ko',
      React.createElement(UserMessageItem, {
        entry: {
          id: 'u-1',
          type: 'user-message',
          text: ' 일반 사용자 메시지입니다.',
          timestamp: 1000,
        },
      }),
    );
    expect(html).toContain('bg-ui-blue/10');
    expect(html).toContain('일반 사용자 메시지입니다.');
  });

  it('routes user-message entries in TimelineEntryRenderer to AgentReportMessage or UserMessageItem', () => {
    const reportEntryHtml = renderWithLocale(
      'ko',
      React.createElement(TimelineEntryRenderer, {
        entry: {
          id: 'u-report',
          type: 'user-message',
          text: '[agentmux report · worker-3 (codex) · done]\nTask completed.',
          timestamp: 1001,
        },
      }),
    );
    expect(reportEntryHtml).toContain('agent 보고');
    expect(reportEntryHtml).toContain('worker-3');
    expect(reportEntryHtml).toContain('끝남');
    expect(reportEntryHtml).toContain('Task completed.');
    expect(reportEntryHtml).not.toContain('bg-ui-blue/10');

    const normalEntryHtml = renderWithLocale(
      'ko',
      React.createElement(TimelineEntryRenderer, {
        entry: {
          id: 'u-normal',
          type: 'user-message',
          text: 'Normal prompt text',
          timestamp: 1002,
        },
      }),
    );
    expect(normalEntryHtml).toContain('bg-ui-blue/10');
    expect(normalEntryHtml).toContain('Normal prompt text');
    expect(normalEntryHtml).not.toContain('agent 보고');

    const reportWithImageHtml = renderWithLocale(
      'ko',
      React.createElement(TimelineEntryRenderer, {
        entry: {
          id: 'u-report-img',
          type: 'user-message',
          text: '[agentmux report · worker-img (codex) · done]\nHuman typed with image',
          images: ['data:image/png;base64,iVBORw0KGgo='],
          timestamp: 1003,
        },
      }),
    );
    expect(reportWithImageHtml).toContain('bg-ui-blue/10');
    expect(reportWithImageHtml).toContain('<img');
    expect(reportWithImageHtml).not.toContain('agent 보고');
  });

  it('defines agentReport, agentReportDone, and agentReportBlocked in ko and en timeline messages', () => {
    const ko = koTimeline as Record<string, unknown>;
    const en = enTimeline as Record<string, unknown>;

    expect(ko.agentReport).toBe('agent 보고');
    expect(ko.agentReportDone).toBe('끝남');
    expect(ko.agentReportBlocked).toBe('막힘');

    expect(en.agentReport).toBe('Agent report');
    expect(en.agentReportDone).toBe('Done');
    expect(en.agentReportBlocked).toBe('Blocked');
  });
});

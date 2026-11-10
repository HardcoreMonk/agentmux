import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import SessionExplorer, {
  getNextSessionResultIndex,
} from '@/components/features/session-explorer/session-explorer';
import enMessages from '@/../messages/en/sessionExplorer.json';
import koMessages from '@/../messages/ko/sessionExplorer.json';

const IntlProvider = NextIntlClientProvider as React.ComponentType<{
  locale: string;
  messages: Record<string, unknown>;
  children?: React.ReactNode;
}>;

const renderExplorer = (locale: 'ko' | 'en', overrides: Record<string, unknown> = {}): string =>
  renderToStaticMarkup(React.createElement(IntlProvider, {
    locale,
    messages: { sessionExplorer: locale === 'ko' ? koMessages : enMessages },
  }, React.createElement(SessionExplorer, {
      query: { query: '' },
      page: { results: [], nextCursor: null, total: 0, health: 'ready' },
      health: {
        state: 'ready', queueLag: 0, cursorAgeMs: 0, rebuildState: 'idle',
        indexedSessions: 1, lastIndexedAt: '2026-08-21T09:00:00.000Z',
      },
      loading: false,
      error: null,
      selectedIndex: -1,
      onQueryChange: vi.fn(),
      onSearch: vi.fn(),
      onSelectIndex: vi.fn(),
      onOpenSession: vi.fn(),
      onTogglePin: vi.fn(),
      onRebuild: vi.fn(),
      ...overrides,
    })));

describe('Session Explorer', () => {
  it('renders dense localized filters, index health, and the empty state', () => {
    const ko = renderExplorer('ko');
    expect(ko).toContain('세션 검색');
    expect(ko).toContain('모델');
    expect(ko).toContain('프로젝트');
    expect(ko).toContain('마지막 인덱싱');
    expect(ko).toContain('검색 결과가 없습니다');
    expect(ko).toContain('min-h-11');
  });

  it('renders relationship and annotation badges without exposing paths or commands', () => {
    const markup = renderExplorer('en', {
      page: {
        results: [{
          entry: {
            sessionId: 'session-child', projectLabel: 'codexmux', model: 'gpt-5',
            startedAt: '2026-08-21T08:00:00.000Z', lastActivityAt: '2026-08-21T08:30:00.000Z',
            turnCount: 4, indexedAt: '2026-08-21T09:00:00.000Z', relationship: 'subagent',
          },
          snippet: 'Implemented the worker boundary',
          annotation: { sessionId: 'session-child', pinned: true, tags: ['review'], version: 1, updatedAt: '2026-08-21T09:00:00.000Z' },
        }],
        nextCursor: null,
        total: 1,
        health: 'ready',
      },
    });
    expect(markup).toContain('Sub-agent');
    expect(markup).toContain('review');
    expect(markup).toContain('Implemented the worker boundary');
    expect(markup).toContain('<div role="option"');
    expect(markup).not.toContain('<button type="button" role="option"');
    expect(markup).not.toContain('/home/');
    expect(markup).not.toContain('rm -rf');
  });

  it('marks the selected result with persistent neutral selection semantics', () => {
    const markup = renderExplorer('en', {
      selectedIndex: 0,
      page: {
        results: [{
          entry: {
            sessionId: 'session-selected', projectLabel: 'codexmux', model: 'gpt-5',
            startedAt: '2026-08-21T08:00:00.000Z', lastActivityAt: '2026-08-21T08:30:00.000Z',
            turnCount: 2, indexedAt: '2026-08-21T09:00:00.000Z', relationship: 'root',
          },
          snippet: 'Selected session',
        }],
        nextCursor: null,
        total: 1,
        health: 'ready',
      },
    });
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('data-selection-marker="true"');
    expect(markup).toContain('bg-accent/70');
    expect(markup).not.toContain('border-agent-active/40 bg-agent-active/5');
  });

  it('renders degraded state and explains rebuild safety in both locales', () => {
    const en = renderExplorer('en', {
      error: 'catalog-unavailable',
      health: { state: 'degraded', queueLag: 0, cursorAgeMs: null, rebuildState: 'idle', indexedSessions: 0, lastIndexedAt: null },
    });
    const ko = renderExplorer('ko', {
      error: 'catalog-unavailable',
      health: { state: 'degraded', queueLag: 0, cursorAgeMs: null, rebuildState: 'idle', indexedSessions: 0, lastIndexedAt: null },
    });
    expect(en).toContain('does not delete original agent sessions');
    expect(ko).toContain('에이전트 원본 세션을 삭제하지 않습니다');
  });

  it('renders a provider icon and label on each result row', () => {
    const entry = (sessionId: string, provider: 'codex' | 'claude') => ({
      entry: {
        sessionId, provider, projectLabel: 'agentmux', model: 'm',
        startedAt: '2026-08-21T08:00:00.000Z', lastActivityAt: '2026-08-21T08:30:00.000Z',
        turnCount: 2, indexedAt: '2026-08-21T09:00:00.000Z', relationship: 'root',
      },
      snippet: 'row',
    });
    const markup = renderExplorer('en', {
      page: { results: [entry('s-codex', 'codex'), entry('s-claude', 'claude')], nextCursor: null, total: 2, health: 'ready' },
    });
    expect(markup).toContain('data-provider="codex"');
    expect(markup).toContain('data-provider="claude"');
    expect(markup).toContain('Claude Code');
  });

  it('renders an accessible provider filter with the active selection', () => {
    const en = renderExplorer('en', { query: { query: '', providers: ['claude'] } });
    expect(en).toContain('role="group"');
    expect(en).toContain('aria-label="Filter by agent"');
    expect(en).toMatch(/data-filter="claude"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-filter="claude"/);
    expect(en).toMatch(/data-filter="all"[^>]*aria-pressed="false"|aria-pressed="false"[^>]*data-filter="all"/);
    expect(en).toContain('min-h-11');
    expect(en).toContain('keep-all');
    const ko = renderExplorer('ko');
    expect(ko).toContain('에이전트별 보기');
    expect(ko).toMatch(/data-filter="all"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-filter="all"/);
  });

  it('keeps the rebuild safety copy provider neutral', () => {
    const health = { state: 'degraded', queueLag: 0, cursorAgeMs: null, rebuildState: 'idle', indexedSessions: 0, lastIndexedAt: null };
    expect(renderExplorer('en', { error: 'x', health })).not.toContain('Codex sessions');
    expect(renderExplorer('ko', { error: 'x', health })).not.toContain('Codex 원본');
  });

  it('supports bounded Arrow navigation', () => {
    expect(getNextSessionResultIndex(-1, 'ArrowDown', 3)).toBe(0);
    expect(getNextSessionResultIndex(0, 'ArrowUp', 3)).toBe(2);
    expect(getNextSessionResultIndex(2, 'ArrowDown', 3)).toBe(0);
    expect(getNextSessionResultIndex(1, 'Enter', 3)).toBe(1);
    expect(getNextSessionResultIndex(-1, 'ArrowDown', 0)).toBe(-1);
  });
});

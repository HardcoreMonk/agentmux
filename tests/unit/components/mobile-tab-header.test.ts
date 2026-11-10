import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ITabState } from '@/hooks/use-tab-store';
import type { TPanelType } from '@/types/terminal';
import koMobile from '@/../messages/ko/mobile.json';
import enMobile from '@/../messages/en/mobile.json';
import koTerminal from '@/../messages/ko/terminal.json';
import enTerminal from '@/../messages/en/terminal.json';
import koCommon from '@/../messages/ko/common.json';
import enCommon from '@/../messages/en/common.json';

const state = vi.hoisted(() => ({
  tabs: {} as Record<string, ITabState>,
}));

// The popover portal does not render on the server; keep what the header puts inside it.
const popover = vi.hoisted(() => ({ content: null as React.ReactNode }));

vi.mock('@/hooks/use-tab-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/hooks/use-tab-store')>(),
  default: (selector: (value: typeof state) => unknown) => selector(state),
}));

vi.mock('@/components/ui/popover', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/popover')>();
  const PopoverContent = (props: React.ComponentProps<typeof actual.PopoverContent>) => {
    popover.content = props.children;
    return React.createElement(actual.PopoverContent, props);
  };
  return { ...actual, PopoverContent };
});

import MobileTabHeader from '@/components/features/mobile/mobile-tab-header';
import { PanelModeOptions } from '@/components/features/mobile/mobile-panel-mode-switcher';

const Provider = NextIntlClientProvider as React.ComponentType<{
  locale: string;
  timeZone: string;
  messages: Record<string, unknown>;
  children?: React.ReactNode;
}>;

const renderHeader = (
  panelType: TPanelType,
  onSwitchPanelType: (type: TPanelType) => void = () => undefined,
  locale: 'ko' | 'en' = 'en',
) => renderToStaticMarkup(React.createElement(Provider, {
  locale,
  timeZone: 'Asia/Seoul',
  messages: locale === 'ko'
    ? { mobile: koMobile, terminal: koTerminal, common: koCommon }
    : { mobile: enMobile, terminal: enTerminal, common: enCommon },
}, React.createElement(MobileTabHeader, {
  tabId: 'tab-a',
  tabName: 'build-and-test',
  sessionName: 'pt-ws-a-pane-a-tab-a',
  panelType,
  onSwitchPanelType,
  onCreateTab: () => undefined,
  onClose: () => undefined,
})));

const findTrigger = (html: string): string | undefined =>
  html.match(/<button[^>]*data-slot="panel-mode-menu-trigger"[^>]*>/)?.[0];

const optionButtons = (element: React.ReactElement<{ children: React.ReactElement[] }>) =>
  React.Children.toArray(element.props.children) as React.ReactElement<{ onClick: () => void }>[];

describe('MobileTabHeader panel mode switcher', () => {
  beforeEach(() => {
    state.tabs = {};
    popover.content = null;
  });

  it('keeps the four mode buttons above 440px and one menu button below it', () => {
    const html = renderHeader('terminal');
    const group = html.match(/<div[^>]*data-slot="panel-mode-buttons"[^>]*>/)?.[0] ?? '';
    expect(group).toContain('max-[440px]:hidden');
    expect(html.match(/aria-label="(Terminal|Codex|Claude Code|Diff)"/g)).toHaveLength(4);

    const trigger = findTrigger(html);
    expect(trigger).toBeDefined();
    expect(trigger).toContain('hidden');
    expect(trigger).toContain('max-[440px]:flex');
    expect(trigger).toContain('h-11 w-11');
    expect(trigger).toContain('focus-visible:ring-1');
    expect(trigger).toContain('aria-haspopup="dialog"');
    expect(trigger).toContain('aria-expanded="false"');
  });

  it('names the menu button after the current mode in en and ko', () => {
    expect(findTrigger(renderHeader('terminal'))).toContain('aria-label="Panel mode: Terminal"');
    expect(findTrigger(renderHeader('claude'))).toContain('aria-label="Panel mode: Claude Code"');
    expect(findTrigger(renderHeader('diff', undefined, 'ko'))).toContain('aria-label="패널 모드: Diff"');
  });

  it('keeps the tab name truncating next to the switcher', () => {
    expect(renderHeader('terminal')).toMatch(/<span class="truncate[^"]*">build-and-test<\/span>/);
  });

  it('lists all four modes with labels in 44px rows when opened', () => {
    renderHeader('codex');
    expect(React.isValidElement(popover.content)).toBe(true);
    const html = renderToStaticMarkup(popover.content as React.ReactElement);
    for (const label of ['Terminal', 'Codex', 'Claude Code', 'Diff']) {
      expect(html).toContain(`>${label}</span>`);
    }
    expect(html.match(/<button[^>]*class="flex h-11 w-full/g)).toHaveLength(4);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it('switches through the same handler when a mode is selected', () => {
    const onSwitchPanelType = vi.fn();
    renderHeader('terminal', onSwitchPanelType);
    const content = popover.content as React.ReactElement<React.ComponentProps<typeof PanelModeOptions>>;
    expect(content.type).toBe(PanelModeOptions);

    const buttons = optionButtons(PanelModeOptions(content.props) as React.ReactElement<{ children: React.ReactElement[] }>);
    expect(buttons).toHaveLength(4);
    buttons[2].props.onClick();
    buttons[3].props.onClick();

    expect(onSwitchPanelType.mock.calls).toEqual([['claude'], ['diff']]);
  });
});

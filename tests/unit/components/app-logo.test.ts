import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AppLogo from '@/components/layout/app-logo';

const visibleText = (html: string) => html.replace(/<[^>]*>/g, '');

describe('AppLogo', () => {
  it.each(['sm', 'xl'] as const)('renders the agentmux wordmark at size %s', (size) => {
    const text = visibleText(renderToStaticMarkup(React.createElement(AppLogo, { size })));
    expect(text).toBe('agentmux');
  });
});

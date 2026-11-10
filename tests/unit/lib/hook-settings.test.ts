import { describe, expect, it } from 'vitest';

import { buildHookSettings } from '@/lib/hook-settings';

describe('hook settings', () => {
  it('keeps global hooks empty because session hooks use native layer discovery', () => {
    const settings = buildHookSettings();

    expect(settings.hooks).toEqual({});
    expect(settings.statusLine.command).toContain('statusline.cjs');
  });
});

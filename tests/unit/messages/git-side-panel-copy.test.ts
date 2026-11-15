import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readJson = (locale: string, namespace: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(process.cwd(), `messages/${locale}/${namespace}.json`), 'utf-8'));

const DIFF_KEYS = ['sidePanelEmpty', 'sidePanelClose', 'askAgentNoInput'] as const;
const TERMINAL_KEYS = ['gitPanelOpen', 'gitPanelClose'] as const;

describe('git side panel copy', () => {
  for (const locale of ['ko', 'en'] as const) {
    it(`has every Git side panel diff key in ${locale}`, () => {
      const diff = readJson(locale, 'diff');
      for (const key of DIFF_KEYS) {
        expect(diff[key], `${locale}.diff.${key}`).toBeTypeOf('string');
        expect((diff[key] as string).length).toBeGreaterThan(0);
      }
    });

    it(`has every Git side panel terminal key in ${locale}`, () => {
      const terminal = readJson(locale, 'terminal');
      for (const key of TERMINAL_KEYS) {
        expect(terminal[key], `${locale}.terminal.${key}`).toBeTypeOf('string');
        expect((terminal[key] as string).length).toBeGreaterThan(0);
      }
    });
  }
});

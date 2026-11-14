import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readJson = (locale: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(process.cwd(), `messages/${locale}/terminal.json`), 'utf-8'));

const CODEX_ASSIST_KEYS = [
  'codexHooksTitle',
  'codexHooksChanged',
  'codexHooksTrusting',
  'codexHooksTrustButton',
  'codexHooksSkipButton',
  'codexHooksTrustDescription',
  'codexHooksReviewOutside',
  'codexUpdateTitle',
  'codexUpdateTitleNoVersion',
  'codexUpdateNow',
  'codexUpdateSkip',
  'codexUpdateSkipVersion',
  'codexUpdating',
  'codexUpdateSuccess',
  'codexUpdateFailed',
  'codexUpdateRestart',
];

describe('codex assist copy', () => {
  for (const locale of ['ko', 'en']) {
    it(`has every Codex assist key in ${locale}`, () => {
      const messages = readJson(locale);
      for (const key of CODEX_ASSIST_KEYS) {
        expect(messages[key], `${locale}.${key}`).toBeTypeOf('string');
        expect((messages[key] as string).length).toBeGreaterThan(0);
      }
    });
  }
});

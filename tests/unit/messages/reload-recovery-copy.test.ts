import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readJson = (locale: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(process.cwd(), `messages/${locale}/connection.json`), 'utf-8'));

const RELOAD_RECOVERY_KEYS = [
  'reloadRecoveryMessage',
  'reloadRecoveryAction',
];

describe('reload recovery copy', () => {
  for (const locale of ['ko', 'en']) {
    it(`has every reload recovery key in ${locale}`, () => {
      const messages = readJson(locale);
      for (const key of RELOAD_RECOVERY_KEYS) {
        expect(messages[key], `${locale}.${key}`).toBeTypeOf('string');
        expect((messages[key] as string).length).toBeGreaterThan(0);
      }
    });
  }
});

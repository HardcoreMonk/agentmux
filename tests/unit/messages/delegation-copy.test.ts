import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readJson = (path: string) => JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf-8'));

const getPath = (obj: Record<string, unknown>, path: string): unknown =>
  path.split('.').reduce<unknown>((acc, key) => (acc as Record<string, unknown> | undefined)?.[key], obj);

// [namespace file, dotted key]
const DELEGATION_KEYS: Array<[string, string]> = [
  ['settings', 'general.delegationGuide'],
  ['settings', 'general.delegationGuideDescription'],
  ['workspace', 'createdByAgent'],
];

describe('delegation copy', () => {
  for (const locale of ['ko', 'en'] as const) {
    for (const [file, key] of DELEGATION_KEYS) {
      it(`${locale}/${file}.${key} exists`, () => {
        const value = getPath(readJson(`messages/${locale}/${file}.json`), key);
        expect(value).toBeTypeOf('string');
        expect((value as string).length).toBeGreaterThan(0);
      });
    }
  }
});

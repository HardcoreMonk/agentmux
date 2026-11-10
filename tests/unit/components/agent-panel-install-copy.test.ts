import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

const readJson = (path: string) => JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf-8'));
const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf-8');

describe('agent panel install copy', () => {
  for (const locale of ['ko', 'en'] as const) {
    it(`resolves installCodex copy from the timeline namespace (${locale})`, () => {
      const timeline = readJson(`messages/${locale}/timeline.json`);
      expect(timeline.installCodex).toBeTypeOf('string');
      expect(timeline.installCodexHint).toBeTypeOf('string');
      const t = createTranslator({ locale, messages: { timeline }, namespace: 'timeline' });
      for (const key of ['installCodex', 'installCodexHint'] as const) {
        const text = t(key);
        expect(text).not.toBe(key);
        expect(text).not.toContain('timeline.');
      }
    });
  }

  for (const file of [
    'src/components/features/workspace/agent-panel.tsx',
    'src/components/features/mobile/mobile-agent-panel.tsx',
  ]) {
    it(`${file} reads installCodex through the timeline translator`, () => {
      const source = readSource(file);
      expect(source).toContain("useTranslations('timeline')");
      expect(source).toMatch(/tTimeline\('installCodex'\)/);
      expect(source).toMatch(/tTimeline\('installCodexHint'\)/);
    });
  }
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

const readJson = (path: string) => JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf-8'));
const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf-8');

describe('agent panel install copy', () => {
  for (const locale of ['ko', 'en'] as const) {
    it(`resolves installAgent copy from the timeline namespace (${locale})`, () => {
      const timeline = readJson(`messages/${locale}/timeline.json`);
      expect(timeline.installAgent).toBeTypeOf('string');
      expect(timeline.installAgentHint).toBeTypeOf('string');
      const t = createTranslator({ locale, messages: { timeline }, namespace: 'timeline' });
      const installText = t('installAgent', { agent: 'Claude Code' });
      expect(installText).toContain('Claude Code');
      const hintText = t('installAgentHint', { agent: 'Claude Code', path: '~/.claude' });
      expect(hintText).toContain('Claude Code');
      expect(hintText).toContain('~/.claude');
      for (const text of [installText, hintText]) expect(text).not.toContain('timeline.');
    });
  }

  for (const file of [
    'src/components/features/workspace/agent-panel.tsx',
    'src/components/features/mobile/mobile-agent-panel.tsx',
  ]) {
    it(`${file} reads installAgent through the timeline translator`, () => {
      const source = readSource(file);
      expect(source).toContain("useTranslations('timeline')");
      expect(source).toMatch(/tTimeline\('installAgent',/);
      expect(source).toMatch(/tTimeline\('installAgentHint',/);
    });
  }
});

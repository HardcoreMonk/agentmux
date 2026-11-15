import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { isAgentComposerEmpty } from '@/lib/agent-composer';

const fixture = (name: string): string =>
  fs.readFileSync(
    path.join(process.cwd(), 'tests/fixtures/agent-composer', `${name}.ansi.txt`),
    'utf-8',
  );

describe('isAgentComposerEmpty', () => {
  describe('Codex composer fixtures', () => {
    it.each(['codex-empty', 'codex-working', 'codex-done'])(
      'returns true for %s when only the dim placeholder is shown',
      (name) => {
        expect(isAgentComposerEmpty('codex', fixture(name))).toBe(true);
      },
    );

    it.each(['codex-draft', 'codex-draft-leading-newline', 'codex-paste'])(
      'returns false for %s when user draft text is present',
      (name) => {
        expect(isAgentComposerEmpty('codex', fixture(name))).toBe(false);
      },
    );

    it('evaluates the last › line rather than an earlier transcript › line in codex-done', () => {
      const doneLines = fixture('codex-done').split('\n');
      const onlyTranscriptLines = doneLines.slice(0, 15).join('\n');
      expect(isAgentComposerEmpty('codex', onlyTranscriptLines)).toBe(false);
      expect(isAgentComposerEmpty('codex', fixture('codex-done'))).toBe(true);
    });
  });

  describe('Claude composer fixtures', () => {
    it.each(['claude-empty', 'claude-working', 'claude-done'])(
      'returns true for %s when the composer has no draft text above the border',
      (name) => {
        expect(isAgentComposerEmpty('claude', fixture(name))).toBe(true);
      },
    );

    it.each(['claude-draft', 'claude-draft-leading-newline', 'claude-paste'])(
      'returns false for %s when user draft text is present',
      (name) => {
        expect(isAgentComposerEmpty('claude', fixture(name))).toBe(false);
      },
    );
  });

  describe('unrecognized screens and SGR parameter handling', () => {
    it('returns null when the screen has no composer marker line', () => {
      expect(isAgentComposerEmpty('codex', '')).toBeNull();
      expect(isAgentComposerEmpty('claude', '')).toBeNull();
      expect(isAgentComposerEmpty('codex', '$ ls -la\ntotal 0\n')).toBeNull();
      expect(isAgentComposerEmpty('claude', '$ ls -la\ntotal 0\n')).toBeNull();
    });

    it('handles combined SGR parameters (1;2, 22, empty m) on the composer line', () => {
      const codexCombinedDim = '\u001b[1m›\u001b[0m \u001b[1;2mPlaceholder\u001b[m';
      expect(isAgentComposerEmpty('codex', codexCombinedDim)).toBe(true);

      const codexResetDim = '\u001b[1m›\u001b[0m \u001b[1;2mDim\u001b[22mTyped\u001b[m';
      expect(isAgentComposerEmpty('codex', codexResetDim)).toBe(false);

      const claudeCombinedDim = [
        '\u001b[39m❯\u00a0\u001b[1;2mTry something\u001b[m',
        '\u001b[38;2;136;136;136m────────────────────────',
      ].join('\n');
      expect(isAgentComposerEmpty('claude', claudeCombinedDim)).toBe(true);
    });

    it('does not read a 2 inside an extended color as dim', () => {
      const rgbDraft = '\u001b[1m›\u001b[0m \u001b[38;2;10;2;3mdraft\u001b[39m';
      expect(isAgentComposerEmpty('codex', rgbDraft)).toBe(false);
      const paletteDraft = '\u001b[1m›\u001b[0m \u001b[38;5;2mdraft\u001b[39m';
      expect(isAgentComposerEmpty('codex', paletteDraft)).toBe(false);
    });
  });
});

import { describe, expect, it } from 'vitest';
import { buildDiffCardFingerprint } from '@/lib/diff-card-fingerprint';

describe('buildDiffCardFingerprint', () => {
  it('returns the same fingerprint for identical hunks and counts', () => {
    const file = {
      hunks: ['@@ -1 +1 @@\n-foo\n+bar'],
      additions: 1,
      deletions: 1,
    };
    expect(buildDiffCardFingerprint(file)).toBe(buildDiffCardFingerprint({ ...file, hunks: [...file.hunks] }));
    expect(buildDiffCardFingerprint(file)).toMatch(/^1:1:1:[0-9a-z]+$/);
  });

  it('produces different fingerprints when counts match but hunk content differs', () => {
    const a = buildDiffCardFingerprint({
      hunks: ['@@ -1 +1 @@\n-foo\n+bar'],
      additions: 1,
      deletions: 1,
    });
    const b = buildDiffCardFingerprint({
      hunks: ['@@ -1 +1 @@\n-foo\n+baz'],
      additions: 1,
      deletions: 1,
    });
    expect(a).not.toBe(b);
  });

  it('produces different fingerprints when the number of hunks differs', () => {
    const oneHunk = buildDiffCardFingerprint({
      hunks: ['@@ -1 +1 @@\n-foo\n+bar'],
      additions: 1,
      deletions: 1,
    });
    const twoHunks = buildDiffCardFingerprint({
      hunks: ['@@ -1 +1 @@\n-foo\n+bar', '@@ -10 +10 @@\n-old\n+new'],
      additions: 1,
      deletions: 1,
    });
    expect(oneHunk).not.toBe(twoHunks);
  });

  it('handles empty hunks without throwing', () => {
    const empty = buildDiffCardFingerprint({
      hunks: [],
      additions: 0,
      deletions: 0,
    });
    expect(typeof empty).toBe('string');
    expect(empty).toMatch(/^0:0:0:[0-9a-z]+$/);
  });
});

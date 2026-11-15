import { describe, expect, it, vi } from 'vitest';
import {
  buildChangedFilesSignature,
  listPorcelainZPaths,
} from '@/lib/diff-hash-input';

describe('listPorcelainZPaths', () => {
  it('extracts modified and untracked paths separated by NUL', () => {
    expect(listPorcelainZPaths(' M a.txt\0?? new.txt\0')).toEqual(['a.txt', 'new.txt']);
  });

  it('includes both new and original paths for rename and copy entries', () => {
    expect(listPorcelainZPaths('R  new.txt\0old.txt\0C  copy.txt\0src.txt\0')).toEqual([
      'new.txt',
      'old.txt',
      'copy.txt',
      'src.txt',
    ]);
  });

  it('preserves spaces in file paths', () => {
    expect(listPorcelainZPaths(' M dir/a b.txt\0')).toEqual(['dir/a b.txt']);
  });

  it('returns an empty array for empty output', () => {
    expect(listPorcelainZPaths('')).toEqual([]);
  });
});

describe('buildChangedFilesSignature', () => {
  it('produces a different signature when only mtimeMs changes', async () => {
    const first = await buildChangedFilesSignature(
      '/repo',
      ['x.txt'],
      async () => ({ mtimeMs: 1000, size: 12 }),
    );
    const second = await buildChangedFilesSignature(
      '/repo',
      ['x.txt'],
      async () => ({ mtimeMs: 2000, size: 12 }),
    );

    expect(first).toBe('x.txt:1000:12');
    expect(second).toBe('x.txt:2000:12');
    expect(first).not.toBe(second);
  });

  it('records path:- when statFn throws (such as deleted files)', async () => {
    const sig = await buildChangedFilesSignature(
      '/repo',
      ['deleted.txt', 'kept.txt'],
      async (fullPath) => {
        if (String(fullPath).endsWith('deleted.txt')) {
          throw new Error('ENOENT');
        }
        return { mtimeMs: 500, size: 4 };
      },
    );

    expect(sig).toBe('deleted.txt:-\nkept.txt:500:4');
  });

  it('stats at most 500 files and appends +remainder when paths exceed 500', async () => {
    const paths = Array.from({ length: 501 }, (_, i) => `f-${i}.txt`);
    const statFn = vi.fn().mockResolvedValue({ mtimeMs: 1, size: 2 });

    const sig = await buildChangedFilesSignature('/repo', paths, statFn);

    expect(statFn).toHaveBeenCalledTimes(500);
    expect(sig.endsWith('\n+1')).toBe(true);
  });
});

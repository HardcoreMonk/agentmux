import type { IGitDiffFile } from '@/lib/parse-git-diff';

const hashFnv1a = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

export const buildDiffCardFingerprint = (
  file: Pick<IGitDiffFile, 'hunks' | 'additions' | 'deletions'>,
): string => {
  const hash = hashFnv1a(file.hunks.join('\n'));
  return `${file.hunks.length}:${file.additions}:${file.deletions}:${hash}`;
};

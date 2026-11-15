import { stat } from 'fs/promises';
import { resolve } from 'path';

const MAX_SIGNATURE_FILES = 500;

export type TDiffStatFn = (
  filePath: string,
) => Promise<{ mtimeMs: number; size: number }>;

export const listPorcelainZPaths = (output: string): string[] => {
  if (!output) return [];
  const entries = output.split('\0');
  const paths: string[] = [];

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (!entry || entry.length < 4) continue;
    const statusXY = entry.slice(0, 2);
    const filePath = entry.slice(3);
    if (filePath) {
      paths.push(filePath);
    }
    if (
      statusXY[0] === 'R' ||
      statusXY[1] === 'R' ||
      statusXY[0] === 'C' ||
      statusXY[1] === 'C'
    ) {
      const origPath = entries[i + 1];
      if (origPath) {
        paths.push(origPath);
      }
      i += 1;
    }
  }

  return paths;
};

export const buildChangedFilesSignature = async (
  cwd: string,
  paths: string[],
  statFn: TDiffStatFn = stat,
): Promise<string> => {
  const slice = paths.slice(0, MAX_SIGNATURE_FILES);
  const parts = await Promise.all(
    slice.map(async (relPath) => {
      try {
        const fullPath = resolve(/* turbopackIgnore: true */ cwd, relPath);
        const info = await statFn(fullPath);
        return `${relPath}:${info.mtimeMs}:${info.size}`;
      } catch {
        return `${relPath}:-`;
      }
    }),
  );

  if (paths.length > MAX_SIGNATURE_FILES) {
    parts.push(`+${paths.length - MAX_SIGNATURE_FILES}`);
  }

  return parts.join('\n');
};

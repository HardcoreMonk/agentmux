import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { parse } from 'smol-toml';

export type TCodexInstructionsRead =
  | { ok: true; value: string | null }
  | { ok: false; reason: 'parse-error' | 'ambiguous' | 'project-defined'; detail: string };

type TTomlTable = Record<string, unknown>;

interface IFoundValue {
  source: string;
  value: string;
}

const CONFIG_FILE = 'config.toml';

const asTable = (value: unknown): TTomlTable | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as TTomlTable : null;

const readTomlFile = async (filePath: string): Promise<TTomlTable | null> => {
  try {
    return parse(await fs.readFile(filePath, 'utf-8'));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw new Error(`${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
};

const listProjectConfigPaths = (cwd: string): string[] => {
  const paths: string[] = [];
  let dir = path.resolve(cwd);
  for (;;) {
    paths.push(path.join(dir, '.codex', CONFIG_FILE));
    const parent = path.dirname(dir);
    if (parent === dir) return paths;
    dir = parent;
  }
};

const readInstructions = (table: TTomlTable | null): string | null => {
  const value = table?.developer_instructions;
  return typeof value === 'string' && value.trim() ? value : null;
};

const collect = (found: IFoundValue[], source: string, table: TTomlTable | null): void => {
  const value = readInstructions(table);
  if (value) found.push({ source, value });
};

// Codex loads project layers only for trusted projects, so a project value is never copied into the
// command; finding one leaves the guide out. Codex's precedence between the user and profile values is
// not guessed either: two different values also leave the guide out.
export const readCodexDeveloperInstructions = async (input: {
  cwd: string;
  codexHome?: string;
}): Promise<TCodexInstructionsRead> => {
  const codexHome = input.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
  const userConfigPath = path.resolve(codexHome, CONFIG_FILE);
  const found: IFoundValue[] = [];
  try {
    const user = await readTomlFile(userConfigPath);
    collect(found, userConfigPath, user);
    if (typeof user?.profile === 'string') {
      collect(found, `${userConfigPath} [profiles.${user.profile}]`, asTable(asTable(user.profiles)?.[user.profile]));
    }
    for (const filePath of listProjectConfigPaths(input.cwd)) {
      if (filePath !== userConfigPath && readInstructions(await readTomlFile(filePath))) {
        return { ok: false, reason: 'project-defined', detail: filePath };
      }
    }
  } catch (err) {
    return { ok: false, reason: 'parse-error', detail: err instanceof Error ? err.message : String(err) };
  }

  const values = new Set(found.map(({ value }) => value));
  if (values.size > 1) {
    return { ok: false, reason: 'ambiguous', detail: found.map(({ source }) => source).join(', ') };
  }
  return { ok: true, value: found[0]?.value ?? null };
};

export const mergeCodexDeveloperInstructions = (existing: string | null, guide: string): string =>
  existing ? `${existing}\n\n${guide}` : guide;

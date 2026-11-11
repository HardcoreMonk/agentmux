import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mergeCodexDeveloperInstructions,
  readCodexDeveloperInstructions,
} from '@/lib/providers/codex/developer-instructions';

let root: string;
let codexHome: string;
let project: string;
let cwd: string;

const writeConfig = async (dir: string, content: string): Promise<void> => {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'config.toml'), content);
};

describe('readCodexDeveloperInstructions', () => {
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmux-codex-di-'));
    codexHome = path.join(root, 'codex-home');
    project = path.join(root, 'project');
    cwd = path.join(project, 'src', 'lib');
    await fs.mkdir(codexHome, { recursive: true });
    await fs.mkdir(cwd, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('returns null when no config sets a value', async () => {
    await expect(readCodexDeveloperInstructions({ cwd, codexHome })).resolves.toEqual({ ok: true, value: null });
  });

  it('reads the top-level user value', async () => {
    await writeConfig(codexHome, 'model = "gpt-5.5"\ndeveloper_instructions = "user rule"\n');
    await expect(readCodexDeveloperInstructions({ cwd, codexHome }))
      .resolves.toEqual({ ok: true, value: 'user rule' });
  });

  it('reads the value of the selected profile', async () => {
    await writeConfig(codexHome, 'profile = "p"\n\n[profiles.p]\ndeveloper_instructions = "x"\n\n[profiles.q]\ndeveloper_instructions = "y"\n');
    await expect(readCodexDeveloperInstructions({ cwd, codexHome })).resolves.toEqual({ ok: true, value: 'x' });
  });

  it('accepts the same value set in user and project config', async () => {
    await writeConfig(codexHome, 'developer_instructions = "same"\n');
    await writeConfig(path.join(project, '.codex'), 'developer_instructions = "same"\n');
    await expect(readCodexDeveloperInstructions({ cwd, codexHome })).resolves.toEqual({ ok: true, value: 'same' });
  });

  it('ignores empty values', async () => {
    await writeConfig(codexHome, 'developer_instructions = "user rule"\n');
    await writeConfig(path.join(project, '.codex'), 'developer_instructions = ""\n');
    await expect(readCodexDeveloperInstructions({ cwd, codexHome }))
      .resolves.toEqual({ ok: true, value: 'user rule' });
  });

  it('reports different values as ambiguous', async () => {
    await writeConfig(codexHome, 'developer_instructions = "user rule"\n');
    await writeConfig(path.join(project, '.codex'), 'developer_instructions = "project rule"\n');
    await expect(readCodexDeveloperInstructions({ cwd, codexHome }))
      .resolves.toMatchObject({ ok: false, reason: 'ambiguous' });
  });

  it('reports a profile value that differs from the top-level value as ambiguous', async () => {
    await writeConfig(codexHome, 'profile = "p"\ndeveloper_instructions = "top"\n\n[profiles.p]\ndeveloper_instructions = "x"\n');
    await expect(readCodexDeveloperInstructions({ cwd, codexHome }))
      .resolves.toMatchObject({ ok: false, reason: 'ambiguous' });
  });

  it('reports broken TOML as a parse error', async () => {
    await writeConfig(path.join(project, '.codex'), 'developer_instructions = "unterminated\n');
    const result = await readCodexDeveloperInstructions({ cwd, codexHome });
    expect(result).toMatchObject({ ok: false, reason: 'parse-error' });
    expect(result.ok === false && result.detail).toContain(path.join(project, '.codex', 'config.toml'));

    await fs.rm(path.join(project, '.codex'), { recursive: true });
    await writeConfig(codexHome, '[profiles\n');
    await expect(readCodexDeveloperInstructions({ cwd, codexHome }))
      .resolves.toMatchObject({ ok: false, reason: 'parse-error' });
  });

  it('finds project config in a parent directory of cwd', async () => {
    await writeConfig(path.join(project, '.codex'), 'developer_instructions = "project rule"\n');
    await expect(readCodexDeveloperInstructions({ cwd, codexHome }))
      .resolves.toEqual({ ok: true, value: 'project rule' });
  });
});

describe('mergeCodexDeveloperInstructions', () => {
  it('appends the guide after an existing value', () => {
    expect(mergeCodexDeveloperInstructions('user rule', 'guide')).toBe('user rule\n\nguide');
  });

  it('uses the guide alone without an existing value', () => {
    expect(mergeCodexDeveloperInstructions(null, 'guide')).toBe('guide');
  });
});

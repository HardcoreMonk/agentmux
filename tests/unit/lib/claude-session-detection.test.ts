import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const processes = vi.hoisted(() => ({
  commands: new Map<number, string>(),
  children: new Map<number, number[]>(),
}));

vi.mock('@/lib/session-detection', () => ({
  getChildPids: async (pid: number) => processes.children.get(pid) ?? [],
  getDescendantPids: async () => [],
  getProcessCommandLine: async (pid: number) => {
    const raw = processes.commands.get(pid);
    return raw ? { command: raw.split(' ')[0], args: raw.split(' ').slice(1).join(' '), raw } : null;
  },
  getProcessCwd: async () => '/work/proj',
  getProcessStartTime: async () => 1_000,
  isProcessRunning: async () => true,
}));

import {
  detectActiveClaudeSession,
  isClaudeRunning,
  resolveClaudeJsonlPath,
  toClaudeProjectName,
} from '@/lib/providers/claude/session-detection';

const sessionA = '11111111-2222-4333-8444-aaaaaaaaaaaa';
const sessionB = '11111111-2222-4333-8444-bbbbbbbbbbbb';
let home: string;

const writePidfile = async (pid: number, body: unknown): Promise<string> => {
  const dir = path.join(home, '.claude', 'sessions');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${pid}.json`);
  await fs.writeFile(file, JSON.stringify(body));
  return file;
};

describe('claude session detection', () => {
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmux-claude-detect-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    await fs.mkdir(path.join(home, '.claude'), { recursive: true });
    processes.commands.clear();
    processes.children.clear();
    processes.children.set(100, [200]);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(home, { recursive: true, force: true });
  });

  it('maps directories to Claude project names', () => {
    expect(toClaudeProjectName('/data/projects/a.b')).toBe('-data-projects-a-b');
    const long = `/${'a'.repeat(249)}`;
    const name = toClaudeProjectName(long);
    expect(name).toMatch(/^a{0}-a{199}-[0-9a-z]+$/);
    expect(name.slice(0, 200)).toBe(long.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 200));
    expect(name[200]).toBe('-');
    expect(toClaudeProjectName(long)).toBe(name);
  });

  it('resolves a JSONL path in the project directory', async () => {
    const dir = path.join(home, '.claude', 'projects', toClaudeProjectName('/work/proj'));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${sessionA}.jsonl`), '');
    expect(await resolveClaudeJsonlPath(sessionA, '/work/proj')).toBe(path.join(dir, `${sessionA}.jsonl`));
    expect(await resolveClaudeJsonlPath(sessionB, '/work/proj')).toBeNull();
  });

  it('resolves long paths through the 200 character prefix directory', async () => {
    const cwd = `/${'b'.repeat(250)}`;
    const prefix = toClaudeProjectName(cwd).slice(0, 200);
    const dir = path.join(home, '.claude', 'projects', `${prefix}-otherhash`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${sessionA}.jsonl`), '');
    expect(await resolveClaudeJsonlPath(sessionA, cwd)).toBe(path.join(dir, `${sessionA}.jsonl`));
  });

  it('prefers the pidfile session over process args after /clear', async () => {
    processes.commands.set(200, `claude --settings /s.json --session-id ${sessionA}`);
    const file = await writePidfile(200, { pid: 200, sessionId: sessionB });
    const info = await detectActiveClaudeSession(100);
    expect(info.status).toBe('running');
    expect(info.sessionId).toBe(sessionB);
    expect(info.pid).toBe(200);
    await expect(fs.access(file)).resolves.toBeUndefined();
  });

  it('ignores a pidfile whose pid is outside the pane tree', async () => {
    processes.commands.set(200, `claude --session-id ${sessionA}`);
    await writePidfile(999, { pid: 999, sessionId: sessionB });
    expect((await detectActiveClaudeSession(100)).sessionId).toBe(sessionA);
  });

  it('falls back to --resume args without a pidfile', async () => {
    processes.commands.set(200, `claude --resume ${sessionA}`);
    expect((await detectActiveClaudeSession(100)).sessionId).toBe(sessionA);
  });

  it('skips pidfiles with an unknown format', async () => {
    processes.commands.set(200, `claude --resume ${sessionA}`);
    await writePidfile(200, { sessionId: 'not-a-uuid' });
    expect((await detectActiveClaudeSession(100)).sessionId).toBe(sessionA);
  });

  it('reports not-running when the pane has no claude process', async () => {
    processes.commands.set(200, 'vim /home/x/.claude/a');
    expect((await detectActiveClaudeSession(100)).status).toBe('not-running');
  });

  it('does not treat editors of .claude files as claude', async () => {
    processes.commands.set(200, 'vim /home/x/.claude/a');
    expect(await isClaudeRunning(100)).toBe(false);
    processes.commands.set(200, 'node /usr/lib/node_modules/@anthropic-ai/claude --resume x');
    expect(await isClaudeRunning(100)).toBe(true);
  });
});

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('node-pty', () => ({ spawn: vi.fn() }));

const SOCKET = 'codexmux-runtime-v2';
const SESSION = 'rtv2-ws-a-pane-b-tab-c';
let tmpDir = '';
let previousTmuxTmpdir: string | undefined;

const tmux = (...args: string[]): string =>
  execFileSync('tmux', ['-L', SOCKET, ...args], { env: { ...process.env, TMUX_TMPDIR: tmpDir } }).toString();

const hasTmux = (() => {
  try {
    execFileSync('tmux', ['-V']);
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasTmux)('terminal worker runtime with real tmux', () => {
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4t.'));
    previousTmuxTmpdir = process.env.TMUX_TMPDIR;
    process.env.TMUX_TMPDIR = tmpDir;
    tmux('new-session', '-d', '-s', SESSION, '-x', '80', '-y', '24', 'sh');
  });

  afterAll(() => {
    try { tmux('kill-server'); } catch { /* already gone */ }
    if (previousTmuxTmpdir === undefined) delete process.env.TMUX_TMPDIR;
    else process.env.TMUX_TMPDIR = previousTmuxTmpdir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('types into an unattached session and reads the screen back', async () => {
    const { createTerminalWorkerRuntime } = await import('@/lib/runtime/terminal/terminal-worker-runtime');
    const runtime = createTerminalWorkerRuntime();

    await runtime.sendText(SESSION, 'echo p4-marker', true);
    let content = '';
    for (let i = 0; i < 20 && !content.includes('p4-marker\n'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      content = (await runtime.capturePane(SESSION)).content;
    }
    expect(content).toContain('p4-marker');
  });

  it('types text that starts with a dash literally', async () => {
    const { createTerminalWorkerRuntime } = await import('@/lib/runtime/terminal/terminal-worker-runtime');
    const runtime = createTerminalWorkerRuntime();

    await runtime.sendText(SESSION, '-n hi', false);
    let content = '';
    for (let i = 0; i < 20 && !content.includes('-n hi'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      content = (await runtime.capturePane(SESSION)).content;
    }
    expect(content).toContain('-n hi');
  });

  it('reports a missing session as not-found', async () => {
    const { createTerminalWorkerRuntime } = await import('@/lib/runtime/terminal/terminal-worker-runtime');
    const runtime = createTerminalWorkerRuntime();

    await expect(runtime.capturePane('rtv2-ws-a-pane-b-tab-none')).rejects.toMatchObject({
      code: 'runtime-v2-terminal-session-not-found',
    });
    await expect(runtime.sendText('rtv2-ws-a-pane-b-tab-none', 'x', true)).rejects.toMatchObject({
      code: 'runtime-v2-terminal-session-not-found',
    });
  });
});

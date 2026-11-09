#!/usr/bin/env node
import { execFile as execFileCb } from 'child_process';
import { randomBytes } from 'crypto';
import fs from 'fs';
import { promisify } from 'util';
import {
  adoptTmuxServerIntoScope,
  defaultTmuxScopeDeps,
  tmuxScopeUnitName,
} from '@/lib/tmux-server-scope';

const execFile = promisify(execFileCb);
const CMD_TIMEOUT_MS = 10_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const main = async (): Promise<void> => {
  const suffix = randomBytes(4).toString('hex');
  const socketName = `agentmux-smoke-${suffix}`;
  const unitBaseName = `agentmux-smoke-${suffix}`;
  const serviceUnit = `${unitBaseName}.service`;
  const scopeUnit = tmuxScopeUnitName(socketName);

  if (socketName.startsWith('codexmux') || unitBaseName.startsWith('codexmux')) {
    throw new Error(`Refusing to run smoke on live codexmux socket/unit: ${socketName}`);
  }

  const tmuxTmpDir = fs.mkdtempSync('/tmp/amx-scope-');
  process.env.TMUX_TMPDIR = tmuxTmpDir;
  const tmuxEnv = { ...process.env, TMUX_TMPDIR: tmuxTmpDir };

  try {
    await execFile(
      'systemd-run',
      [
        '--user',
        `--unit=${unitBaseName}`,
        `--setenv=TMUX_TMPDIR=${tmuxTmpDir}`,
        '--',
        '/bin/sh',
        '-c',
        `tmux -L ${socketName} -f /dev/null new-session -d -s smoke "sleep 600"; exec sleep infinity`,
      ],
      { timeout: CMD_TIMEOUT_MS },
    );

    let serverPid: number | null = null;
    let panePid: number | null = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      serverPid = await defaultTmuxScopeDeps.getServerPid(socketName);
      if (serverPid) {
        try {
          const { stdout } = await execFile(
            'tmux',
            ['-L', socketName, 'list-panes', '-t', 'smoke', '-F', '#{pane_pid}'],
            { env: tmuxEnv, timeout: CMD_TIMEOUT_MS },
          );
          const parsedPane = Number.parseInt(stdout.trim(), 10);
          if (Number.isInteger(parsedPane) && parsedPane > 0) {
            panePid = parsedPane;
            break;
          }
        } catch {
          // wait until session is ready
        }
      }
      await sleep(100);
    }

    if (!serverPid || !panePid) {
      throw new Error(`Smoke tmux server or pane failed to start (serverPid=${serverPid}, panePid=${panePid})`);
    }

    const cgroupBefore = await defaultTmuxScopeDeps.readCgroup(serverPid);
    if (!cgroupBefore || !cgroupBefore.endsWith(`/${serviceUnit}`)) {
      throw new Error(`Expected initial server cgroup to end with /${serviceUnit}, got ${cgroupBefore}`);
    }

    const adoptResult = await adoptTmuxServerIntoScope(socketName);
    if (adoptResult.status !== 'adopted') {
      throw new Error(`Expected adopt status 'adopted', got ${JSON.stringify(adoptResult)}`);
    }

    const cgroupAfter = await defaultTmuxScopeDeps.readCgroup(serverPid);
    if (!cgroupAfter || !cgroupAfter.endsWith(`/${scopeUnit}`)) {
      throw new Error(`Expected adopted server cgroup to end with /${scopeUnit}, got ${cgroupAfter}`);
    }

    await execFile('systemctl', ['--user', 'stop', serviceUnit], { timeout: CMD_TIMEOUT_MS });

    if (!isPidAlive(serverPid)) {
      throw new Error(`tmux server pid ${serverPid} died after stopping ${serviceUnit}`);
    }
    if (!isPidAlive(panePid)) {
      throw new Error(`tmux pane pid ${panePid} died after stopping ${serviceUnit}`);
    }

    await execFile(
      'tmux',
      ['-L', socketName, 'has-session', '-t', 'smoke'],
      { env: tmuxEnv, timeout: CMD_TIMEOUT_MS },
    );

    const { stdout: activeStdout } = await execFile(
      'systemctl',
      ['--user', 'is-active', scopeUnit],
      { timeout: CMD_TIMEOUT_MS },
    );
    if (activeStdout.trim() !== 'active') {
      throw new Error(`Expected ${scopeUnit} to be active, got ${activeStdout.trim()}`);
    }

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        socketName,
        serviceUnit,
        scopeUnit,
        serverPid,
        panePid,
        cgroupBefore,
        cgroupAfter,
        adoptResult,
      })}\n`,
    );
  } finally {
    await execFile('tmux', ['-L', socketName, 'kill-server'], {
      env: tmuxEnv,
      timeout: CMD_TIMEOUT_MS,
    }).catch(() => undefined);
    await execFile('systemctl', ['--user', 'stop', scopeUnit], {
      timeout: CMD_TIMEOUT_MS,
    }).catch(() => undefined);
    await execFile('systemctl', ['--user', 'stop', serviceUnit], {
      timeout: CMD_TIMEOUT_MS,
    }).catch(() => undefined);
    await execFile('systemctl', ['--user', 'reset-failed', serviceUnit, scopeUnit], {
      timeout: CMD_TIMEOUT_MS,
    }).catch(() => undefined);
    fs.rmSync(tmuxTmpDir, { recursive: true, force: true });
  }
};

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

import path from 'path';
import { getDataDir } from '@/lib/app-identity';

export const shQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

export const buildStatuslineScriptSource = (baseDir = getDataDir()): string => `'use strict';
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const MAX_STDIN_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024;
const POST_TIMEOUT_MS = 1000;
const COMMAND_TIMEOUT_MS = 1500;
const baseDir = ${JSON.stringify(baseDir)};
const ACTIVE_ENV = 'AGENTMUX_STATUSLINE_ACTIVE';

// A user statusLine that (directly or through a wrapper) calls this script again must not recurse.
if (process.env[ACTIVE_ENV] === '1') process.exit(0);

const realpathOrNull = (target) => {
  try { return fs.realpathSync(target); } catch { return null; }
};
const home = os.homedir();
const ownDirs = new Set();
for (const dir of [baseDir, path.join(home, '.agentmux'), path.join(home, '.codexmux')]) {
  ownDirs.add(dir);
  const real = realpathOrNull(dir);
  if (real) ownDirs.add(real);
}
const ownScripts = [...ownDirs].flatMap((dir) => [path.join(dir, 'statusline.cjs'), path.join(dir, 'statusline.sh')]);

const chunks = [];
let received = 0;

const postStatus = (body) => new Promise((resolve) => {
  const hardTimer = setTimeout(resolve, POST_TIMEOUT_MS);
  hardTimer.unref();
  try {
    const port = Number.parseInt(fs.readFileSync(path.join(baseDir, 'port'), 'utf8').trim(), 10);
    const token = fs.readFileSync(path.join(baseDir, 'cli-token'), 'utf8').trim();
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !token) return resolve();
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: '/api/status/statusline',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': body.byteLength,
        'x-agentmux-token': token,
      },
    }, (response) => {
      response.resume();
      response.on('end', resolve);
      response.on('close', resolve);
      response.on('error', () => resolve());
    });
    request.setTimeout(POST_TIMEOUT_MS, () => request.destroy());
    request.on('error', () => resolve());
    request.on('close', resolve);
    request.end(body);
  } catch {
    resolve();
  }
});

const readStatusLineCommand = (file) => {
  try {
    const command = JSON.parse(fs.readFileSync(file, 'utf8'))?.statusLine?.command;
    return typeof command === 'string' && command ? command : null;
  } catch {
    return null;
  }
};

const findUserCommand = (projectDir) => {
  const candidates = [
    path.join(projectDir, '.claude', 'settings.local.json'),
    path.join(projectDir, '.claude', 'settings.json'),
    path.join(os.homedir(), '.claude', 'settings.json'),
  ];
  for (const file of candidates) {
    const command = readStatusLineCommand(file);
    if (command) return command;
  }
  return null;
};

const runUserCommand = (command, projectDir, body) => new Promise((resolve) => {
  let output = Buffer.alloc(0);
  let settled = false;
  let child;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(value);
  };
  const timer = setTimeout(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    finish('');
  }, COMMAND_TIMEOUT_MS);
  try {
    child = spawn('sh', ['-c', command], {
      cwd: projectDir,
      detached: true,
      env: { ...process.env, [ACTIVE_ENV]: '1' },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch {
    return finish('');
  }
  child.on('error', () => finish(''));
  child.stdin.on('error', () => {});
  child.stdin.end(body);
  child.stdout.on('data', (data) => {
    if (output.byteLength < MAX_OUTPUT_BYTES) {
      output = Buffer.concat([output, data]).subarray(0, MAX_OUTPUT_BYTES);
    }
  });
  child.on('close', (code) => finish(code === 0 ? output.toString('utf8') : ''));
});

const main = async () => {
  const body = Buffer.concat(chunks);
  let projectDir = process.cwd();
  try {
    const input = JSON.parse(body.toString('utf8'));
    const dir = input?.workspace?.project_dir ?? input?.cwd;
    if (typeof dir === 'string' && dir) projectDir = dir;
  } catch {
    // Keep the current directory.
  }
  const command = findUserCommand(projectDir);
  const runnable = command && !ownScripts.some((script) => command.includes(script));
  const [, output] = await Promise.all([
    postStatus(body),
    runnable ? runUserCommand(command, projectDir, body) : Promise.resolve(''),
  ]);
  if (output) process.stdout.write(output);
  process.exit(0);
};

process.stdin.on('data', (chunk) => {
  if (received >= MAX_STDIN_BYTES) return;
  const buffer = Buffer.from(chunk);
  const remaining = MAX_STDIN_BYTES - received;
  chunks.push(buffer.subarray(0, remaining));
  received += Math.min(buffer.byteLength, remaining);
});
process.stdin.on('end', () => { main().catch(() => process.exit(0)); });
process.stdin.resume();
`;

const BASE_DIR = getDataDir();
export const STATUSLINE_SCRIPT_PATH = path.join(BASE_DIR, 'statusline.cjs');
export const RATE_LIMITS_FILE = path.join(BASE_DIR, 'rate-limits.json');

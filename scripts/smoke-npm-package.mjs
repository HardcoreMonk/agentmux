#!/usr/bin/env node
import fs from 'fs/promises';
import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { assertInstalledPackage, parsePackedFilename } from './npm-package-smoke-lib.mjs';

const rootDir = process.cwd();
const timeoutMs = 60_000;
let child;
let tempDir;

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const processState = spawn(command, args, {
    cwd: options.cwd ?? rootDir,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  processState.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
  processState.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
  processState.once('error', reject);
  processState.once('exit', (code, signal) => {
    const result = {
      code,
      signal,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    };
    if (code === 0) {
      resolve(result);
      return;
    }
    reject(new Error(
      `${command} ${args.join(' ')} failed with ${signal ?? code}: ${result.stderr.slice(-2_000)}`,
    ));
  });
});

const getFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    server.close(() => resolve(port));
  });
});

const requestHealth = (port) => new Promise((resolve, reject) => {
  const request = http.get({
    hostname: '127.0.0.1',
    port,
    path: '/api/health',
    timeout: 3_000,
  }, (response) => {
    response.resume();
    response.once('end', () => resolve(response.statusCode));
  });
  request.once('timeout', () => request.destroy(new Error('health request timed out')));
  request.once('error', reject);
});

const waitForHealth = async (port, getOutput) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) {
      throw new Error(`installed server exited early: ${getOutput().slice(-2_000)}`);
    }
    const status = await requestHealth(port).catch(() => 0);
    if (status === 200) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`installed server health timed out: ${getOutput().slice(-2_000)}`);
};

const waitForExit = (processState, delay = 10_000) => new Promise((resolve) => {
  if (processState.exitCode !== null) {
    resolve();
    return;
  }
  const timer = setTimeout(resolve, delay);
  processState.once('exit', () => {
    clearTimeout(timer);
    resolve();
  });
});

const stopServer = async () => {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGINT');
  await waitForExit(child);
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await waitForExit(child, 5_000);
  }
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await waitForExit(child, 5_000);
  }
};

const buildServerEnv = (home, port) => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key === 'AUTH_PASSWORD'
      || key === 'NEXTAUTH_SECRET'
      || key === 'INIT_PASSWORD'
      || key === '__CMUX_APP_DIR'
      || key === '__CMUX_APP_DIR_UNPACKED'
      || key === '__CMUX_PRISTINE_ENV'
      || key.startsWith('__CMUX_BOOTSTRAP_')
      || key.startsWith('AGENTMUX_RUNTIME_')
      || key.startsWith('CODEXMUX_RUNTIME_')
    ) {
      delete env[key];
    }
  }
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    TMUX_TMPDIR: path.join(home, 'tmux'),
    HOST: '127.0.0.1',
    PORT: String(port),
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    NO_UPDATE_NOTIFIER: '1',
  });
  return env;
};

const main = async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmux-npm-smoke-'));
  const packDir = path.join(tempDir, 'pack');
  const consumerDir = path.join(tempDir, 'consumer');
  const home = path.join(tempDir, 'home');
  await Promise.all([
    fs.mkdir(packDir, { recursive: true }),
    fs.mkdir(consumerDir, { recursive: true }),
    fs.mkdir(path.join(home, 'tmux'), { recursive: true }),
  ]);
  await fs.writeFile(path.join(consumerDir, 'package.json'), JSON.stringify({
    name: 'agentmux-npm-smoke-consumer',
    private: true,
  }), 'utf8');

  const packed = await run('npm', [
    'pack',
    '--ignore-scripts',
    '--json',
    '--pack-destination',
    packDir,
  ]);
  const tarball = path.join(packDir, parsePackedFilename(packed.stdout));

  await run('npm', [
    'install',
    '--no-audit',
    '--no-fund',
    '--no-package-lock',
    tarball,
  ], { cwd: consumerDir });

  const packageDir = path.join(consumerDir, 'node_modules', '@hardcoremonk', 'agentmux');
  await assertInstalledPackage(packageDir);

  const executable = path.join(packageDir, 'bin', 'agentmux.js');
  const help = await run('npm', ['exec', '--offline', '--', 'agentmux', 'help'], {
    cwd: consumerDir,
    env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
  });
  if (!help.stdout.includes('agentmux CLI')) {
    throw new Error('installed agentmux help output is invalid.');
  }

  const port = await getFreePort();
  const output = [];
  child = spawn(process.execPath, [executable], {
    cwd: consumerDir,
    env: buildServerEnv(home, port),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => output.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => output.push(Buffer.from(chunk)));
  await waitForHealth(port, () => Buffer.concat(output).toString('utf8'));
  await stopServer();

  console.log('npm package smoke passed: pack, install, CLI, production health.');
};

try {
  await main();
} finally {
  await stopServer();
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
}

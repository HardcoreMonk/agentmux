import { spawn } from 'child_process';
import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

const makeIsolatedHome = async (): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmux-cli-env-test-'));
  tempDirs.push(dir);
  return dir;
};

const buildCleanCliEnv = (homeDir: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith('AMUX_')
      || key.startsWith('CMUX_')
      || key.startsWith('AGENTMUX_')
      || key.startsWith('CODEXMUX_')
      || key.startsWith('__CMUX_')
    ) {
      delete env[key];
    }
  }
  return {
    ...env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    NO_UPDATE_NOTIFIER: '1',
    ...extra,
  };
};

const runCli = (
  entryRelativePath: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(process.cwd(), entryRelativePath), ...args],
      {
        cwd: process.cwd(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe('bin/agentmux.js and bin/codexmux.js CLI contract', () => {
  it('produces identical help output from bin/agentmux.js and bin/codexmux.js with agentmux CLI header', async () => {
    const homeDir = await makeIsolatedHome();
    const env = buildCleanCliEnv(homeDir);

    const [agentmuxHelp, codexmuxHelp] = await Promise.all([
      runCli('bin/agentmux.js', ['help'], env),
      runCli('bin/codexmux.js', ['help'], env),
    ]);

    expect(agentmuxHelp.code).toBe(0);
    expect(codexmuxHelp.code).toBe(0);
    expect(agentmuxHelp.stdout).toBe(codexmuxHelp.stdout);
    expect(agentmuxHelp.stdout.split('\n')[0]).toBe('agentmux CLI');
    expect(agentmuxHelp.stdout).toContain('Usage: agentmux <command>');
    expect(agentmuxHelp.stdout).toContain('AMUX_PORT');
    expect(agentmuxHelp.stdout).toContain('AMUX_TOKEN');
    expect(agentmuxHelp.stdout).toContain('legacy alias');
  });

  it('sends x-agentmux-token header when only legacy CMUX_PORT and CMUX_TOKEN are set (Review Focus 4)', async () => {
    const homeDir = await makeIsolatedHome();

    let receivedHeader: string | string[] | undefined;
    let receivedUrl: string | undefined;
    const server = http.createServer((req, res) => {
      receivedHeader = req.headers['x-agentmux-token'];
      receivedUrl = req.url;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ workspaces: [{ id: 'ws-1', name: 'Main', directories: [] }] }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('Failed to bind stub server');
    }

    try {
      const env = buildCleanCliEnv(homeDir, {
        CMUX_PORT: String(address.port),
        CMUX_TOKEN: 'legacy-cmux-token-val',
      });
      const result = await runCli('bin/agentmux.js', ['workspaces'], env);

      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      expect(receivedUrl).toBe('/api/cli/workspaces');
      expect(receivedHeader).toBe('legacy-cmux-token-val');
      expect(JSON.parse(result.stdout)).toEqual({
        workspaces: [{ id: 'ws-1', name: 'Main', directories: [] }],
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('prefers ~/.agentmux/{port,cli-token} before ~/.codexmux/{port,cli-token} when env vars are absent', async () => {
    const homeDir = await makeIsolatedHome();
    await fs.mkdir(path.join(homeDir, '.agentmux'), { recursive: true });
    await fs.mkdir(path.join(homeDir, '.codexmux'), { recursive: true });

    let receivedHeader: string | string[] | undefined;
    const server = http.createServer((req, res) => {
      receivedHeader = req.headers['x-agentmux-token'];
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ workspaces: [] }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('Failed to bind stub server');
    }

    try {
      await fs.writeFile(path.join(homeDir, '.agentmux', 'port'), String(address.port), 'utf8');
      await fs.writeFile(path.join(homeDir, '.agentmux', 'cli-token'), 'agentmux-file-token', 'utf8');
      await fs.writeFile(path.join(homeDir, '.codexmux', 'port'), '1', 'utf8');
      await fs.writeFile(path.join(homeDir, '.codexmux', 'cli-token'), 'codexmux-file-token', 'utf8');

      const result = await runCli('bin/agentmux.js', ['workspaces'], buildCleanCliEnv(homeDir));
      expect(result.code).toBe(0);
      expect(receivedHeader).toBe('agentmux-file-token');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('reads port and cli-token from AGENTMUX_DATA_DIR when no AMUX/CMUX env is set', async () => {
    const homeDir = await makeIsolatedHome();
    const dataDir = await makeIsolatedHome();

    let receivedHeader: string | string[] | undefined;
    const server = http.createServer((req, res) => {
      receivedHeader = req.headers['x-agentmux-token'];
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ workspaces: [] }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('Failed to bind stub server');
    }

    try {
      await fs.writeFile(path.join(dataDir, 'port'), String(address.port), 'utf8');
      await fs.writeFile(path.join(dataDir, 'cli-token'), 'data-dir-token', 'utf8');

      const result = await runCli(
        'bin/agentmux.js',
        ['workspaces'],
        buildCleanCliEnv(homeDir, { AGENTMUX_DATA_DIR: dataDir }),
      );
      expect(result.code).toBe(0);
      expect(receivedHeader).toBe('data-dir-token');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

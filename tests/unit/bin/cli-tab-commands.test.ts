import { spawn } from 'child_process';
import fs from 'fs/promises';
import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

interface IRecorded {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

const tempDirs: string[] = [];
const servers: http.Server[] = [];

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
  return { ...env, HOME: homeDir, USERPROFILE: homeDir, NO_UPDATE_NOTIFIER: '1', ...extra };
};

const startFakeServer = async (
  status: number,
  responseBody: unknown,
): Promise<{ port: number; requests: IRecorded[] }> => {
  const requests: IRecorded[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: raw ? JSON.parse(raw) : undefined,
      });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(responseBody));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, requests };
};

const runCli = async (
  args: string[],
  port: number,
  extraEnv: Record<string, string> = {},
  cwd: string = process.cwd(),
): Promise<{ code: number | null; stdout: string; stderr: string }> => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmux-cli-tab-test-'));
  tempDirs.push(homeDir);
  const env = buildCleanCliEnv(homeDir, {
    AMUX_PORT: String(port),
    AMUX_TOKEN: 'fake-token',
    ...extraEnv,
  });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(process.cwd(), 'bin/agentmux.js'), ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('agentmux CLI tab context from environment', () => {
  it('uses AMUX_WORKSPACE_ID and sends the caller tab header on tab create', async () => {
    const { port, requests } = await startFakeServer(200, { id: 'tab-new' });
    const result = await runCli(
      ['tab', 'create', '-t', 'claude', '--cwd', '/tmp'],
      port,
      { AMUX_WORKSPACE_ID: 'ws-1', AMUX_TAB_ID: 'tab-1' },
    );

    expect(result.code).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('POST');
    expect(requests[0].body).toEqual({ workspaceId: 'ws-1', panelType: 'claude', cwd: '/tmp' });
    expect(requests[0].headers['x-agentmux-caller-tab']).toBe('tab-1');
  });

  it.each([
    ['../other', 'other'],
    ['.', ''],
  ])('sends a relative --cwd %s as an absolute path', async (cwdArg, expectedTail) => {
    const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agentmux-cli-cwd-test-')));
    tempDirs.push(base);
    const work = path.join(base, 'work');
    await fs.mkdir(work);
    const { port, requests } = await startFakeServer(200, { id: 'tab-new' });

    const result = await runCli(['tab', 'create', '-w', 'ws-1', '--cwd', cwdArg], port, {}, work);

    expect(result.code).toBe(0);
    const expected = cwdArg === '.' ? work : path.join(base, expectedTail);
    expect(requests[0].body).toEqual({ workspaceId: 'ws-1', cwd: expected });
    expect(path.isAbsolute((requests[0].body as { cwd: string }).cwd)).toBe(true);
  });

  it('describes how tab list falls back in the help text', async () => {
    const result = await runCli(['help'], 0);

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain("except 'tab list'");
    expect(result.stdout).toContain('lists tabs in every workspace when neither -w nor AMUX_WORKSPACE_ID is set');
  });

  it('prefers -w over AMUX_WORKSPACE_ID', async () => {
    const { port, requests } = await startFakeServer(200, { id: 'tab-new' });
    const result = await runCli(['tab', 'create', '-w', 'ws-2'], port, { AMUX_WORKSPACE_ID: 'ws-1' });

    expect(result.code).toBe(0);
    expect(requests[0].body).toEqual({ workspaceId: 'ws-2' });
  });

  it('requires a workspace for tab send when neither -w nor AMUX_WORKSPACE_ID is set', async () => {
    const { port, requests } = await startFakeServer(200, {});
    const result = await runCli(['tab', 'send', 'TAB', 'hello'], port);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--workspace is required');
    expect(requests).toHaveLength(0);
  });

  it('uses AMUX_WORKSPACE_ID for tab send and keeps tab list working without a workspace', async () => {
    const { port, requests } = await startFakeServer(200, {});
    const send = await runCli(['tab', 'send', 'TAB', 'hello'], port, { AMUX_WORKSPACE_ID: 'ws-1' });
    const list = await runCli(['tab', 'list'], port);

    expect(send.code).toBe(0);
    expect(list.code).toBe(0);
    expect(requests[0].url).toBe('/api/cli/tabs/TAB/send?workspaceId=ws-1');
    expect(requests[1].url).toBe('/api/cli/tabs');
  });

  it('prints error: <code>: <message> when the server returns a message', async () => {
    const { port } = await startFakeServer(409, { error: 'target-needs-input', message: 'x' });
    const result = await runCli(['tab', 'send', '-w', 'ws-1', 'TAB', 'hello'], port);

    expect(result.code).toBe(1);
    expect(result.stderr).toBe('error: target-needs-input: x\n');
  });

  it('keeps error: <error> for old-style error bodies', async () => {
    const { port } = await startFakeServer(404, { error: 'Tab not found' });
    const result = await runCli(['tab', 'status', '-w', 'ws-1', 'TAB'], port);

    expect(result.code).toBe(1);
    expect(result.stderr).toBe('error: Tab not found\n');
  });

  it('omits the caller header when AMUX_TAB_ID is not set', async () => {
    const { port, requests } = await startFakeServer(200, {});
    const result = await runCli(['tab', 'status', '-w', 'ws-1', 'TAB'], port);

    expect(result.code).toBe(0);
    expect(requests[0].headers['x-agentmux-caller-tab']).toBeUndefined();
  });

  it('sends the caller header on browser requests too', async () => {
    const { port, requests } = await startFakeServer(200, {});
    const result = await runCli(['tab', 'browser', 'url', 'TAB'], port, {
      AMUX_WORKSPACE_ID: 'ws-1',
      AMUX_TAB_ID: 'tab-1',
    });

    expect(result.code).toBe(0);
    expect(requests[0].headers['x-agentmux-caller-tab']).toBe('tab-1');
  });
});

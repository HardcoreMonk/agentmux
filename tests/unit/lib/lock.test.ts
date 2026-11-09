import fs from 'fs/promises';
import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempHome: string;
const servers: http.Server[] = [];

const startHealthServer = async (payload: Record<string, unknown>): Promise<number> => {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  return (server.address() as AddressInfo).port;
};

describe('lock health identity check', () => {
  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmux-lock-test-'));
    vi.resetModules();
    vi.stubEnv('HOME', tempHome);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    );
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  it('recognizes legacy { app: "codexmux" } health response as a live lock holder', async () => {
    const port = await startHealthServer({ app: 'codexmux' });
    const lockDir = path.join(tempHome, '.agentmux');
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(
      path.join(lockDir, 'cmux.lock'),
      JSON.stringify({ pid: process.ppid, port, startedAt: Date.now() }),
      'utf-8',
    );

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process-exit-${code}`);
    }) as never);

    const { acquireLock } = await import('@/lib/lock');
    await expect(acquireLock(port)).rejects.toThrow('process-exit-1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('agentmux is already running'));
  });

  it('recognizes { product: "agentmux" } health response as a live lock holder', async () => {
    const port = await startHealthServer({ product: 'agentmux' });
    const lockDir = path.join(tempHome, '.agentmux');
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(
      path.join(lockDir, 'cmux.lock'),
      JSON.stringify({ pid: process.ppid, port, startedAt: Date.now() }),
      'utf-8',
    );

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process-exit-${code}`);
    }) as never);

    const { acquireLock } = await import('@/lib/lock');
    await expect(acquireLock(port)).rejects.toThrow('process-exit-1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('agentmux is already running'));
  });

  it('reclaims the lock when /api/health returns an unrelated app', async () => {
    const port = await startHealthServer({ app: 'other' });
    const lockDir = path.join(tempHome, '.agentmux');
    const lockFile = path.join(lockDir, 'cmux.lock');
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(
      lockFile,
      JSON.stringify({ pid: process.ppid, port, startedAt: Date.now() }),
      'utf-8',
    );

    const { acquireLock } = await import('@/lib/lock');
    await acquireLock(port + 1);

    const updated = JSON.parse(await fs.readFile(lockFile, 'utf-8')) as { pid: number; port: number };
    expect(updated.pid).toBe(process.pid);
    expect(updated.port).toBe(port + 1);
  });
});

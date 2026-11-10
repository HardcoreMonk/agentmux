import { spawn } from 'child_process';
import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDataDir } from '@/lib/app-identity';
import { getStatusHookBridgeSource } from '@/lib/hook-settings';
import { buildStatuslineScriptSource } from '@/lib/statusline-script';

const temporaryDirectories: string[] = [];

const makeHome = async (layout: 'legacy' | 'fresh' = 'legacy'): Promise<string> => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-hook-bridge-test-'));
  temporaryDirectories.push(homeDir);
  if (layout === 'legacy') {
    await fs.mkdir(path.join(homeDir, '.codexmux'), { recursive: true });
  }
  return homeDir;
};

const runBridge = async ({
  homeDir,
  input = '',
}: {
  homeDir: string;
  input?: string;
}): Promise<{ code: number | null; stderr: string }> => {
  vi.stubEnv('HOME', homeDir);
  vi.stubEnv('USERPROFILE', homeDir);
  const dataDir = getDataDir();
  await fs.mkdir(dataDir, { recursive: true });
  const scriptPath = path.join(dataDir, 'status-hook.cjs');
  await fs.writeFile(scriptPath, getStatusHookBridgeSource(), { mode: 0o700 });

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, 'stop', 'session-a', 'capability-a'], {
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
      },
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
    child.stdin.end(input);
  });
};

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })));
});

describe('status hook bridge', () => {
  it('posts only the bounded event envelope to the loopback hook endpoint in legacy layout', async () => {
    const homeDir = await makeHome('legacy');
    const requestPromise = new Promise<{
      body: string;
      token: string | undefined;
      url: string | undefined;
    }>((resolve) => {
      const server = http.createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        request.on('end', () => {
          response.end();
          server.close();
          resolve({
            body: Buffer.concat(chunks).toString('utf-8'),
            token: request.headers['x-agentmux-token'] as string | undefined,
            url: request.url,
          });
        });
      });
      server.listen(0, '127.0.0.1', async () => {
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('hook test port missing');
        await fs.writeFile(path.join(homeDir, '.codexmux', 'port'), String(address.port));
        await fs.writeFile(path.join(homeDir, '.codexmux', 'cli-token'), 'token-a');
      });
    });

    const result = await (async () => {
      while (true) {
        try {
          await fs.access(path.join(homeDir, '.codexmux', 'port'));
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      }
      return runBridge({ homeDir, input: 'x'.repeat(70 * 1024) });
    })();
    expect(result).toEqual({ code: 0, stderr: '' });

    const request = await requestPromise;
    expect(request).toEqual({
      body: JSON.stringify({
        event: 'stop',
        session: 'session-a',
        capability: 'capability-a',
      }),
      token: 'token-a',
      url: '/api/status/hook',
    });
  });

  it('reads .agentmux/port and .agentmux/cli-token when generated on a fresh layout HOME', async () => {
    const homeDir = await makeHome('fresh');
    vi.stubEnv('HOME', homeDir);
    vi.stubEnv('USERPROFILE', homeDir);
    const bridgeSource = getStatusHookBridgeSource();
    const statuslineSource = buildStatuslineScriptSource();

    expect(bridgeSource).toContain(JSON.stringify(path.join(homeDir, '.agentmux')));
    expect(bridgeSource).toContain("'x-agentmux-token': token");
    expect(statuslineSource).toContain(JSON.stringify(path.join(homeDir, '.agentmux')));
    expect(statuslineSource).toContain("'x-agentmux-token': token");
    expect(statuslineSource).not.toContain(JSON.stringify(path.join(homeDir, '.codexmux')));

    const agentmuxDir = path.join(homeDir, '.agentmux');
    await fs.mkdir(agentmuxDir, { recursive: true });

    const requestPromise = new Promise<{
      body: string;
      token: string | undefined;
      url: string | undefined;
    }>((resolve) => {
      const server = http.createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        request.on('end', () => {
          response.end();
          server.close();
          resolve({
            body: Buffer.concat(chunks).toString('utf-8'),
            token: request.headers['x-agentmux-token'] as string | undefined,
            url: request.url,
          });
        });
      });
      server.listen(0, '127.0.0.1', async () => {
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('hook test port missing');
        await fs.writeFile(path.join(agentmuxDir, 'port'), String(address.port));
        await fs.writeFile(path.join(agentmuxDir, 'cli-token'), 'token-fresh');
      });
    });

    while (true) {
      try {
        await fs.access(path.join(agentmuxDir, 'port'));
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }

    const result = await runBridge({ homeDir });
    expect(result).toEqual({ code: 0, stderr: '' });
    await expect(requestPromise).resolves.toEqual({
      body: JSON.stringify({
        event: 'stop',
        session: 'session-a',
        capability: 'capability-a',
      }),
      token: 'token-fresh',
      url: '/api/status/hook',
    });
  });

  it('forwards only the allow-listed stdin fields under renamed keys', async () => {
    const homeDir = await makeHome('legacy');
    const dataDir = path.join(homeDir, '.codexmux');
    const received = new Promise<string>((resolve) => {
      const server = http.createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        request.on('end', () => {
          response.end();
          server.close();
          resolve(Buffer.concat(chunks).toString('utf-8'));
        });
      });
      server.listen(0, '127.0.0.1', async () => {
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('hook test port missing');
        await fs.writeFile(path.join(dataDir, 'port'), String(address.port));
        await fs.writeFile(path.join(dataDir, 'cli-token'), 'token-a');
      });
    });
    while (true) {
      try {
        await fs.access(path.join(dataDir, 'port'));
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }

    const sessionId = '00000000-0000-4000-8000-000000000001';
    const transcriptPath = `/home/test/.claude/projects/x/${sessionId}.jsonl`;
    await runBridge({
      homeDir,
      input: JSON.stringify({
        session_id: sessionId,
        transcript_path: transcriptPath,
        source: 'clear',
        notification_type: 'permission_prompt',
        prompt: 'secret',
        tool_input: { command: 'secret' },
      }),
    });

    expect(JSON.parse(await received)).toEqual({
      event: 'stop',
      session: 'session-a',
      capability: 'capability-a',
      agentSessionId: sessionId,
      transcriptPath,
      source: 'clear',
      notificationType: 'permission_prompt',
    });
  });

  it('drops oversized and non-string stdin fields', async () => {
    const homeDir = await makeHome('legacy');
    const dataDir = path.join(homeDir, '.codexmux');
    const received = new Promise<string>((resolve) => {
      const server = http.createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        request.on('end', () => {
          response.end();
          server.close();
          resolve(Buffer.concat(chunks).toString('utf-8'));
        });
      });
      server.listen(0, '127.0.0.1', async () => {
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('hook test port missing');
        await fs.writeFile(path.join(dataDir, 'port'), String(address.port));
        await fs.writeFile(path.join(dataDir, 'cli-token'), 'token-a');
      });
    });
    while (true) {
      try {
        await fs.access(path.join(dataDir, 'port'));
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }

    await runBridge({
      homeDir,
      input: JSON.stringify({ session_id: 'x'.repeat(513), transcript_path: 7, source: 'startup' }),
    });

    expect(JSON.parse(await received)).toEqual({
      event: 'stop',
      session: 'session-a',
      capability: 'capability-a',
      source: 'startup',
    });
  });

  it('exits successfully when the loopback server is unavailable', async () => {
    const homeDir = await makeHome('legacy');
    const probe = http.createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const address = probe.address();
    if (!address || typeof address === 'string') throw new Error('hook test port missing');
    await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
    await fs.writeFile(path.join(homeDir, '.codexmux', 'port'), String(address.port));
    await fs.writeFile(path.join(homeDir, '.codexmux', 'cli-token'), 'token-a');

    await expect(runBridge({ homeDir })).resolves.toEqual({ code: 0, stderr: '' });
  });

  it('stays dependency-free and avoids shell transport', () => {
    const source = getStatusHookBridgeSource('/tmp/agentmux-bridge-test');
    expect(source).toContain('MAX_STDIN_BYTES = 64 * 1024');
    expect(source).toContain("host: '127.0.0.1'");
    expect(source).toContain('const baseDir = "/tmp/agentmux-bridge-test";');
    expect(source).not.toMatch(/@\/|node_modules|\bcurl\b|\btmux\b|child_process/);
  });
});

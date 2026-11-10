import { spawn } from 'child_process';
import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildStatuslineScriptSource } from '@/lib/statusline-script';

let home: string;
let dataDir: string;
let server: http.Server;
let posted: string[];

const writeUserSettings = async (command: string): Promise<void> => {
  await fs.mkdir(path.join(home, '.claude'), { recursive: true });
  await fs.writeFile(path.join(home, '.claude', 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command } }));
};

const run = async (input = '{"cwd":"/tmp"}'): Promise<{ stdout: string; ms: number }> => {
  const script = path.join(dataDir, 'statusline.cjs');
  await fs.writeFile(script, buildStatuslineScriptSource(dataDir));
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.on('error', reject);
    child.on('close', () => resolve({ stdout, ms: Date.now() - started }));
    child.stdin.end(input);
  });
};

describe('claude statusline script', () => {
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmux-statusline-'));
    dataDir = path.join(home, '.agentmux');
    await fs.mkdir(dataDir, { recursive: true });
    posted = [];
    server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        if (request.url === '/api/status/statusline' && request.headers['x-agentmux-token'] === 'tok') {
          posted.push(Buffer.concat(chunks).toString('utf-8'));
        }
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('port missing');
    await fs.writeFile(path.join(dataDir, 'port'), String(address.port));
    await fs.writeFile(path.join(dataDir, 'cli-token'), 'tok');
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(home, { recursive: true, force: true });
  });

  it('passes through the user statusLine command output', async () => {
    await writeUserSettings('printf hello');
    expect((await run()).stdout).toBe('hello');
  });

  it('does not run a command that points at its own script', async () => {
    await writeUserSettings(`sh -c 'printf loop' ${path.join(dataDir, 'statusline.cjs')}`);
    expect((await run()).stdout).toBe('');
    await writeUserSettings(`sh ${path.join(dataDir, 'statusline.sh')}`);
    expect((await run()).stdout).toBe('');
  });

  it('runs a user script that only shares the file name', async () => {
    const userScript = path.join(home, '.claude', 'statusline.sh');
    await fs.mkdir(path.dirname(userScript), { recursive: true });
    await fs.writeFile(userScript, 'printf mine');
    await writeUserSettings(`sh ${userScript}`);
    expect((await run()).stdout).toBe('mine');
  });

  it('prefers project settings and uses the project directory as cwd', async () => {
    const project = path.join(home, 'proj');
    await fs.mkdir(path.join(project, '.claude'), { recursive: true });
    await fs.writeFile(
      path.join(project, '.claude', 'settings.local.json'),
      JSON.stringify({ statusLine: { command: 'pwd | tr -d "\\n"' } }),
    );
    await writeUserSettings('printf global');
    const result = await run(JSON.stringify({ workspace: { project_dir: project } }));
    expect(await fs.realpath(result.stdout)).toBe(await fs.realpath(project));
  });

  it('prints nothing without settings', async () => {
    expect((await run()).stdout).toBe('');
  });

  it('kills a slow command after about 1.5 seconds', async () => {
    await writeUserSettings('sleep 3; printf late');
    const result = await run();
    expect(result.stdout).toBe('');
    expect(result.ms).toBeGreaterThan(1200);
    expect(result.ms).toBeLessThan(2800);
  });

  it('posts the stdin body to the statusline endpoint', async () => {
    const body = '{"cwd":"/tmp","rate_limits":{"x":1}}';
    await run(body);
    expect(posted).toEqual([body]);
  });
});

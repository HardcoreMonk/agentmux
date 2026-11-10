import fs from 'fs/promises';
import path from 'path';
import { getDataDir } from '@/lib/app-identity';
import { createLogger } from '@/lib/logger';
import { STATUSLINE_SCRIPT_PATH, buildStatuslineScriptSource, shQuote } from '@/lib/statusline-script';
import { STATUS_HOOK_BRIDGE_PATH } from '@/lib/agent-hooks';

const log = createLogger('hooks');

const BASE_DIR = getDataDir();
const HOOKS_FILE = path.join(BASE_DIR, 'hooks.json');
const HOOK_BRIDGE = STATUS_HOOK_BRIDGE_PATH;

export const HOOK_SETTINGS_PATH = HOOKS_FILE;

export const getStatusHookBridgeSource = (baseDir = getDataDir()): string => `'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');

const MAX_STDIN_BYTES = 64 * 1024;
const baseDir = ${JSON.stringify(baseDir)};
const event = typeof process.argv[2] === 'string' ? process.argv[2] : 'poll';
const session = typeof process.argv[3] === 'string' ? process.argv[3] : '';
const capability = typeof process.argv[4] === 'string' ? process.argv[4] : '';
let received = 0;
let chunks = [];

process.stdin.on('data', (chunk) => {
  if (received >= MAX_STDIN_BYTES) return;
  const buffer = Buffer.from(chunk);
  const remaining = MAX_STDIN_BYTES - received;
  chunks.push(buffer.subarray(0, remaining));
  received += Math.min(buffer.byteLength, remaining);
});

const FORWARDED_FIELDS = {
  session_id: 'agentSessionId',
  transcript_path: 'transcriptPath',
  source: 'source',
  notification_type: 'notificationType',
};
const MAX_FIELD_LENGTH = 512;

const readForwardedFields = () => {
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!input || typeof input !== 'object') return {};
    const fields = {};
    for (const [from, to] of Object.entries(FORWARDED_FIELDS)) {
      const value = input[from];
      if (typeof value === 'string' && value.length <= MAX_FIELD_LENGTH) fields[to] = value;
    }
    return fields;
  } catch {
    return {};
  }
};

process.stdin.on('end', () => {
  try {
    const port = Number.parseInt(fs.readFileSync(path.join(baseDir, 'port'), 'utf8').trim(), 10);
    const token = fs.readFileSync(path.join(baseDir, 'cli-token'), 'utf8').trim();
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !token) process.exit(0);
    const body = JSON.stringify({ event, session, capability, ...readForwardedFields() });
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: '/api/status/hook',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-agentmux-token': token,
      },
    }, (response) => {
      response.resume();
      response.on('end', () => process.exit(0));
    });
    request.setTimeout(1000, () => request.destroy());
    request.on('error', () => process.exit(0));
    request.end(body);
  } catch {
    process.exit(0);
  }
});

process.stdin.resume();
setTimeout(() => process.exit(0), 1500).unref();
`;

export const buildHookSettings = () => ({
  hooks: {},
  statusLine: {
    type: 'command' as const,
    command: `ELECTRON_RUN_AS_NODE=1 ${shQuote(process.execPath)} ${shQuote(STATUSLINE_SCRIPT_PATH)}`,
  },
});

const writeIfChanged = async (filePath: string, content: string, mode: number): Promise<void> => {
  try {
    if (await fs.readFile(filePath, 'utf-8') === content) return;
  } catch {
    // Create the file below.
  }
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, content, { mode });
  await fs.rename(temporaryPath, filePath);
  await fs.chmod(filePath, mode);
};

export const ensureHookSettings = async (port: number): Promise<void> => {
  const baseDir = getDataDir();
  const hooksFile = path.join(baseDir, 'hooks.json');
  const portFile = path.join(baseDir, 'port');
  const statuslineScriptPath = path.join(baseDir, 'statusline.cjs');

  await fs.mkdir(baseDir, { recursive: true });

  await fs.writeFile(portFile, String(port), { mode: 0o600 });

  await writeIfChanged(HOOK_BRIDGE, getStatusHookBridgeSource(baseDir), 0o700);

  await writeIfChanged(statuslineScriptPath, buildStatuslineScriptSource(baseDir), 0o700);

  // Create hooks.json
  const settings = buildHookSettings();
  const content = JSON.stringify(settings, null, 2) + '\n';

  try {
    const existing = await fs.readFile(hooksFile, 'utf-8');
    if (existing === content) return;
  } catch {
    // file doesn't exist yet
  }

  await fs.writeFile(hooksFile, content, { mode: 0o600 });
  log.debug(`${hooksFile} created`);
};

export const removePortFile = async (): Promise<void> => {
  try {
    await fs.unlink(path.join(getDataDir(), 'port'));
  } catch {
    // already removed
  }
};

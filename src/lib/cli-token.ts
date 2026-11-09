import { randomBytes, timingSafeEqual } from 'crypto';
import fs from 'fs';
import type { IncomingHttpHeaders } from 'http';
import path from 'path';
import type { NextApiRequest } from 'next';
import { getDataDir } from '@/lib/app-identity';

export const CLI_TOKEN_HEADER = 'x-agentmux-token';
export const LEGACY_CLI_TOKEN_HEADER = 'x-cmux-token';

const TOKEN_FILE = path.join(getDataDir(), 'cli-token');

const g = globalThis as unknown as { __ptCliToken?: string };

const readTokenFile = (): string | null => {
  try {
    const value = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
    return value || null;
  } catch {
    return null;
  }
};

const writeTokenFile = (value: string): void => {
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, value, { mode: 0o600 });
  } catch {
    // best-effort; CLI will still work via env var
  }
};

export const getCliToken = (): string => {
  if (g.__ptCliToken) return g.__ptCliToken;
  const existing = readTokenFile();
  if (existing) {
    g.__ptCliToken = existing;
    return existing;
  }
  const fresh = randomBytes(32).toString('hex');
  g.__ptCliToken = fresh;
  writeTokenFile(fresh);
  return fresh;
};

export const verifyTokenValue = (value: string | null | undefined): boolean => {
  if (!value) return false;
  const expected = getCliToken();
  if (value.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
};

const isFetchHeaders = (headers: IncomingHttpHeaders | Headers): headers is Headers =>
  typeof (headers as Headers).get === 'function';

const readSingleHeaderValue = (
  headers: IncomingHttpHeaders | Headers,
  name: string,
): string | undefined => {
  if (isFetchHeaders(headers)) {
    const value = headers.get(name)?.trim();
    return value ? value : undefined;
  }
  const direct = headers[name];
  if (typeof direct === 'string') {
    const trimmed = direct.trim();
    return trimmed ? trimmed : undefined;
  }
  for (const [key, rawValue] of Object.entries(headers)) {
    if (key.toLowerCase() === name && typeof rawValue === 'string') {
      const trimmed = rawValue.trim();
      return trimmed ? trimmed : undefined;
    }
  }
  return undefined;
};

export const readCliTokenHeader = (
  headers: IncomingHttpHeaders | Headers,
): string | undefined =>
  readSingleHeaderValue(headers, CLI_TOKEN_HEADER) ??
  readSingleHeaderValue(headers, LEGACY_CLI_TOKEN_HEADER);

export const verifyCliToken = (req: NextApiRequest): boolean => {
  const value = readCliTokenHeader(req.headers);
  return verifyTokenValue(value);
};

import { createHmac, timingSafeEqual } from 'crypto';
import path from 'path';
import { getDataDir } from '@/lib/app-identity';
import { getCliToken } from '@/lib/cli-token';

const CAPABILITY_VERSION = 1;
const CAPABILITY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const BRIDGE_PATH = path.join(getDataDir(), 'status-hook.cjs');

interface IHookCapabilityPayload {
  v: number;
  tabId: string;
  sessionName: string;
  expiresAt: number;
}

const sign = (encodedPayload: string): string =>
  createHmac('sha256', getCliToken()).update(encodedPayload).digest('base64url');

export const createCodexHookCapability = (
  tabId: string,
  sessionName: string,
  now = Date.now(),
): string => {
  const payload: IHookCapabilityPayload = {
    v: CAPABILITY_VERSION,
    tabId,
    sessionName,
    expiresAt: now + CAPABILITY_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
};

export const verifyCodexHookCapability = (
  capability: string,
  expectedSessionName: string,
  now = Date.now(),
): IHookCapabilityPayload | null => {
  const [encoded, signature, extra] = capability.split('.');
  if (!encoded || !signature || extra) return null;
  const expected = sign(encoded);
  if (signature.length !== expected.length
    || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as IHookCapabilityPayload;
    if (payload.v !== CAPABILITY_VERSION || !payload.tabId || payload.sessionName !== expectedSessionName) {
      return null;
    }
    if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= now) return null;
    return payload;
  } catch {
    return null;
  }
};

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
const windowsQuote = (value: string): string => `"${value.replace(/"/g, '\\"')}"`;
const tomlString = (value: string): string => JSON.stringify(value);

interface ICodexSessionHookOptions {
  tabId: string;
  sessionName: string;
  nodePath?: string;
}

const buildHandler = (
  event: string,
  capability: string,
  options: ICodexSessionHookOptions,
): string => {
  const nodePath = options.nodePath ?? process.execPath;
  const args = [nodePath, BRIDGE_PATH, event, options.sessionName, capability];
  const posix = `ELECTRON_RUN_AS_NODE=1 ${args.map(shellQuote).join(' ')}`;
  const windows = `set "ELECTRON_RUN_AS_NODE=1" && ${args.map(windowsQuote).join(' ')}`;
  return `{type="command",command=${tomlString(posix)},commandWindows=${tomlString(windows)},timeout=3,async=true}`;
};

export const buildCodexSessionHookConfigs = (options: ICodexSessionHookOptions): string[] => {
  const capability = createCodexHookCapability(options.tabId, options.sessionName);
  const spec = [
    { event: 'SessionStart', hookEvent: 'session-start', matcher: 'startup|resume' },
    { event: 'UserPromptSubmit', hookEvent: 'prompt-submit' },
    { event: 'Stop', hookEvent: 'stop' },
  ];
  return spec.map(({ event, hookEvent, matcher }) => {
    const matcherConfig = matcher ? `matcher=${tomlString(matcher)},` : '';
    return `hooks.${event}=[{${matcherConfig}hooks=[${buildHandler(hookEvent, capability, options)}]}]`;
  });
};

export const CODEXMUX_STATUS_HOOK_BRIDGE_PATH = BRIDGE_PATH;

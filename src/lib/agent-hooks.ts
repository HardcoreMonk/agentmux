import { createHmac, timingSafeEqual } from 'crypto';
import path from 'path';
import { getDataDir } from '@/lib/app-identity';
import { getCliToken } from '@/lib/cli-token';

const CAPABILITY_VERSION = 1;
const CAPABILITY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const STATUS_HOOK_BRIDGE_PATH = path.join(getDataDir(), 'status-hook.cjs');

export interface IAgentHookCapabilityPayload {
  v: number;
  tabId: string;
  sessionName: string;
  expiresAt: number;
}

const sign = (encodedPayload: string): string =>
  createHmac('sha256', getCliToken()).update(encodedPayload).digest('base64url');

export const createAgentHookCapability = (
  tabId: string,
  sessionName: string,
  now = Date.now(),
): string => {
  const payload: IAgentHookCapabilityPayload = {
    v: CAPABILITY_VERSION,
    tabId,
    sessionName,
    expiresAt: now + CAPABILITY_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
};

export const verifyAgentHookCapability = (
  capability: string,
  expectedSessionName: string,
  now = Date.now(),
): IAgentHookCapabilityPayload | null => {
  const [encoded, signature, extra] = capability.split('.');
  if (!encoded || !signature || extra) return null;
  const expected = sign(encoded);
  if (signature.length !== expected.length
    || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as IAgentHookCapabilityPayload;
    if (payload.v !== CAPABILITY_VERSION || !payload.tabId || payload.sessionName !== expectedSessionName) {
      return null;
    }
    if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= now) return null;
    return payload;
  } catch {
    return null;
  }
};

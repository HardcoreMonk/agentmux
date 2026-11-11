import type { NextApiRequest, NextApiResponse } from 'next';
import { findTabInAnyWorkspace } from '@/lib/workspace-tab-service';
import type { ITabLocation } from '@/lib/cli-utils';

export const CALLER_TAB_HEADER = 'x-agentmux-caller-tab';
export const DELEGATION_TAB_LIMIT = 6;

export type TCliCallerResult =
  | { ok: true; caller: ITabLocation | null }
  | { ok: false; status: 404; code: 'caller-tab-not-found' };

const readCallerTabId = (req: NextApiRequest): string | null => {
  const raw = req.headers[CALLER_TAB_HEADER];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return value || null;
};

export const resolveCliCaller = async (req: NextApiRequest): Promise<TCliCallerResult> => {
  const tabId = readCallerTabId(req);
  if (!tabId) return { ok: true, caller: null };
  const caller = await findTabInAnyWorkspace(tabId);
  return caller ? { ok: true, caller } : { ok: false, status: 404, code: 'caller-tab-not-found' };
};

const g = globalThis as unknown as { __ptDelegationLocks?: Map<string, Promise<void>> };
if (!g.__ptDelegationLocks) g.__ptDelegationLocks = new Map();
const delegationLocks = g.__ptDelegationLocks;

export const withDelegationLock = async <T>(workspaceId: string, fn: () => Promise<T>): Promise<T> => {
  let release: () => void = () => undefined;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prev = delegationLocks.get(workspaceId) ?? Promise.resolve();
  delegationLocks.set(workspaceId, next);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (delegationLocks.get(workspaceId) === next) delegationLocks.delete(workspaceId);
  }
};

export const sendCliError = (res: NextApiResponse, status: number, code: string, message: string): void => {
  res.status(status).json({ error: code, message });
};

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export const sendCliServiceError = (res: NextApiResponse, err: unknown): void => {
  if ((err as { code?: unknown } | null)?.code === 'runtime-v2-disabled') {
    sendCliError(res, 409, 'runtime-v2-disabled', errorMessage(err));
    return;
  }
  sendCliError(res, 500, 'internal-error', errorMessage(err));
};

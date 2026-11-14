import { createHash } from 'crypto';
import { createAgentHookCapability, STATUS_HOOK_BRIDGE_PATH } from '@/lib/agent-hooks';
import {
  CODEX_HOOK_CAPABILITY_ENV,
  CODEX_HOOK_FINGERPRINT_ENV,
  CODEX_HOOK_SESSION_ENV,
  CODEX_SESSION_HOOKS,
} from '@/lib/codex-session-hook-spec';

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
const windowsQuote = (value: string): string => `"${value.replace(/"/g, '\\"')}"`;
const tomlString = (value: string): string => JSON.stringify(value);

interface ICodexSessionHookOptions {
  nodePath?: string;
}

const buildHandler = (event: string, options: ICodexSessionHookOptions): string => {
  const nodePath = options.nodePath ?? process.execPath;
  const args = [nodePath, STATUS_HOOK_BRIDGE_PATH, event];
  const posix = `ELECTRON_RUN_AS_NODE=1 ${args.map(shellQuote).join(' ')}`;
  const windows = `set "ELECTRON_RUN_AS_NODE=1" && ${args.map(windowsQuote).join(' ')}`;
  return `{type="command",command=${tomlString(posix)},commandWindows=${tomlString(windows)},timeout=3,async=true}`;
};

export const buildCodexSessionHookConfigs = (options: ICodexSessionHookOptions = {}): string[] =>
  CODEX_SESSION_HOOKS.map(({ event, hookEvent, matcher }) => {
    const matcherConfig = matcher ? `matcher=${tomlString(matcher)},` : '';
    return `hooks.${event}=[{${matcherConfig}hooks=[${buildHandler(hookEvent, options)}]}]`;
  });

export const getCodexHookFingerprint = (): string =>
  createHash('sha256').update(buildCodexSessionHookConfigs().join('\n')).digest('hex');

export const buildCodexHookEnvPrefix = ({ tabId, sessionName }: { tabId: string; sessionName: string }): string =>
  `${CODEX_HOOK_SESSION_ENV}=${shellQuote(sessionName)} ` +
  `${CODEX_HOOK_CAPABILITY_ENV}=${shellQuote(createAgentHookCapability(tabId, sessionName))} ` +
  `${CODEX_HOOK_FINGERPRINT_ENV}=${shellQuote(getCodexHookFingerprint())} `;

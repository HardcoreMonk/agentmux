import { createAgentHookCapability, STATUS_HOOK_BRIDGE_PATH } from '@/lib/agent-hooks';

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
  const args = [nodePath, STATUS_HOOK_BRIDGE_PATH, event, options.sessionName, capability];
  const posix = `ELECTRON_RUN_AS_NODE=1 ${args.map(shellQuote).join(' ')}`;
  const windows = `set "ELECTRON_RUN_AS_NODE=1" && ${args.map(windowsQuote).join(' ')}`;
  return `{type="command",command=${tomlString(posix)},commandWindows=${tomlString(windows)},timeout=3,async=true}`;
};

export const buildCodexSessionHookConfigs = (options: ICodexSessionHookOptions): string[] => {
  const capability = createAgentHookCapability(options.tabId, options.sessionName);
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

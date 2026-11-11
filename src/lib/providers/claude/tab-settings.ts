import fs from 'fs/promises';
import path from 'path';
import { getDataDir } from '@/lib/app-identity';
import { createAgentHookCapability, STATUS_HOOK_BRIDGE_PATH } from '@/lib/agent-hooks';
import { shQuote, STATUSLINE_SCRIPT_PATH } from '@/lib/statusline-script';

interface IClaudeTabSettingsInput {
  tabId: string;
  sessionName: string;
  nodePath?: string;
  allowDelegation?: boolean;
}

// `tab browser` (page eval) and the rest of the CLI still ask the user.
export const CLAUDE_DELEGATION_ALLOW_RULES: readonly string[] = ['list', 'create', 'send', 'status', 'result', 'close']
  .map((subcommand) => `Bash(agentmux tab ${subcommand}:*)`);

const HOOK_EVENTS = [
  { name: 'SessionStart', bridgeEvent: 'session-start', matcher: 'startup|resume|clear|fork' },
  { name: 'UserPromptSubmit', bridgeEvent: 'prompt-submit' },
  { name: 'Notification', bridgeEvent: 'notification' },
  { name: 'Stop', bridgeEvent: 'stop' },
  { name: 'StopFailure', bridgeEvent: 'stop' },
  { name: 'PreCompact', bridgeEvent: 'pre-compact' },
  { name: 'PostCompact', bridgeEvent: 'post-compact' },
] as const;

const getTabSettingsDir = (): string => path.join(getDataDir(), 'claude-tabs');

export const getClaudeTabSettingsPath = (tabId: string): string =>
  path.join(getTabSettingsDir(), `${tabId}.json`);

const buildNodeCommand = (nodePath: string, args: string[]): string =>
  `ELECTRON_RUN_AS_NODE=1 ${[nodePath, ...args].map(shQuote).join(' ')}`;

export const writeClaudeTabSettings = async ({
  tabId,
  sessionName,
  nodePath = process.execPath,
  allowDelegation = false,
}: IClaudeTabSettingsInput): Promise<string> => {
  const capability = createAgentHookCapability(tabId, sessionName);
  const hooks = Object.fromEntries(HOOK_EVENTS.map((spec) => [
    spec.name,
    [{
      matcher: 'matcher' in spec ? spec.matcher : '',
      hooks: [{
        type: 'command',
        command: buildNodeCommand(nodePath, [STATUS_HOOK_BRIDGE_PATH, spec.bridgeEvent, sessionName, capability]),
        async: true,
        timeout: 3,
      }],
    }],
  ]));
  const settings = {
    hooks,
    statusLine: {
      type: 'command',
      command: buildNodeCommand(nodePath, [STATUSLINE_SCRIPT_PATH]),
    },
    ...(allowDelegation ? { permissions: { allow: [...CLAUDE_DELEGATION_ALLOW_RULES] } } : {}),
  };

  const dir = getTabSettingsDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);
  const filePath = getClaudeTabSettingsPath(tabId);
  await fs.writeFile(filePath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(filePath, 0o600);
  return filePath;
};

export const removeClaudeTabSettings = async (tabId: string): Promise<void> => {
  await fs.rm(getClaudeTabSettingsPath(tabId), { force: true });
};

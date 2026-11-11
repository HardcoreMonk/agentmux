import fs from 'fs/promises';
import path from 'path';
import { getDataDir } from '@/lib/app-identity';
import type { IConfigData } from '@/lib/config-store';
import { writeIfChanged } from '@/lib/hook-settings';
import { shQuote } from '@/lib/statusline-script';

export type TDelegationProvider = 'claude' | 'codex';

const CLAUDE_GUIDE = `# agentmux delegation

You are running inside an agentmux tab. You can hand work to other agent tabs in this workspace with the \`agentmux\` CLI. Delegation runs without asking the user; new tabs appear in the user's tab bar.

The CLI reads the workspace and your tab from AMUX_WORKSPACE_ID and AMUX_TAB_ID, so you do not need -w.

- agentmux tab list
- agentmux tab create -t claude|codex|terminal [-n NAME] [--cwd DIR]   (prints tabId and ready; waits up to 60 seconds for the agent)
- agentmux tab send TAB_ID 'instruction'   (quote the instruction with single quotes so your shell does not expand backticks or $; use a heredoc for multi-line text)
- agentmux tab status TAB_ID   (cliState)
- agentmux tab result TAB_ID   (lastAssistantMessage and the screen)
- agentmux tab close TAB_ID    (only tabs you created)

cliState: idle = waiting for input. busy = working. needs-input = waiting for the user to answer a permission prompt. ready-for-review = finished a turn; read the result.

How to delegate:
1. Create the tab and check that ready is true. If it is false, tell the user the new tab needs attention on screen.
2. Send one self-contained instruction: the goal, the files, and how to tell it is done.
3. Check \`tab status\` no more often than every 10 seconds until cliState is ready-for-review or idle, then read \`tab result\`.
4. Close tabs you no longer need.

Limits: at most 6 open tabs created by agents per workspace (error delegation-limit). \`tab send\` refuses a target that is waiting for a permission answer (target-needs-input) or has not started (target-not-ready). Never answer another tab's permission prompt. Do not create tabs in a loop.
`;

const CODEX_SANDBOX_PARAGRAPH = `
If the agentmux CLI fails with a network error, your sandbox blocks local network access. Tell the user that delegation is not available in this sandbox.
`;

export const isDelegationGuideEnabled = (
  config: Pick<IConfigData, 'agentDelegationGuideEnabled'>,
): boolean => config.agentDelegationGuideEnabled !== false;

export const buildDelegationGuide = (provider: TDelegationProvider): string =>
  provider === 'codex' ? `${CLAUDE_GUIDE}${CODEX_SANDBOX_PARAGRAPH}` : CLAUDE_GUIDE;

export const getDelegationShimDir = (baseDir = getDataDir()): string => path.join(baseDir, 'bin');

export const getClaudeDelegationGuidePath = (baseDir = getDataDir()): string =>
  path.join(baseDir, 'delegation', 'claude.md');

export const buildDelegationShimSource = (input: {
  nodePath: string;
  cliEntryPath: string;
  dataDir: string;
}): string =>
  `#!/bin/sh\nAGENTMUX_DATA_DIR=${shQuote(input.dataDir)} exec ${shQuote(input.nodePath)} ${shQuote(input.cliEntryPath)} "$@"\n`;

export const ensureDelegationAssets = async (
  input: { baseDir?: string; nodePath?: string; appDir?: string } = {},
): Promise<void> => {
  const baseDir = input.baseDir ?? getDataDir();
  const nodePath = input.nodePath ?? process.execPath;
  const appDir = input.appDir ?? process.env.__CMUX_APP_DIR ?? process.cwd();
  const shimDir = getDelegationShimDir(baseDir);
  const guidePath = getClaudeDelegationGuidePath(baseDir);

  await fs.mkdir(shimDir, { recursive: true });
  await fs.mkdir(path.dirname(guidePath), { recursive: true });

  await writeIfChanged(
    path.join(shimDir, 'agentmux'),
    buildDelegationShimSource({
      nodePath,
      cliEntryPath: path.join(appDir, 'bin', 'agentmux.js'),
      dataDir: baseDir,
    }),
    0o700,
  );
  await writeIfChanged(guidePath, buildDelegationGuide('claude'), 0o600);
};

export const buildDelegationEnvPrefix = (input: {
  workspaceId: string;
  tabId: string;
  shimDir: string;
}): string =>
  `AMUX_WORKSPACE_ID=${shQuote(input.workspaceId)} AMUX_TAB_ID=${shQuote(input.tabId)} PATH=${shQuote(input.shimDir)}:"$PATH" `;

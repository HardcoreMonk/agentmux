import { checkTerminalProcess, sendKeys } from '@/lib/tmux';
import { readLayoutFile, resolveLayoutFile } from '@/lib/layout-store';
import { findPane } from '@/lib/layout-tree';
import { getProviderByPanelType } from '@/lib/providers';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';
import { resolveTabRuntimeVersion } from '@/lib/runtime/terminal-mode';
import { getCachedRuntimePreflight } from '@/lib/preflight';

export type TAgentLaunchAction = 'launch' | 'resume';

export interface IAgentLaunchInput {
  workspaceId: string;
  paneId: string;
  tabId: string;
  action: TAgentLaunchAction;
  sessionId?: string;
}

export interface IAgentLaunchResult {
  ok: boolean;
  code?: 'tab-not-found' | 'invalid-panel' | 'unsafe-process' | 'invalid-session' | 'codex-update-required';
  processName?: string;
}

export const launchAgentInTab = async (input: IAgentLaunchInput): Promise<IAgentLaunchResult> => {
  const layout = await readLayoutFile(resolveLayoutFile(input.workspaceId));
  const pane = layout ? findPane(layout.root, input.paneId) : null;
  const tab = pane?.tabs.find((candidate) => candidate.id === input.tabId);
  if (!tab) return { ok: false, code: 'tab-not-found' };

  const provider = getProviderByPanelType(tab.panelType);
  if (!provider) return { ok: false, code: 'invalid-panel' };
  if (input.action === 'resume' && !provider.isValidSessionId(input.sessionId)) {
    return { ok: false, code: 'invalid-session' };
  }

  const preflight = await getCachedRuntimePreflight();
  if (!preflight.agent.installed || preflight.agent.compatible === false) {
    return { ok: false, code: 'codex-update-required' };
  }

  if (resolveTabRuntimeVersion(tab) === 1) {
    const process = await checkTerminalProcess(tab.sessionName);
    if (!process.isSafe) {
      return { ok: false, code: 'unsafe-process', processName: process.processName };
    }
  }

  const commandOptions = {
    workspaceId: input.workspaceId,
    tabId: tab.id,
    sessionName: tab.sessionName,
  };
  const command = input.action === 'resume' && input.sessionId
    ? await provider.buildResumeCommand(input.sessionId, commandOptions)
    : await provider.buildLaunchCommand(commandOptions);

  if (resolveTabRuntimeVersion(tab) === 2) {
    await getRuntimeSupervisor().writeTerminalSession({
      sessionName: tab.sessionName,
      data: `${command}\r`,
    });
  } else {
    await sendKeys(tab.sessionName, command);
  }
  return { ok: true };
};

import { checkTerminalProcess, sendKeys } from '@/lib/tmux';
import { patchTab, readLayoutFile, resolveLayoutFile, updateTabAgentSession } from '@/lib/layout-store';
import { findPane } from '@/lib/layout-tree';
import { getProviderByPanelType } from '@/lib/providers';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';
import { resolveTabRuntimeVersion } from '@/lib/runtime/terminal-mode';
import { getCachedRuntimePreflight } from '@/lib/preflight';
import type { TAgentPanelType } from '@/types/terminal';

export type TAgentLaunchAction = 'launch' | 'resume';

export interface IAgentLaunchInput {
  workspaceId: string;
  paneId: string;
  tabId: string;
  action: TAgentLaunchAction;
  sessionId?: string;
  // Target agent kind. When it differs from the stored tab kind the server switches the tab.
  panelType?: TAgentPanelType;
}

export interface IAgentLaunchResult {
  ok: boolean;
  code?: 'tab-not-found' | 'invalid-panel' | 'unsafe-process' | 'invalid-session' | 'agent-unavailable'
    | 'runtime-v2-agent-unsupported';
  processName?: string;
}

export const launchAgentInTab = async (input: IAgentLaunchInput): Promise<IAgentLaunchResult> => {
  const layout = await readLayoutFile(resolveLayoutFile(input.workspaceId));
  const pane = layout ? findPane(layout.root, input.paneId) : null;
  const tab = pane?.tabs.find((candidate) => candidate.id === input.tabId);
  if (!tab) return { ok: false, code: 'tab-not-found' };

  const provider = getProviderByPanelType(input.panelType ?? tab.panelType);
  if (!provider) return { ok: false, code: 'invalid-panel' };
  if (input.action === 'resume' && !provider.isValidSessionId(input.sessionId)) {
    return { ok: false, code: 'invalid-session' };
  }

  const preflight = await getCachedRuntimePreflight();
  const agentStatus = preflight.agents[provider.id as TAgentPanelType];
  if (!agentStatus?.installed || agentStatus.compatible === false) {
    return { ok: false, code: 'agent-unavailable' };
  }

  if (resolveTabRuntimeVersion(tab) === 1) {
    const process = await checkTerminalProcess(tab.sessionName);
    if (!process.isSafe) {
      return { ok: false, code: 'unsafe-process', processName: process.processName };
    }
  }

  if (input.panelType && input.panelType !== tab.panelType && resolveTabRuntimeVersion(tab) === 2) {
    return { ok: false, code: 'runtime-v2-agent-unsupported' };
  }

  // Build the command before changing the stored tab, so a build failure leaves the tab untouched.
  const commandOptions = {
    workspaceId: input.workspaceId,
    tabId: tab.id,
    sessionName: tab.sessionName,
  };
  let command: string;
  let bindSessionId: string | null = null;
  if (input.action === 'resume' && input.sessionId) {
    command = await provider.buildResumeCommand(input.sessionId, commandOptions);
    bindSessionId = input.sessionId;
  } else if (input.action === 'launch' && provider.createLaunchSessionId) {
    bindSessionId = provider.createLaunchSessionId();
    command = await provider.buildLaunchCommand({ ...commandOptions, sessionId: bindSessionId });
  } else {
    command = await provider.buildLaunchCommand(commandOptions);
  }

  if (input.panelType && input.panelType !== tab.panelType) {
    await patchTab(input.workspaceId, input.paneId, input.tabId, { panelType: input.panelType });
  }
  if (bindSessionId) {
    // Bind the session before sending so status and timeline follow it (resume: same rule as new-tab and
    // WS resume; launch: drop the previous session's JSONL).
    await updateTabAgentSession(tab.sessionName, provider, { sessionId: bindSessionId, jsonlPath: null });
  }

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

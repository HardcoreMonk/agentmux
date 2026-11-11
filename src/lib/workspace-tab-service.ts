import os from 'os';
import {
  addExistingTabToPane,
  addTabToPane,
  getLayout,
  readLayoutFile,
  removeTabFromPane,
  resolveLayoutFile,
  updateTabAgentSessionId,
  type IAddTabOptions,
} from '@/lib/layout-store';
import { collectAllTabs, collectPanes, findPane } from '@/lib/layout-tree';
import { getWorkspaceById, getWorkspaces } from '@/lib/workspace-store';
import { getStatusManager } from '@/lib/status-manager';
import { getProviderByPanelType } from '@/lib/providers';
import { createLogger } from '@/lib/logger';
import { resolveTabRuntimeVersion, shouldCreateTerminalTabInRuntimeV2 } from '@/lib/runtime/terminal-mode';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';
import { shouldUseRuntimeStatusV2Live } from '@/lib/runtime/status-mode';
import { DEFAULT_AGENT_PANEL_TYPE, isAgentPanelType } from '@/lib/panel-type';
import { launchAgentInTab, type IAgentLaunchResult } from '@/lib/agent-launch-service';
import {
  buildBracketedPaste,
  capturePaneContent,
  getSessionPanePid,
  hasSession,
  sendBracketedPaste,
} from '@/lib/tmux';
import { hasPermissionPrompt } from '@/lib/permission-prompt';
import { matchAgentStartupScreen } from '@/lib/agent-startup-screen';
import type { ITabLocation } from '@/lib/cli-utils';
import type { IClientTabStatusEntry } from '@/types/status';
import type { ITab, IWorkspace, TPanelType } from '@/types/terminal';
import type { ITimelineAssistantMessage, TCliState } from '@/types/timeline';

const log = createLogger('layout');

const SHELL_READY_DELAY_MS = 500;
const ASSISTANT_TAIL_ENTRIES = 50;

export const AGENT_READY_TIMEOUT_MS = 60_000;
export const AGENT_READY_POLL_MS = 500;

export interface ICreateWorkspaceTabInput {
  workspaceId: string;
  paneId: string;
  name?: string;
  cwd?: string;
  panelType?: TPanelType | null;
  command?: string;
  resumeSessionId?: string;
  startAgent?: boolean;
  activate?: boolean;
  createdByTabId?: string | null;
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isRuntimeV2Enabled = (): boolean => process.env.AGENTMUX_RUNTIME_V2 === '1';

const isRuntimeV2Tab = (tab: ITab): boolean => resolveTabRuntimeVersion(tab) === 2;

const runtimeV2DisabledError = (): Error =>
  Object.assign(new Error('Runtime v2 is disabled'), { code: 'runtime-v2-disabled' as const });

const isPlainTerminalTabRequest = (input: {
  panelType?: unknown;
  command?: unknown;
  resumeSessionId?: unknown;
}): boolean => {
  if (input.command || input.resumeSessionId) return false;
  return input.panelType === undefined || input.panelType === null || input.panelType === '' || input.panelType === 'terminal';
};

const readPaneActiveTabId = async (workspaceId: string, paneId: string): Promise<string | null> => {
  const layout = await readLayoutFile(resolveLayoutFile(workspaceId));
  return layout ? findPane(layout.root, paneId)?.activeTabId ?? null : null;
};

const createRuntimeTerminalTab = async (
  input: ICreateWorkspaceTabInput,
  cwd: string,
  workspace: IWorkspace | null | undefined,
  addOptions: IAddTabOptions | undefined,
): Promise<ITab | null> => {
  const { workspaceId, paneId, name } = input;
  const restoreActiveTabId = input.activate === false ? await readPaneActiveTabId(workspaceId, paneId) : undefined;
  const supervisor = getRuntimeSupervisor();
  await supervisor.ensureStarted();
  const runtimeTab = await supervisor.createTerminalTab({
    workspaceId,
    paneId,
    cwd,
    ensureWorkspacePane: {
      workspaceName: workspace?.name ?? workspaceId,
      defaultCwd: workspace?.directories[0] ?? cwd,
    },
  });
  const tab: ITab = {
    id: runtimeTab.id,
    sessionName: runtimeTab.sessionName,
    name: typeof name === 'string' ? name.trim() : runtimeTab.name,
    order: runtimeTab.order,
    cwd: runtimeTab.cwd ?? cwd,
    panelType: 'terminal',
    runtimeVersion: 2,
  };
  const added = addOptions
    ? await addExistingTabToPane(workspaceId, paneId, tab, {
        ...addOptions,
        ...(restoreActiveTabId !== undefined ? { restoreActiveTabId } : {}),
      })
    : await addExistingTabToPane(workspaceId, paneId, tab);
  if (!added) {
    await Promise.resolve(supervisor.deleteTerminalTab(runtimeTab.id)).catch((err) => {
      log.warn(`runtime v2 tab rollback failed: ${errorMessage(err)}`);
    });
  }
  return added;
};

const registerTabStatus = (workspaceId: string, tab: ITab): void => {
  if (tab.panelType === 'web-browser') return;
  const statusEntry = {
    cliState: 'inactive',
    workspaceId,
    tabName: tab.name,
    tmuxSession: tab.sessionName,
    ...(tab.panelType ? { panelType: tab.panelType } : {}),
    lastEvent: null,
    eventSeq: 0,
  } as const;
  if (shouldUseRuntimeStatusV2Live()) {
    getRuntimeSupervisor().registerStatusLiveTab({ tabId: tab.id, entry: statusEntry }).catch((err) => {
      log.warn(`runtime status register tab failed: ${errorMessage(err)}`);
    });
  } else {
    getStatusManager().registerTab(tab.id, statusEntry);
  }
};

export const createWorkspaceTab = async (input: ICreateWorkspaceTabInput): Promise<ITab | null> => {
  const { workspaceId, paneId, name, cwd, command, resumeSessionId } = input;
  const panelType = input.panelType ?? undefined;
  const addOptions: IAddTabOptions | undefined = input.activate !== undefined || input.createdByTabId !== undefined
    ? { activate: input.activate, createdByTabId: input.createdByTabId }
    : undefined;

  const shouldUseRuntimeV2 = shouldCreateTerminalTabInRuntimeV2()
    && isPlainTerminalTabRequest({ panelType, command, resumeSessionId });
  const isAgentTabRequest = isAgentPanelType(panelType);
  const workspace = shouldUseRuntimeV2 || isAgentTabRequest ? await getWorkspaceById(workspaceId) : null;
  const effectiveCwd = typeof cwd === 'string' && cwd.trim()
    ? cwd.trim()
    : workspace?.directories[0] ?? os.homedir();
  const legacyCwd = isAgentTabRequest ? effectiveCwd : cwd;

  const tab = shouldUseRuntimeV2
    ? await createRuntimeTerminalTab(input, effectiveCwd, workspace, addOptions)
    : addOptions
      ? await addTabToPane(workspaceId, paneId, name, legacyCwd, panelType, command, addOptions)
      : await addTabToPane(workspaceId, paneId, name, legacyCwd, panelType, command);
  if (!tab) return null;

  registerTabStatus(workspaceId, tab);

  const resumeProvider = resumeSessionId ? getProviderByPanelType(panelType ?? DEFAULT_AGENT_PANEL_TYPE) : null;
  if (resumeSessionId && resumeProvider && !command) {
    await updateTabAgentSessionId(tab.sessionName, resumeProvider, resumeSessionId);
    resumeProvider.writeSessionId(tab, resumeSessionId);
    setTimeout(async () => {
      try {
        await launchAgentInTab({
          workspaceId,
          paneId,
          tabId: tab.id,
          action: 'resume',
          sessionId: resumeSessionId,
        });
      } catch (err) {
        log.warn(`resume launch failed: ${errorMessage(err)}`);
      }
    }, SHELL_READY_DELAY_MS);
  }

  if (input.startAgent === true && isAgentTabRequest && !resumeSessionId && !command) {
    setTimeout(() => {
      launchAgentInTab({
        workspaceId,
        paneId,
        tabId: tab.id,
        action: 'launch',
      }).catch((err) => {
        log.warn(`agent launch failed: ${errorMessage(err)}`);
      });
    }, SHELL_READY_DELAY_MS);
  }

  return tab;
};

export const launchAgentAfterShellReady = async (input: {
  workspaceId: string;
  paneId: string;
  tabId: string;
}): Promise<IAgentLaunchResult> => {
  await sleep(SHELL_READY_DELAY_MS);
  return launchAgentInTab({ ...input, action: 'launch' });
};

export const closeWorkspaceTab = async (workspaceId: string, paneId: string, tabId: string): Promise<boolean> => {
  const found = await removeTabFromPane(workspaceId, paneId, tabId);
  if (!found) return false;
  if (shouldUseRuntimeStatusV2Live()) {
    getRuntimeSupervisor().removeStatusLiveTab({ tabId }).catch((err) => {
      log.warn(`runtime status remove tab failed: ${errorMessage(err)}`);
    });
  } else {
    getStatusManager().removeTab(tabId);
  }
  return true;
};

export const readTabStatusEntry = async (tab: ITab): Promise<IClientTabStatusEntry | null> => {
  if (shouldUseRuntimeStatusV2Live()) {
    const sync = await getRuntimeSupervisor().requestStatusLiveSync();
    return sync.tabs[tab.id] ?? null;
  }
  return getStatusManager().getAllForClient()[tab.id] ?? null;
};

export const readTabCliState = async (tab: ITab): Promise<TCliState | null> => {
  const entry = await readTabStatusEntry(tab);
  return entry?.cliState ?? tab.cliState ?? null;
};

export const isTabSessionAlive = async (tab: ITab): Promise<boolean> => {
  if (!isRuntimeV2Tab(tab)) return hasSession(tab.sessionName);
  if (!isRuntimeV2Enabled()) return false;
  return getRuntimeSupervisor().hasTerminalSession({ sessionName: tab.sessionName });
};

export const isAgentProcessRunning = async (tab: ITab): Promise<boolean> => {
  if (isRuntimeV2Tab(tab) || !isAgentPanelType(tab.panelType)) return false;
  const provider = getProviderByPanelType(tab.panelType);
  if (!provider) return false;
  const panePid = await getSessionPanePid(tab.sessionName);
  if (!panePid) return false;
  return provider.isAgentRunning(panePid);
};

export const readTabScreen = async (tab: ITab): Promise<string | null> => {
  if (!isRuntimeV2Tab(tab)) return capturePaneContent(tab.sessionName);
  if (!isRuntimeV2Enabled()) return null;
  try {
    const { content } = await getRuntimeSupervisor().captureTerminalSession({ sessionName: tab.sessionName });
    return content;
  } catch {
    return null;
  }
};

const isBlockingAgentScreen = (screen: string): boolean =>
  hasPermissionPrompt(screen) || matchAgentStartupScreen(screen) !== null;

export const writeTabInput = async (
  tab: ITab,
  content: string,
  options?: { guardFollowUpEnter?: boolean },
): Promise<{ followUpEnterSkipped: boolean }> => {
  if (isRuntimeV2Tab(tab)) {
    if (!isRuntimeV2Enabled()) throw runtimeV2DisabledError();
    await getRuntimeSupervisor().sendTerminalSessionText({
      sessionName: tab.sessionName,
      text: buildBracketedPaste(content),
      enter: true,
    });
    return { followUpEnterSkipped: false };
  }

  if (!options?.guardFollowUpEnter) {
    await sendBracketedPaste(tab.sessionName, content);
    return { followUpEnterSkipped: false };
  }

  let followUpEnterSkipped = false;
  await sendBracketedPaste(tab.sessionName, content, {
    beforeFollowUpEnter: async () => {
      const screen = await capturePaneContent(tab.sessionName);
      // An unreadable screen is treated like a prompt: never press Enter blind.
      followUpEnterSkipped = screen === null || isBlockingAgentScreen(screen);
      return !followUpEnterSkipped;
    },
  });
  return { followUpEnterSkipped };
};

export const readLastAssistantMessage = async (
  tab: ITab,
): Promise<{ text: string; timestamp: number } | null> => {
  if (!isAgentPanelType(tab.panelType)) return null;
  const provider = getProviderByPanelType(tab.panelType);
  if (!provider) return null;
  const sessionId = provider.readSessionId(tab);
  const jsonlPath = provider.readJsonlPath(tab)
    ?? (sessionId ? await provider.resolveJsonlPath(sessionId, tab.cwd ?? '') : null);
  if (!jsonlPath) return null;
  const { entries } = await provider.readTailEntries(jsonlPath, ASSISTANT_TAIL_ENTRIES);
  const last = entries.findLast((entry): entry is ITimelineAssistantMessage => entry.type === 'assistant-message');
  return last ? { text: last.markdown, timestamp: last.timestamp } : null;
};

export const findTabInAnyWorkspace = async (tabId: string): Promise<ITabLocation | null> => {
  const { workspaces } = await getWorkspaces();
  for (const workspace of workspaces) {
    const layout = await getLayout(workspace.id);
    for (const pane of collectPanes(layout.root)) {
      const tab = pane.tabs.find((candidate) => candidate.id === tabId);
      if (tab) return { workspaceId: workspace.id, paneId: pane.id, tab };
    }
  }
  return null;
};

export const countDelegatedTabs = async (workspaceId: string): Promise<number> => {
  const layout = await getLayout(workspaceId);
  return collectAllTabs(layout.root).filter((tab) => tab.createdByTabId).length;
};

const isAgentReadyEntry = (entry: IClientTabStatusEntry | null, launchStartedAt: number): boolean =>
  entry?.cliState === 'idle'
  && entry.lastEvent?.name === 'session-start'
  && entry.lastEvent.at >= launchStartedAt;

export const waitForAgentReady = async (
  tab: ITab,
  options: { launchStartedAt: number; timeoutMs?: number; pollMs?: number },
): Promise<boolean> => {
  const { launchStartedAt, timeoutMs = AGENT_READY_TIMEOUT_MS, pollMs = AGENT_READY_POLL_MS } = options;
  const deadline = Date.now() + timeoutMs;
  while (!isAgentReadyEntry(await readTabStatusEntry(tab).catch(() => null), launchStartedAt)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await sleep(Math.min(pollMs, remaining));
  }
  return true;
};

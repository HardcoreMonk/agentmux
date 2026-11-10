import os from 'os';
import type { NextApiRequest, NextApiResponse } from 'next';
import { addExistingTabToPane, addTabToPane, updateTabAgentSessionId } from '@/lib/layout-store';
import { getActiveWorkspaceId, getWorkspaceById } from '@/lib/workspace-store';
import { getStatusManager } from '@/lib/status-manager';
import { getProviderByPanelType } from '@/lib/providers';
import { createLogger } from '@/lib/logger';
import { shouldCreateTerminalTabInRuntimeV2 } from '@/lib/runtime/terminal-mode';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';
import { getRuntimeStatusV2Mode } from '@/lib/runtime/status-mode';
import { DEFAULT_AGENT_PANEL_TYPE, isAgentPanelType, normalizePanelType } from '@/lib/panel-type';
import { launchAgentInTab } from '@/lib/agent-launch-service';

const log = createLogger('layout');

const SHELL_READY_DELAY_MS = 500;

const shouldUseRuntimeStatusLive = (): boolean =>
  process.env.AGENTMUX_RUNTIME_V2 === '1' && getRuntimeStatusV2Mode() === 'default';

const isPlainTerminalTabRequest = (input: {
  panelType?: unknown;
  command?: unknown;
  resumeSessionId?: unknown;
}): boolean => {
  if (input.command || input.resumeSessionId) return false;
  return input.panelType === undefined || input.panelType === null || input.panelType === '' || input.panelType === 'terminal';
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const wsId = (req.query.workspace as string) || await getActiveWorkspaceId();
  if (!wsId) {
    return res.status(400).json({ error: 'No workspace found' });
  }

  const paneId = req.query.paneId as string;
  const { name, cwd, command, resumeSessionId, startAgent } = req.body ?? {};
  const panelType = normalizePanelType(req.body?.panelType);

  const rawPanelType = req.body?.panelType;
  if (resumeSessionId && rawPanelType !== undefined && rawPanelType !== null && rawPanelType !== ''
    && !isAgentPanelType(panelType)) {
    return res.status(400).json({ error: 'Unknown panel type for resume' });
  }

  const provider = resumeSessionId ? getProviderByPanelType(panelType ?? DEFAULT_AGENT_PANEL_TYPE) : null;
  if (resumeSessionId) {
    if (!provider) {
      return res.status(400).json({ error: 'Unknown panel type for resume' });
    }
    if (!provider.isValidSessionId(resumeSessionId)) {
      return res.status(400).json({ error: 'Invalid session ID format' });
    }
  }

  try {
    const shouldUseRuntimeV2 = shouldCreateTerminalTabInRuntimeV2()
      && isPlainTerminalTabRequest({ panelType, command, resumeSessionId });
    const isAgentTabRequest = isAgentPanelType(panelType);
    const workspace = shouldUseRuntimeV2 || isAgentTabRequest ? await getWorkspaceById(wsId) : null;
    const effectiveCwd = typeof cwd === 'string' && cwd.trim()
      ? cwd.trim()
      : workspace?.directories[0] ?? os.homedir();
    const tab = shouldUseRuntimeV2
      ? await (async () => {
          const supervisor = getRuntimeSupervisor();
          await supervisor.ensureStarted();
          const runtimeTab = await supervisor.createTerminalTab({
            workspaceId: wsId,
            paneId,
            cwd: effectiveCwd,
            ensureWorkspacePane: {
              workspaceName: workspace?.name ?? wsId,
              defaultCwd: workspace?.directories[0] ?? effectiveCwd,
            },
          });
          const added = await addExistingTabToPane(wsId, paneId, {
            id: runtimeTab.id,
            sessionName: runtimeTab.sessionName,
            name: typeof name === 'string' ? name.trim() : runtimeTab.name,
            order: runtimeTab.order,
            cwd: runtimeTab.cwd ?? effectiveCwd,
            panelType: 'terminal',
            runtimeVersion: 2,
          });
          if (!added) {
            await Promise.resolve(supervisor.deleteTerminalTab(runtimeTab.id)).catch((err) => {
              log.warn(`runtime v2 tab rollback failed: ${err instanceof Error ? err.message : err}`);
            });
          }
          return added;
        })()
      : await addTabToPane(wsId, paneId, name, isAgentTabRequest ? effectiveCwd : cwd, panelType, command);
    if (!tab) {
      return res.status(404).json({ error: 'Pane not found' });
    }
    if (tab.panelType !== 'web-browser') {
      const statusEntry = {
        cliState: 'inactive',
        workspaceId: wsId,
        tabName: tab.name,
        tmuxSession: tab.sessionName,
        lastEvent: null,
        eventSeq: 0,
      } as const;
      if (shouldUseRuntimeStatusLive()) {
        getRuntimeSupervisor().registerStatusLiveTab({ tabId: tab.id, entry: statusEntry }).catch((err) => {
          log.warn(`runtime status register tab failed: ${err instanceof Error ? err.message : err}`);
        });
      } else {
        getStatusManager().registerTab(tab.id, statusEntry);
      }
    }

    if (resumeSessionId && provider && !command) {
      await updateTabAgentSessionId(tab.sessionName, provider, resumeSessionId);
      provider.writeSessionId(tab, resumeSessionId);
      setTimeout(async () => {
        try {
          await launchAgentInTab({
            workspaceId: wsId,
            paneId,
            tabId: tab.id,
            action: 'resume',
            sessionId: resumeSessionId,
          });
        } catch (err) {
          log.warn(`resume launch failed: ${err instanceof Error ? err.message : err}`);
        }
      }, SHELL_READY_DELAY_MS);
    }

    if (startAgent === true && isAgentPanelType(panelType) && !resumeSessionId && !command) {
      setTimeout(() => {
        launchAgentInTab({
          workspaceId: wsId,
          paneId,
          tabId: tab.id,
          action: 'launch',
        }).catch((err) => {
          log.warn(`agent launch failed: ${err instanceof Error ? err.message : err}`);
        });
      }, SHELL_READY_DELAY_MS);
    }

    return res.status(200).json(tab);
  } catch (err) {
    log.error(`tab creation failed: ${err instanceof Error ? err.message : err}`);
    return res.status(500).json({ error: 'Failed to create tab' });
  }
};

export default handler;

import { stat } from 'fs/promises';
import path from 'path';
import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCliToken } from '@/lib/cli-token';
import { getLayout } from '@/lib/layout-store';
import { collectPanes } from '@/lib/layout-tree';
import { getWorkspaceById, getWorkspaces } from '@/lib/workspace-store';
import { resolveFirstPaneId } from '@/lib/cli-utils';
import {
  DELEGATION_TAB_LIMIT,
  resolveCliCaller,
  sendCliError,
  sendCliServiceError,
  withDelegationLock,
} from '@/lib/cli-caller';
import { createLogger } from '@/lib/logger';
import { isAgentPanelType, isPanelType, PANEL_TYPES } from '@/lib/panel-type';
import { getCachedRuntimePreflight } from '@/lib/preflight';
import { resolveTabRuntimeVersion } from '@/lib/runtime/terminal-mode';
import { getSessionCwd } from '@/lib/tmux';
import {
  countDelegatedTabs,
  createWorkspaceTab,
  launchAgentAfterShellReady,
  waitForAgentReady,
  type ICreateWorkspaceTabInput,
} from '@/lib/workspace-tab-service';
import type { ITab, TAgentPanelType, TPanelType, TRuntimeVersion } from '@/types/terminal';

const log = createLogger('api:cli:tabs');

interface ICliTabListItem {
  tabId: string;
  workspaceId: string;
  name: string;
  sessionName: string;
  panelType?: string;
  createdByTabId: string | null;
  runtimeVersion: TRuntimeVersion;
}

const isExistingDirectory = async (dir: string): Promise<boolean> => {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
};

const isValidCwd = async (cwd: string): Promise<boolean> => path.isAbsolute(cwd) && isExistingDirectory(cwd);

const readCurrentCwd = async (tab: ITab): Promise<string | undefined> => {
  if (resolveTabRuntimeVersion(tab) === 2) return tab.cwd;
  return (await getSessionCwd(tab.sessionName)) ?? tab.cwd;
};

const isAgentAvailable = async (panelType: TAgentPanelType): Promise<boolean> => {
  const status = (await getCachedRuntimePreflight()).agents[panelType];
  return Boolean(status?.installed) && status?.compatible !== false;
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (!verifyCliToken(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method === 'GET') {
    const wsId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
    const tabs: ICliTabListItem[] = [];

    const workspaceIds = wsId ? [wsId] : (await getWorkspaces()).workspaces.map((w) => w.id);

    for (const id of workspaceIds) {
      const ws = await getWorkspaceById(id);
      if (!ws) continue;
      const layout = await getLayout(id);
      for (const pane of collectPanes(layout.root)) {
        for (const tab of pane.tabs) {
          tabs.push({
            tabId: tab.id,
            workspaceId: id,
            name: tab.name,
            sessionName: tab.sessionName,
            panelType: tab.panelType,
            createdByTabId: tab.createdByTabId ?? null,
            runtimeVersion: resolveTabRuntimeVersion(tab),
          });
        }
      }
    }
    return res.status(200).json({ tabs });
  }

  if (req.method === 'POST') {
    const { workspaceId, name, panelType: rawPanelType, cwd: rawCwd } = req.body as {
      workspaceId?: string;
      name?: unknown;
      panelType?: unknown;
      cwd?: unknown;
    };
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId is required' });
    }
    const panelType: TPanelType | null = rawPanelType === undefined || rawPanelType === null
      ? 'terminal'
      : isPanelType(rawPanelType) ? rawPanelType : null;
    if (!panelType) {
      return sendCliError(res, 400, 'invalid-panel-type', `panelType must be one of: ${PANEL_TYPES.join(', ')}`);
    }
    const ws = await getWorkspaceById(workspaceId);
    if (!ws) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    try {
      const resolved = await resolveCliCaller(req);
      if (!resolved.ok) {
        return sendCliError(res, resolved.status, resolved.code, 'The calling tab was not found in any workspace');
      }
      const { caller } = resolved;
      const sameWorkspaceCaller = caller?.workspaceId === workspaceId ? caller : null;

      let cwd: string | undefined;
      if (rawCwd !== undefined && rawCwd !== null) {
        if (typeof rawCwd !== 'string' || !(await isValidCwd(rawCwd))) {
          return sendCliError(res, 400, 'invalid-cwd', 'cwd must be an absolute path to an existing directory');
        }
        cwd = rawCwd;
      } else {
        cwd = (sameWorkspaceCaller ? await readCurrentCwd(sameWorkspaceCaller.tab) : undefined) ?? ws.directories[0];
      }

      const paneId = sameWorkspaceCaller?.paneId ?? await resolveFirstPaneId(workspaceId);
      if (!paneId) {
        return res.status(500).json({ error: 'No pane available in workspace' });
      }

      if (isAgentPanelType(panelType) && !(await isAgentAvailable(panelType))) {
        return sendCliError(res, 409, 'agent-unavailable', `${panelType} is not installed or not compatible on this host`);
      }

      const input: ICreateWorkspaceTabInput = {
        workspaceId,
        paneId,
        name: typeof name === 'string' ? name : undefined,
        cwd,
        panelType,
      };
      const created = caller
        ? await withDelegationLock(workspaceId, async () => {
            if (await countDelegatedTabs(workspaceId) >= DELEGATION_TAB_LIMIT) return 'limit-reached' as const;
            return createWorkspaceTab({ ...input, activate: false, createdByTabId: caller.tab.id });
          })
        : await createWorkspaceTab(input);
      if (created === 'limit-reached') {
        return sendCliError(
          res,
          409,
          'delegation-limit',
          `This workspace already has ${DELEGATION_TAB_LIMIT} agent-created tabs. Close one before creating another.`,
        );
      }
      if (!created) return res.status(500).json({ error: 'Failed to create tab' });

      let ready = true;
      let launchError: string | undefined;
      if (isAgentPanelType(panelType)) {
        const launchStartedAt = Date.now();
        const launch = await launchAgentAfterShellReady({ workspaceId, paneId, tabId: created.id });
        if (launch.ok) {
          ready = await waitForAgentReady(created, { launchStartedAt });
        } else {
          ready = false;
          launchError = launch.code ?? 'launch-failed';
        }
      }

      return res.status(201).json({
        tabId: created.id,
        workspaceId,
        paneId,
        sessionName: created.sessionName,
        name: created.name,
        panelType: created.panelType ?? panelType,
        createdByTabId: created.createdByTabId ?? null,
        ready,
        ...(launchError ? { launchError } : {}),
      });
    } catch (err) {
      log.error(`create tab failed: ${err instanceof Error ? err.message : err}`);
      return sendCliServiceError(res, err);
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
};

export default handler;

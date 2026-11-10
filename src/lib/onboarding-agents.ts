import { AGENT_PANEL_TYPES } from '@/lib/panel-type';
import type { IAgentPreflightStatus } from '@/types/preflight';
import type { TAgentPanelType } from '@/types/terminal';

export type TAgentAction = 'install' | 'path' | 'login';

export interface IAgentNextAction {
  panelType: TAgentPanelType;
  action: TAgentAction;
}

type TAgentStatusMap = Partial<Record<TAgentPanelType, IAgentPreflightStatus>>;

const isInstalled = (status: IAgentPreflightStatus): boolean =>
  status.installed && status.compatible !== false;

const isReady = (status: IAgentPreflightStatus): boolean =>
  isInstalled(status) && status.loggedIn;

// Onboarding proceeds as soon as one agent is installed, compatible and logged in.
export const pickReadyAgents = (agents: TAgentStatusMap): TAgentPanelType[] =>
  AGENT_PANEL_TYPES.filter((panelType) => {
    const status = agents[panelType];
    return !!status && isReady(status);
  });

// Suggests the cheapest way to get a first agent working: finish a login, then
// fix a PATH, then install. Returns null once any agent is ready.
export const nextAgentAction = (agents: TAgentStatusMap): IAgentNextAction | null => {
  if (pickReadyAgents(agents).length > 0) return null;

  const find = (match: (status: IAgentPreflightStatus) => boolean): TAgentPanelType | null =>
    AGENT_PANEL_TYPES.find((panelType) => {
      const status = agents[panelType];
      return !!status && match(status);
    }) ?? null;

  const login = find((status) => isInstalled(status) && !status.loggedIn);
  if (login) return { panelType: login, action: 'login' };

  const path = find((status) => !status.installed && !!status.binaryPath);
  if (path) return { panelType: path, action: 'path' };

  const install = find(() => true) ?? AGENT_PANEL_TYPES[0];
  return { panelType: install, action: 'install' };
};

export type TAgentRowState = 'ready' | 'needsLogin' | 'pathMissing' | 'needsUpdate' | 'notInstalled';

// Per-row display state; also drives the row's own action (login / path / install).
export const readAgentRowState = (status: IAgentPreflightStatus | undefined): TAgentRowState => {
  if (!status) return 'notInstalled';
  if (isReady(status)) return 'ready';
  if (isInstalled(status)) return 'needsLogin';
  if (status.installed) return 'needsUpdate';
  return status.binaryPath ? 'pathMissing' : 'notInstalled';
};

export const readAgentRowAction = (state: TAgentRowState): TAgentAction | null => {
  if (state === 'ready') return null;
  if (state === 'needsLogin') return 'login';
  if (state === 'pathMissing') return 'path';
  return 'install';
};

// install-server command name for a row action: `codex`, `codex-path`, `claude-login`, ...
export const toInstallCommand = (panelType: TAgentPanelType, action: TAgentAction): string =>
  action === 'install' ? panelType : `${panelType}-${action}`;

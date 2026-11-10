import type { TAgentPanelType } from '@/types/terminal';

export interface IToolStatus {
  installed: boolean;
  version: string | null;
  compatible?: boolean;
  minimumVersion?: string;
  /** Directory of a binary found outside PATH, when the tool itself is not runnable. */
  binaryPath?: string | null;
}

export type TTerminalRuntimeAdapter = 'tmux' | 'windows';

export type TTerminalRuntimePreflightStatus = IToolStatus & {
  adapter: TTerminalRuntimeAdapter;
  compatible: boolean;
};

export type TAgentPreflightStatus = IToolStatus & {
  binaryPath: string | null;
  loggedIn: boolean;
};

export interface IPreflightResult {
  platform?: NodeJS.Platform;
  tmux: IToolStatus & { compatible: boolean };
  terminalRuntime?: TTerminalRuntimePreflightStatus;
  git: IToolStatus;
  agent: TAgentPreflightStatus;
  brew?: IToolStatus;
  clt?: { installed: boolean };
}

export interface IRuntimePreflightResult {
  platform?: NodeJS.Platform;
  tmux: IToolStatus & { compatible: boolean };
  terminalRuntime?: TTerminalRuntimePreflightStatus;
  git: IToolStatus;
  /** Codex status, kept for screens that predate multi-agent preflight. */
  agent: IToolStatus;
  /** Per-provider status keyed by agent id (equals the agent panel type). */
  agents: Partial<Record<TAgentPanelType, IToolStatus>>;
}

export const readRuntimeAgentStatus = (status: IRuntimePreflightResult): IToolStatus =>
  status.agent;

export const readRuntimeTerminalStatus = (status: IRuntimePreflightResult): TTerminalRuntimePreflightStatus =>
  status.terminalRuntime ?? { ...status.tmux, adapter: 'tmux' };

export const readRuntimeTerminalName = (status: IRuntimePreflightResult): string =>
  readRuntimeTerminalStatus(status).adapter === 'windows'
    ? 'Windows Terminal Runtime'
    : 'tmux';

export const readPreflightTerminalStatus = (status: IPreflightResult): TTerminalRuntimePreflightStatus =>
  status.terminalRuntime ?? { ...status.tmux, adapter: 'tmux' };

export const readPreflightTerminalName = (status: IPreflightResult): string =>
  readPreflightTerminalStatus(status).adapter === 'windows'
    ? 'Windows Terminal Runtime'
    : 'tmux';

export const isRuntimeOk = (status: IRuntimePreflightResult): boolean =>
  readRuntimeTerminalStatus(status).installed
  && readRuntimeTerminalStatus(status).compatible
  && status.git.installed
  && Object.values(status.agents).some((agent) => agent.installed && agent.compatible !== false);

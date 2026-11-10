import type { TCliState } from '@/types/timeline';

export type TConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'session-ended';

export type TDisconnectReason = 'max-connections' | 'pty-error' | 'runtime-v2-disabled' | 'session-not-found' | null;

export type TAgentPanelType = 'codex';
export type TPanelType = 'terminal' | TAgentPanelType | 'web-browser' | 'diff';
export type TRuntimeVersion = 1 | 2;

export interface ITab {
  id: string;
  sessionName: string;
  name: string;
  order: number;
  title?: string;
  cwd?: string;
  panelType?: TPanelType;
  agentSessionId?: string | null;
  agentJsonlPath?: string | null;
  agentSummary?: string | null;
  lastUserMessage?: string | null;
  lastUserMessageAt?: number | null;
  lastCommand?: string | null;
  cliState?: TCliState;
  dismissedAt?: number | null;
  webUrl?: string | null;
  terminalRatio?: number;
  terminalCollapsed?: boolean;
  runtimeVersion?: TRuntimeVersion;
}

export interface ISplitNode {
  type: 'split';
  orientation: 'horizontal' | 'vertical';
  ratio: number;
  children: [TLayoutNode, TLayoutNode];
}

export interface IPaneNode {
  type: 'pane';
  id: string;
  tabs: ITab[];
  activeTabId: string | null;
}

export type TLayoutNode = ISplitNode | IPaneNode;

export interface ILayoutData {
  root: TLayoutNode;
  activePaneId: string | null;
  updatedAt: string;
}

export interface IWorkspace {
  id: string;
  name: string;
  directories: string[];
  groupId?: string | null;
}

export interface IWorkspaceGroup {
  id: string;
  name: string;
  collapsed?: boolean;
}

export interface IWorkspacesData {
  workspaces: IWorkspace[];
  groups?: IWorkspaceGroup[];
  activeWorkspaceId?: string;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  updatedAt: string;
}

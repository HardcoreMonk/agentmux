import { getSessionIndexPage, getSessionIndexSnapshot, parseCodexSessionMeta } from '@/lib/session-index';
import { DEFAULT_AGENT_PANEL_TYPE } from '@/lib/panel-type';
import type { ISessionMeta } from '@/types/timeline';
import type { TPanelType } from '@/types/terminal';

export { parseCodexSessionMeta };

export interface IListSessionPageOptions {
  offset?: number;
  limit?: number;
}

export interface IListSessionPage {
  sessions: ISessionMeta[];
  total: number;
  hasMore: boolean;
  refreshing: boolean;
}

export const listSessions = async (
  tmuxSession: string,
  cwdHint?: string,
  panelType: TPanelType = DEFAULT_AGENT_PANEL_TYPE,
): Promise<ISessionMeta[]> => {
  void tmuxSession;
  void cwdHint;

  // The session index only reads Codex rollouts; other agents get their own list later.
  if (panelType !== 'codex') return [];
  return getSessionIndexSnapshot({ waitForInitial: true });
};

export const listSessionPage = async (
  tmuxSession: string,
  cwdHint?: string,
  panelType: TPanelType = DEFAULT_AGENT_PANEL_TYPE,
  options?: IListSessionPageOptions,
): Promise<IListSessionPage> => {
  void tmuxSession;
  void cwdHint;

  if (panelType !== 'codex') {
    return { sessions: [], total: 0, hasMore: false, refreshing: false };
  }

  return getSessionIndexPage({
    waitForInitial: false,
    offset: options?.offset,
    limit: options?.limit,
  });
};

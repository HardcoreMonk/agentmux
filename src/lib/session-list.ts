import { getSessionIndexPage, getSessionIndexSnapshot, parseCodexSessionMeta } from '@/lib/session-index';
import { AGENT_PANEL_TYPES, DEFAULT_AGENT_PANEL_TYPE } from '@/lib/panel-type';
import { listClaudeSessionsForCwd } from '@/lib/providers/claude/session-list';
import { getSessionCwd } from '@/lib/tmux';
import type { ISessionMeta } from '@/types/timeline';
import type { TAgentPanelType, TPanelType } from '@/types/terminal';

export { parseCodexSessionMeta };

export interface IListSessionPageOptions {
  offset?: number;
  limit?: number;
  providers?: readonly TAgentPanelType[];
}

export interface IListSessionPage {
  sessions: ISessionMeta[];
  total: number;
  hasMore: boolean;
  refreshing: boolean;
}

const DEFAULT_PROVIDERS: readonly TAgentPanelType[] = AGENT_PANEL_TYPES;

const resolveClaudeCwd = async (tmuxSession: string, cwdHint?: string): Promise<string | null> => {
  if (cwdHint) return cwdHint;
  try {
    return await getSessionCwd(tmuxSession);
  } catch {
    return null;
  }
};

const listClaudeSessions = async (tmuxSession: string, cwdHint?: string): Promise<ISessionMeta[]> => {
  const cwd = await resolveClaudeCwd(tmuxSession, cwdHint);
  return cwd ? listClaudeSessionsForCwd(cwd) : [];
};

const withCodexProvider = (sessions: ISessionMeta[]): ISessionMeta[] =>
  sessions.map((session) => ({ ...session, providerId: 'codex' }));

const mergeByActivity = (codex: ISessionMeta[], claude: ISessionMeta[]): ISessionMeta[] =>
  claude.length === 0
    ? codex
    : [...codex, ...claude].sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));

export const listSessions = async (
  tmuxSession: string,
  cwdHint?: string,
  panelType: TPanelType = DEFAULT_AGENT_PANEL_TYPE,
  providers: readonly TAgentPanelType[] = DEFAULT_PROVIDERS,
): Promise<ISessionMeta[]> => {
  void panelType;
  const [codex, claude] = await Promise.all([
    providers.includes('codex')
      ? getSessionIndexSnapshot({ waitForInitial: true }).then(withCodexProvider)
      : Promise.resolve([]),
    providers.includes('claude') ? listClaudeSessions(tmuxSession, cwdHint) : Promise.resolve([]),
  ]);
  return mergeByActivity(codex, claude);
};

export const listSessionPage = async (
  tmuxSession: string,
  cwdHint?: string,
  panelType: TPanelType = DEFAULT_AGENT_PANEL_TYPE,
  options?: IListSessionPageOptions,
): Promise<IListSessionPage> => {
  void panelType;
  const providers = options?.providers ?? DEFAULT_PROVIDERS;
  const [codexPage, claude] = await Promise.all([
    providers.includes('codex')
      ? getSessionIndexPage({ waitForInitial: false })
      : Promise.resolve(null),
    providers.includes('claude') ? listClaudeSessions(tmuxSession, cwdHint) : Promise.resolve([]),
  ]);

  const merged = mergeByActivity(withCodexProvider(codexPage?.sessions ?? []), claude);
  const offset = Math.max(0, Math.floor(options?.offset ?? 0));
  const end = typeof options?.limit === 'number'
    ? offset + Math.max(0, Math.floor(options.limit))
    : merged.length;

  return {
    sessions: merged.slice(offset, end),
    total: merged.length,
    hasMore: end < merged.length,
    refreshing: codexPage?.refreshing ?? false,
  };
};

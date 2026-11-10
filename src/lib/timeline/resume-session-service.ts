import type { WebSocket } from 'ws';

import type { IAgentJsonlResolution, IAgentPromptClaim, IAgentProvider } from '@/lib/providers';
import type { TTimelineServerMessage } from '@/types/timeline';

type TSessionChangedReason = 'session-waiting' | 'new-session-started' | 'session-ended' | string;

interface ICheckTerminalProcessResult {
  isSafe: boolean;
  processName?: string;
}

interface ITimelineResumeConnection {
  sessionName: string;
  provider: IAgentProvider;
}

interface ICreateTimelineResumeSessionServiceOptions {
  send: (ws: WebSocket, message: TTimelineServerMessage) => boolean;
  checkTerminalProcess: (tmuxSession: string) => Promise<ICheckTerminalProcessResult>;
  sendKeys: (tmuxSession: string, keys: string) => Promise<void>;
  parseSessionName: (sessionName: string) => { wsId?: string; tabId?: string } | null;
  updateTabAgentSessionId: (
    sessionName: string,
    provider: IAgentProvider,
    sessionId: string,
  ) => Promise<void>;
  readTabAgentJsonlPath: (sessionName: string, provider: IAgentProvider) => Promise<string | null>;
  readTabUserMessageClaim: (sessionName: string) => Promise<IAgentPromptClaim | null>;
  getSessionCwd: (sessionName: string) => Promise<string | null>;
  isAllowedJsonlPath: (jsonlPath: string) => boolean;
  existsPath: (jsonlPath: string) => boolean;
  statFileMtimeMs: (filePath: string) => Promise<number | null>;
  extractSessionIdFromJsonlPath: (jsonlPath: string) => string | null;
}

export const createTimelineResumeSessionService = (options: ICreateTimelineResumeSessionServiceOptions) => {
  const resolveJsonlPath = async (
    provider: IAgentProvider,
    tmuxSession: string,
    sessionId: string,
  ): Promise<string | null> => {
    const cwd = await options.getSessionCwd(tmuxSession);
    if (!cwd) return null;
    const jsonlPath = await provider.resolveJsonlPath(sessionId, cwd);
    if (!jsonlPath) return null;
    return options.existsPath(jsonlPath) ? jsonlPath : null;
  };

  const resolveCachedJsonlPath = async (
    sessionName: string,
    provider: IAgentProvider,
  ): Promise<string | null> => {
    const cached = await options.readTabAgentJsonlPath(sessionName, provider);
    if (!cached || !options.isAllowedJsonlPath(cached) || !options.existsPath(cached)) return null;
    return cached;
  };

  const resolveLatestCwdJsonl = async (
    provider: IAgentProvider,
    sessionName: string,
    currentJsonlPath: string | null,
  ): Promise<IAgentJsonlResolution | null> => {
    if (!provider.resolveLatestJsonlPath) return null;

    const cwd = await options.getSessionCwd(sessionName);
    if (!cwd) return null;

    const latest = await provider.resolveLatestJsonlPath(cwd);
    if (!latest || !options.isAllowedJsonlPath(latest.jsonlPath) || !options.existsPath(latest.jsonlPath)) {
      return null;
    }
    if (latest.jsonlPath === currentJsonlPath) return null;

    const currentMtimeMs = currentJsonlPath ? await options.statFileMtimeMs(currentJsonlPath) : null;
    if (
      currentMtimeMs !== null
      && latest.mtimeMs !== undefined
      && latest.mtimeMs <= currentMtimeMs
    ) {
      return null;
    }

    return latest;
  };

  const shouldPreferLatestCwdJsonl = async (
    provider: IAgentProvider,
    currentJsonlPath: string,
  ): Promise<boolean> => {
    if (!provider.statusBehavior.reconcileStateFromJsonl) return false;
    try {
      const state = await provider.readJsonlStatus(currentJsonlPath);
      return !!state.interrupted;
    } catch {
      return false;
    }
  };

  const resolveOwnedLatestJsonl = async (
    provider: IAgentProvider,
    sessionName: string,
    currentJsonlPath: string | null,
  ): Promise<IAgentJsonlResolution | null> => {
    if (!provider.resolveJsonlPathForClaim) return null;

    const claim = await options.readTabUserMessageClaim(sessionName);
    if (!claim) return null;

    const cwd = await options.getSessionCwd(sessionName);
    if (!cwd) return null;

    const owned = await provider.resolveJsonlPathForClaim(cwd, claim);
    if (!owned || !options.isAllowedJsonlPath(owned.jsonlPath) || !options.existsPath(owned.jsonlPath)) {
      return null;
    }
    if (owned.jsonlPath === currentJsonlPath) return null;

    const currentMtimeMs = currentJsonlPath ? await options.statFileMtimeMs(currentJsonlPath) : null;
    if (
      currentMtimeMs !== null
      && owned.mtimeMs !== undefined
      && owned.mtimeMs <= currentMtimeMs
    ) {
      return null;
    }

    return owned;
  };

  const resolveActiveOrLatestJsonl = async (
    provider: IAgentProvider,
    sessionName: string,
    activeJsonlPath: string,
    activeSessionId?: string | null,
  ): Promise<IAgentJsonlResolution> => {
    const owned = await resolveOwnedLatestJsonl(provider, sessionName, activeJsonlPath);
    if (owned) return owned;

    const latest = await resolveLatestCwdJsonl(provider, sessionName, activeJsonlPath);
    if (latest && await shouldPreferLatestCwdJsonl(provider, activeJsonlPath)) {
      return latest;
    }

    return {
      jsonlPath: activeJsonlPath,
      sessionId: activeSessionId ?? options.extractSessionIdFromJsonlPath(activeJsonlPath) ?? '',
      mtimeMs: await options.statFileMtimeMs(activeJsonlPath) ?? undefined,
    };
  };

  const resolveStoredOrLatestJsonl = async (
    provider: IAgentProvider,
    sessionName: string,
    sessionId: string,
  ): Promise<IAgentJsonlResolution | null> => {
    const cachedPath = await resolveCachedJsonlPath(sessionName, provider);
    const resolvedPath = cachedPath ?? await resolveJsonlPath(provider, sessionName, sessionId);
    const owned = await resolveOwnedLatestJsonl(provider, sessionName, resolvedPath);
    if (owned) return owned;

    const latest = await resolveLatestCwdJsonl(provider, sessionName, resolvedPath);
    if (latest && resolvedPath && await shouldPreferLatestCwdJsonl(provider, resolvedPath)) return latest;
    if (!resolvedPath) return null;

    return {
      jsonlPath: resolvedPath,
      sessionId: options.extractSessionIdFromJsonlPath(resolvedPath) ?? sessionId,
      mtimeMs: await options.statFileMtimeMs(resolvedPath) ?? undefined,
    };
  };

  const resolveResumeMessage = async (
    ws: WebSocket,
    conn: ITimelineResumeConnection,
    payload: { sessionId: string; tmuxSession: string },
  ): Promise<{ jsonlPath: string; sessionId: string } | null | undefined> => {
    const { sessionId, tmuxSession } = payload;

    try {
      const { isSafe, processName } = await options.checkTerminalProcess(tmuxSession);

      if (!isSafe) {
        options.send(ws, {
          type: 'timeline:resume-blocked',
          reason: 'process-running',
          processName,
        });
        return undefined;
      }

      const parsed = options.parseSessionName(tmuxSession);
      const resumeCmd = await conn.provider.buildResumeCommand(sessionId, {
        workspaceId: parsed?.wsId,
        tabId: parsed?.tabId,
        sessionName: tmuxSession,
      });
      await options.sendKeys(tmuxSession, resumeCmd);

      await options.updateTabAgentSessionId(conn.sessionName, conn.provider, sessionId);

      const jsonlPath = await resolveJsonlPath(conn.provider, tmuxSession, sessionId);

      options.send(ws, {
        type: 'timeline:resume-started',
        sessionId,
        jsonlPath,
      });

      return jsonlPath ? { jsonlPath, sessionId } : null;
    } catch (err) {
      options.send(ws, {
        type: 'timeline:resume-error',
        message: err instanceof Error ? err.message : 'Error during resume',
      });
      return undefined;
    }
  };

  const sendSessionChanged = (
    ws: WebSocket,
    newSessionId: string,
    reason: TSessionChangedReason,
  ): boolean => options.send(ws, {
    type: 'timeline:session-changed',
    newSessionId,
    reason,
  });

  return {
    resolveJsonlPath,
    resolveLatestCwdJsonl,
    resolveOwnedLatestJsonl,
    resolveActiveOrLatestJsonl,
    resolveStoredOrLatestJsonl,
    resolveResumeMessage,
    sendSessionChanged,
  };
};

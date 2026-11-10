import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import { existsSync } from 'fs';
import { stat as fsStat } from 'fs/promises';
import { getSessionPanePid, checkTerminalProcess, sendKeys, getSessionCwd } from './tmux';
import {
  readTabAgentJsonlPath,
  updateTabAgentSessionId,
  updateTabAgentJsonlPath,
  updateTabAgentSummary,
  updateTabLastUserMessage,
  readTabUserMessageClaim,
  parseSessionName,
} from './layout-store';
import { getStatusManager } from './status-manager';
import { DEFAULT_AGENT_PANEL_TYPE } from '@/lib/panel-type';
import { getProviderByPanelType, isAllowedAgentJsonlPath } from '@/lib/providers';
import type { IAgentProvider } from '@/lib/providers';
import { extractSessionIdFromJsonlPath, readSessionStats } from './session-stats';
import type { ISessionStats } from '@/types/timeline';
import path from 'path';
import { createLogger } from '@/lib/logger';
import {
  canSendTimelineMessage as canSend,
  fileWatchers,
  type ITimelineConnection,
  sessionWatchers,
  subscribeTimelineSessionClaimRefresh,
  timelineConnections as connections,
} from '@/lib/timeline-server-state';
import {
  recordRuntimeTimelineLiveShadowAppend,
  startRuntimeTimelineLiveShadow,
  stopRuntimeTimelineLiveShadow,
} from '@/lib/runtime/timeline-live-shadow';
import { shouldUseRuntimeTimelineV2Live } from '@/lib/runtime/timeline-mode';
import { handleRuntimeTimelineConnection } from '@/lib/runtime/timeline-ws';
import { getRuntimeStatusV2Mode } from '@/lib/runtime/status-mode';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';
import { findLastTimelineUserMessage } from '@/lib/timeline/init-metadata';
import {
  DEFAULT_TIMELINE_INIT_ENTRY_LIMIT,
  readTimelineTailSnapshot,
} from '@/lib/timeline/file-read-service';
import {
  buildEmptyTimelineInitMessage,
  buildTimelineInitMessage,
} from '@/lib/timeline/init-message';
import { createTimelineFileWatcherService } from '@/lib/timeline/file-watcher-service';
import { createTimelineSubscriptionDelivery } from '@/lib/timeline/subscription-delivery';
import { createTimelineResumeSessionService } from '@/lib/timeline/resume-session-service';
import { findSessionRelationshipByJsonlPath } from '@/lib/session-index';

const log = createLogger('timeline');

const HEARTBEAT_INTERVAL = 30_000;
const HEARTBEAT_TIMEOUT = 90_000;
const DEBOUNCE_MS = 50;
const MAX_WATCHERS = 32;
const MAX_CONNECTIONS = 32;
const MAX_WATCHER_RETRIES = 3;
const runtimeConnections = new Set<WebSocket>();

const shouldUseRuntimeStatusLive = (): boolean =>
  process.env.AGENTMUX_RUNTIME_V2 === '1' && getRuntimeStatusV2Mode() === 'default';

const notifyStatusLastUserMessage = (sessionName: string, message: string): void => {
  if (shouldUseRuntimeStatusLive()) {
    getRuntimeSupervisor().notifyStatusLiveLastUserMessage({ sessionName, message }).catch((err) => {
      log.warn('runtime status last user message notify failed: %s', err instanceof Error ? err.message : String(err));
    });
    return;
  }
  getStatusManager().notifyLastUserMessage(sessionName, message);
};

const resolveAgentSummary = async (
  _provider: IAgentProvider,
  _sessionName: string,
  jsonlSummary: string | null | undefined,
): Promise<string | null> => {
  return jsonlSummary ?? null;
};

const timelineDelivery = createTimelineSubscriptionDelivery({
  fileWatchers,
  canSend,
  getSessionIdFromJsonlPath: extractSessionIdFromJsonlPath,
});

const timelineFileWatcherService = createTimelineFileWatcherService({
  debounceMs: DEBOUNCE_MS,
  maxWatcherRetries: MAX_WATCHER_RETRIES,
  fileWatchers,
  canSend,
  broadcastWatcher: timelineDelivery.broadcastWatcher,
  onLiveShadowAppend: recordRuntimeTimelineLiveShadowAppend,
  stopLiveShadow: (jsonlPath) => stopRuntimeTimelineLiveShadow({ jsonlPath }),
  onLastUserMessage: async (sessionName, message) => {
    await updateTabLastUserMessage(sessionName, message).catch(() => {});
    notifyStatusLastUserMessage(sessionName, message);
  },
  resolveAgentSummary,
  onAgentSummary: async (sessionName, provider, summary) => {
    await updateTabAgentSummary(sessionName, provider, summary).catch(() => {});
  },
});

const timelineResumeSessionService = createTimelineResumeSessionService({
  send: timelineDelivery.send,
  checkTerminalProcess,
  sendKeys,
  parseSessionName,
  updateTabAgentSessionId: async (sessionName, provider, sessionId) => {
    await updateTabAgentSessionId(sessionName, provider, sessionId).catch(() => {});
  },
  readTabAgentJsonlPath,
  readTabUserMessageClaim,
  getSessionCwd,
  isAllowedJsonlPath: (jsonlPath) => isAllowedAgentJsonlPath(jsonlPath),
  existsPath: existsSync,
  statFileMtimeMs: async (filePath) => {
    try {
      return (await fsStat(filePath)).mtimeMs;
    } catch {
      return null;
    }
  },
  extractSessionIdFromJsonlPath,
});

export const broadcastSessionStats = (stats: ISessionStats) => {
  timelineDelivery.broadcastSessionStats(stats);
};

const sendEmptyInit = (ws: WebSocket, sessionId = '', isAgentStarting = false) => {
  timelineDelivery.send(ws, buildEmptyTimelineInitMessage({ sessionId, isAgentStarting }));
};

const subscribeAndUpdateSummary = async (
  ws: WebSocket,
  jsonlPath: string,
  sessionId: string | undefined,
  sessionName: string,
  provider: IAgentProvider,
) => {
  await updateTabAgentJsonlPath(sessionName, provider, jsonlPath).catch(() => {});
  const jsonlSummary = await subscribeToFile(ws, jsonlPath, sessionId, sessionName, provider);
  const summary = await resolveAgentSummary(provider, sessionName, jsonlSummary);
  await updateTabAgentSummary(sessionName, provider, summary).catch(() => {});
};

const subscribeToFile = async (
  ws: WebSocket,
  jsonlPath: string,
  sessionId: string | undefined,
  sessionName: string,
  provider: IAgentProvider,
): Promise<string | undefined> => {
  if (!existsSync(jsonlPath)) {
    const initMessage = buildEmptyTimelineInitMessage({ sessionId: sessionId ?? '', jsonlPath });
    timelineDelivery.send(ws, initMessage);
    void startRuntimeTimelineLiveShadow({
      jsonlPath,
      sessionName,
      sessionId,
      panelType: provider.panelType,
      expectedInit: initMessage,
    });
    return undefined;
  }

  let fw = fileWatchers.get(jsonlPath);
  const isNewWatcher = !fw;

  if (!fw) {
    if (fileWatchers.size >= MAX_WATCHERS) {
      timelineDelivery.send(ws, { type: 'timeline:error', code: 'max-watchers', message: 'Too many active watchers' });
      return;
    }
    fw = {
      watcher: null,
      jsonlPath,
      offset: 0,
      pendingBuffer: '',
      connections: new Set(),
      debounceTimer: null,
      retryCount: 0,
      sessionName,
      provider,
      summaryResolved: false,
      processing: false,
      pendingChange: false,
      initOffsets: new Map(),
    };
    fileWatchers.set(jsonlPath, fw);
  }

  fw.connections.add(ws);

  const snapshot = await readTimelineTailSnapshot({
    store: fw,
    jsonlPath,
    provider,
    maxEntries: DEFAULT_TIMELINE_INIT_ENTRY_LIMIT,
  });
  const result = snapshot.result;

  if (result.errorCount > 0) {
    timelineDelivery.send(ws, {
      type: 'timeline:error',
      code: 'parse-error',
      message: `JSONL parsing: ${result.errorCount} errors (lines skipped)`,
    });
  }

  if (isNewWatcher) {
    fw.offset = result.fileSize;
    timelineFileWatcherService.startFileWatch(fw);
  }

  const resolvedSessionId = sessionId ?? extractSessionIdFromJsonlPath(jsonlPath) ?? '';
  const sessionStats = resolvedSessionId ? await readSessionStats(resolvedSessionId) : null;
  const relationship = await findSessionRelationshipByJsonlPath(jsonlPath).catch(() => null);

  const initMessage = buildTimelineInitMessage({
    result,
    sessionId: resolvedSessionId,
    jsonlPath,
    firstTimestamp: snapshot.firstTimestamp,
    sessionStats,
    relationship,
  });
  timelineDelivery.send(ws, initMessage);
  void startRuntimeTimelineLiveShadow({
    jsonlPath,
    sessionName,
    sessionId: resolvedSessionId,
    panelType: provider.panelType,
    expectedInit: initMessage,
  });

  if (!isNewWatcher) {
    fw.initOffsets.set(ws, result.fileSize);
  }

  if (sessionName) {
    const lastMsg = findLastTimelineUserMessage(result.entries);
    if (lastMsg) {
      await updateTabLastUserMessage(sessionName, lastMsg).catch(() => {});
      notifyStatusLastUserMessage(sessionName, lastMsg);
    }
  }

  return result.summary;
};

const unsubscribeFromFile = (ws: WebSocket, jsonlPath: string) => {
  const fw = fileWatchers.get(jsonlPath);
  if (!fw) return;
  fw.connections.delete(ws);
  fw.initOffsets.delete(ws);
  if (fw.connections.size === 0) {
    timelineFileWatcherService.removeFileWatcher(jsonlPath);
  }
};

const getSessionConnections = (sessionName: string): ITimelineConnection[] => {
  const result: ITimelineConnection[] = [];
  for (const [, conn] of connections) {
    if (conn.sessionName === sessionName) {
      result.push(conn);
    }
  }
  return result;
};

const CLAIM_REFRESH_DELAYS_MS = [0, 250, 750, 1500, 3000, 5000];
const claimRefreshInFlight = new WeakSet<WebSocket>();

const refreshConnectionForOwnedClaim = async (conn: ITimelineConnection): Promise<boolean> => {
  if (conn.cleaned || claimRefreshInFlight.has(conn.ws)) return false;
  claimRefreshInFlight.add(conn.ws);
  try {
    const owned = await timelineResumeSessionService.resolveOwnedLatestJsonl(
      conn.provider,
      conn.sessionName,
      conn.currentJsonlPath,
    );
    if (!owned || conn.cleaned) return false;

    if (conn.currentJsonlPath) {
      unsubscribeFromFile(conn.ws, conn.currentJsonlPath);
    }
    conn.currentJsonlPath = owned.jsonlPath;
    await updateTabAgentSessionId(conn.sessionName, conn.provider, owned.sessionId).catch(() => {});
    timelineResumeSessionService.sendSessionChanged(conn.ws, owned.sessionId, 'new-session-started');
    await subscribeAndUpdateSummary(conn.ws, owned.jsonlPath, owned.sessionId, conn.sessionName, conn.provider);
    return true;
  } finally {
    claimRefreshInFlight.delete(conn.ws);
  }
};

const refreshSessionForOwnedClaim = async (sessionName: string): Promise<void> => {
  await Promise.all(getSessionConnections(sessionName).map(refreshConnectionForOwnedClaim));
};

subscribeTimelineSessionClaimRefresh((sessionName) => {
  for (const delayMs of CLAIM_REFRESH_DELAYS_MS) {
    const timer = setTimeout(() => {
      refreshSessionForOwnedClaim(sessionName).catch((err) => {
        log.warn('timeline claim refresh failed: %s', err instanceof Error ? err.message : String(err));
      });
    }, delayMs);
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  }
});

const cleanup = (conn: ITimelineConnection) => {
  if (conn.cleaned) return;
  conn.cleaned = true;

  clearInterval(conn.heartbeatTimer);
  connections.delete(conn.ws);

  if (conn.currentJsonlPath) {
    unsubscribeFromFile(conn.ws, conn.currentJsonlPath);
  }

  const wsKey = conn.sessionName;
  const hasOtherConn = getSessionConnections(conn.sessionName).length > 0;
  if (!hasOtherConn) {
    const sw = sessionWatchers.get(wsKey);
    if (sw) {
      sw.stop();
      sessionWatchers.delete(wsKey);
    }
  }
};

const handleResumeMessage = async (
  ws: WebSocket,
  conn: ITimelineConnection,
  payload: { sessionId: string; tmuxSession: string },
) => {
  const resolved = await timelineResumeSessionService.resolveResumeMessage(ws, conn, payload);

  if (resolved) {
    if (conn.currentJsonlPath) {
      unsubscribeFromFile(ws, conn.currentJsonlPath);
    }
    conn.currentJsonlPath = resolved.jsonlPath;
    await subscribeAndUpdateSummary(ws, resolved.jsonlPath, resolved.sessionId, conn.sessionName, conn.provider);
  } else if (resolved === null) {
    sendEmptyInit(ws, payload.sessionId);
  }
};

export const handleTimelineConnection = async (ws: WebSocket, request: IncomingMessage) => {
  if (connections.size + runtimeConnections.size >= MAX_CONNECTIONS) {
    ws.close(1013, 'Too many connections');
    return;
  }

  const url = new URL(request.url || '', 'http://localhost');
  const sessionName = url.searchParams.get('session') ?? '';

  if (!sessionName) {
    ws.close(1008, 'Missing session parameter');
    return;
  }

  const panelType = url.searchParams.get('panelType') ?? DEFAULT_AGENT_PANEL_TYPE;
  const provider = getProviderByPanelType(panelType);
  if (!provider) {
    ws.close(1008, 'Unknown panel type');
    return;
  }

  const panePid = await getSessionPanePid(sessionName);
  if (!panePid) {
    sendEmptyInit(ws);
    ws.close(1000, 'Cannot resolve pane pid');
    return;
  }

  const hintSessionId = url.searchParams.get('agentSessionId');

  if (shouldUseRuntimeTimelineV2Live()) {
    const resumeConn: Pick<ITimelineConnection, 'sessionName' | 'provider'> = {
      sessionName,
      provider,
    };
    runtimeConnections.add(ws);

    const cleanupRuntimeConnection = () => {
      runtimeConnections.delete(ws);
    };
    ws.on('close', cleanupRuntimeConnection);
    ws.on('error', cleanupRuntimeConnection);

    await handleRuntimeTimelineConnection(ws, {
      sessionName,
      panePid,
      panelType,
      provider,
      resolveInitialJsonl: async (info) => {
        if (info.jsonlPath) {
          const resolved = await timelineResumeSessionService.resolveActiveOrLatestJsonl(provider, sessionName, info.jsonlPath, info.sessionId);
          return {
            jsonlPath: resolved.jsonlPath,
            sessionId: resolved.sessionId,
          };
        }

        const effectiveSessionId = info.sessionId ?? hintSessionId;
        if (!effectiveSessionId) {
          const owned = await timelineResumeSessionService.resolveOwnedLatestJsonl(provider, sessionName, null);
          return owned
            ? {
                jsonlPath: owned.jsonlPath,
                sessionId: owned.sessionId,
              }
            : null;
        }

        const resolved = await timelineResumeSessionService.resolveStoredOrLatestJsonl(provider, sessionName, effectiveSessionId);
        if (!resolved) return null;

        return {
          jsonlPath: resolved.jsonlPath,
          sessionId: resolved.sessionId,
        };
      },
      handleResume: async (payload) => {
        if (!provider.isValidSessionId(payload.sessionId)) {
          timelineDelivery.send(ws, { type: 'timeline:resume-error', message: 'Invalid session ID format' });
          return;
        }
        return timelineResumeSessionService.resolveResumeMessage(ws, resumeConn, payload);
      },
      resolveClaimedJsonl: async (currentJsonlPath) => {
        const owned = await timelineResumeSessionService.resolveOwnedLatestJsonl(provider, sessionName, currentJsonlPath);
        return owned
          ? {
              jsonlPath: owned.jsonlPath,
              sessionId: owned.sessionId,
            }
          : null;
      },
      updateTabAgentSessionId: async (sessionId) => {
        await updateTabAgentSessionId(sessionName, provider, sessionId).catch(() => {});
      },
    });
    return;
  }

  let lastHeartbeat = Date.now();

  const heartbeatTimer = setInterval(() => {
    if (Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT) {
      ws.close(1001, 'Heartbeat timeout');
      return;
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL);

  const conn: ITimelineConnection = {
    ws,
    sessionName,
    panePid,
    provider,
    heartbeatTimer,
    lastHeartbeat,
    currentJsonlPath: null,
    cleaned: false,
  };

  connections.set(ws, conn);

  ws.on('pong', () => {
    lastHeartbeat = Date.now();
    conn.lastHeartbeat = lastHeartbeat;
  });

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'timeline:subscribe' && msg.jsonlPath) {
        if (!isAllowedAgentJsonlPath(msg.jsonlPath)) {
          timelineDelivery.send(ws, { type: 'timeline:error', code: 'forbidden-path', message: 'Not allowed path' });
          return;
        }
        if (conn.currentJsonlPath) {
          unsubscribeFromFile(ws, conn.currentJsonlPath);
        }
        conn.currentJsonlPath = msg.jsonlPath;
        await subscribeToFile(ws, msg.jsonlPath, undefined, conn.sessionName, conn.provider);
      } else if (msg.type === 'timeline:unsubscribe') {
        if (conn.currentJsonlPath) {
          unsubscribeFromFile(ws, conn.currentJsonlPath);
          conn.currentJsonlPath = null;
        }
      } else if (msg.type === 'timeline:resume' && msg.sessionId && msg.tmuxSession) {
        if (!conn.provider.isValidSessionId(msg.sessionId)) {
          timelineDelivery.send(ws, { type: 'timeline:resume-error', message: 'Invalid session ID format' });
        } else {
          await handleResumeMessage(ws, conn, {
            sessionId: msg.sessionId,
            tmuxSession: msg.tmuxSession,
          });
        }
      }
    } catch (err) {
      log.error(`message handler error: ${err instanceof Error ? err.message : err}`);
    }
  });

  ws.on('close', () => cleanup(conn));
  ws.on('error', (err) => {
    log.error(`websocket error: ${err.message}`);
    cleanup(conn);
  });

  const sessionInfo = await provider.detectActiveSession(panePid);

  if (conn.cleaned) return;

  if (sessionInfo.status === 'not-installed') {
    timelineDelivery.send(ws, { type: 'timeline:error', code: 'not-installed', message: `${provider.displayName} is not installed` });
    sendEmptyInit(ws);
    return;
  }

  // Check if agent process is running in pane before PID file is created
  const isAgentStarting = sessionInfo.status === 'not-running'
    && !hintSessionId
    && await provider.isAgentRunning(panePid);

  if (sessionInfo.status === 'running' && sessionInfo.sessionId) {
    timelineResumeSessionService.sendSessionChanged(ws, sessionInfo.sessionId, 'session-waiting');
  } else if (isAgentStarting) {
    timelineResumeSessionService.sendSessionChanged(ws, '', 'session-waiting');
  }

  const effectiveSessionId = sessionInfo.sessionId ?? hintSessionId;

  if (sessionInfo.jsonlPath) {
    const resolved = await timelineResumeSessionService.resolveActiveOrLatestJsonl(provider, sessionName, sessionInfo.jsonlPath, sessionInfo.sessionId);
    const switchedToLatest = resolved.jsonlPath !== sessionInfo.jsonlPath;
    conn.currentJsonlPath = resolved.jsonlPath;
    if (resolved.sessionId) {
      await updateTabAgentSessionId(conn.sessionName, provider, resolved.sessionId).catch(() => {});
    }
    if (switchedToLatest) {
      timelineResumeSessionService.sendSessionChanged(ws, resolved.sessionId, 'new-session-started');
    }
    await subscribeAndUpdateSummary(ws, resolved.jsonlPath, resolved.sessionId, conn.sessionName, provider);
  } else if (effectiveSessionId) {
    if (sessionInfo.sessionId) {
      await updateTabAgentSessionId(conn.sessionName, provider, sessionInfo.sessionId).catch(() => {});
    }
    const resolved = await timelineResumeSessionService.resolveStoredOrLatestJsonl(provider, sessionName, effectiveSessionId);
    if (resolved) {
      conn.currentJsonlPath = resolved.jsonlPath;
      await updateTabAgentSessionId(conn.sessionName, provider, resolved.sessionId).catch(() => {});
      await subscribeAndUpdateSummary(ws, resolved.jsonlPath, resolved.sessionId, conn.sessionName, provider);
    } else {
      sendEmptyInit(ws, effectiveSessionId);
    }
  } else if (!isAgentStarting) {
    const owned = await timelineResumeSessionService.resolveOwnedLatestJsonl(provider, sessionName, null);
    if (owned) {
      conn.currentJsonlPath = owned.jsonlPath;
      await updateTabAgentSessionId(conn.sessionName, provider, owned.sessionId).catch(() => {});
      timelineResumeSessionService.sendSessionChanged(ws, owned.sessionId, 'new-session-started');
      await subscribeAndUpdateSummary(ws, owned.jsonlPath, owned.sessionId, conn.sessionName, provider);
    } else {
      sendEmptyInit(ws);
    }
  }

  if (conn.cleaned) return;

  // Watch for new sessions — shared per session key
  const wsKey = sessionName;
  if (!sessionWatchers.has(wsKey)) {
    const sw = provider.watchSessions(panePid, async (newInfo) => {
      const wsConns = getSessionConnections(sessionName);
      for (const c of wsConns) {
        if (newInfo.jsonlPath && newInfo.jsonlPath !== c.currentJsonlPath) {
          const resolved = await timelineResumeSessionService.resolveActiveOrLatestJsonl(provider, sessionName, newInfo.jsonlPath, newInfo.sessionId);
          if (c.currentJsonlPath) {
            unsubscribeFromFile(c.ws, c.currentJsonlPath);
          }
          c.currentJsonlPath = resolved.jsonlPath;

          if (resolved.sessionId) {
            await updateTabAgentSessionId(sessionName, provider, resolved.sessionId).catch(() => {});
          }

          timelineResumeSessionService.sendSessionChanged(c.ws, resolved.sessionId, 'new-session-started');

          await subscribeAndUpdateSummary(c.ws, resolved.jsonlPath, resolved.sessionId, sessionName, provider);
        } else if (!newInfo.jsonlPath && newInfo.status === 'not-running') {
          const owned = await timelineResumeSessionService.resolveOwnedLatestJsonl(provider, sessionName, c.currentJsonlPath);
          if (owned) {
            if (c.currentJsonlPath) {
              unsubscribeFromFile(c.ws, c.currentJsonlPath);
            }
            c.currentJsonlPath = owned.jsonlPath;

            await updateTabAgentSessionId(sessionName, provider, owned.sessionId).catch(() => {});
            timelineResumeSessionService.sendSessionChanged(c.ws, owned.sessionId, 'new-session-started');
            await subscribeAndUpdateSummary(c.ws, owned.jsonlPath, owned.sessionId, sessionName, provider);
            continue;
          }

          if (c.currentJsonlPath) {
            unsubscribeFromFile(c.ws, c.currentJsonlPath);
            c.currentJsonlPath = null;
          }
          timelineResumeSessionService.sendSessionChanged(c.ws, '', 'session-ended');
        }
      }

      if (newInfo.status === 'running' && !newInfo.jsonlPath) {
        if (newInfo.sessionId) {
          await updateTabAgentSessionId(sessionName, provider, newInfo.sessionId).catch(() => {});
        }
        for (const c of wsConns) {
          const owned = await timelineResumeSessionService.resolveOwnedLatestJsonl(provider, sessionName, c.currentJsonlPath);
          if (owned) {
            if (c.currentJsonlPath) {
              unsubscribeFromFile(c.ws, c.currentJsonlPath);
            }
            c.currentJsonlPath = owned.jsonlPath;
            await updateTabAgentSessionId(sessionName, provider, owned.sessionId).catch(() => {});
            timelineResumeSessionService.sendSessionChanged(c.ws, owned.sessionId, 'new-session-started');
            await subscribeAndUpdateSummary(c.ws, owned.jsonlPath, owned.sessionId, sessionName, provider);
            continue;
          }

          if (c.currentJsonlPath) {
            const currentFile = path.basename(c.currentJsonlPath, '.jsonl');
            if (newInfo.sessionId && currentFile !== newInfo.sessionId) {
              unsubscribeFromFile(c.ws, c.currentJsonlPath);
              c.currentJsonlPath = null;
            } else {
              continue;
            }
          }
          timelineResumeSessionService.sendSessionChanged(c.ws, newInfo.sessionId ?? '', 'session-waiting');
        }
      }
    }, { skipInitial: true });
    sessionWatchers.set(wsKey, sw);
  }

  // Race condition mitigation for isAgentStarting:
  // If PID file is created between detectActiveSession and isAgentRunning,
  // initial detection misses it and watchSessions won't fire for an existing file.
  // Re-check after watcher setup to cover this gap.
  if (isAgentStarting) {
    const recheckInfo = await provider.detectActiveSession(panePid);
    if (conn.cleaned) return;

    if (recheckInfo.status === 'running' && !conn.currentJsonlPath) {
      if (recheckInfo.sessionId) {
        await updateTabAgentSessionId(sessionName, provider, recheckInfo.sessionId).catch(() => {});
      }

      if (recheckInfo.jsonlPath) {
        const resolved = await timelineResumeSessionService.resolveActiveOrLatestJsonl(provider, sessionName, recheckInfo.jsonlPath, recheckInfo.sessionId);
        conn.currentJsonlPath = resolved.jsonlPath;
        timelineResumeSessionService.sendSessionChanged(ws, resolved.sessionId, 'new-session-started');
        await subscribeAndUpdateSummary(ws, resolved.jsonlPath, resolved.sessionId, sessionName, provider);
      } else if (recheckInfo.cwd) {
        const owned = await timelineResumeSessionService.resolveOwnedLatestJsonl(provider, sessionName, null);
        if (owned) {
          conn.currentJsonlPath = owned.jsonlPath;
          await updateTabAgentSessionId(sessionName, provider, owned.sessionId).catch(() => {});
          timelineResumeSessionService.sendSessionChanged(ws, owned.sessionId, 'new-session-started');
          await subscribeAndUpdateSummary(ws, owned.jsonlPath, owned.sessionId, sessionName, provider);
        } else {
          timelineResumeSessionService.sendSessionChanged(ws, recheckInfo.sessionId ?? '', 'session-waiting');
          sendEmptyInit(ws, recheckInfo.sessionId ?? '', true);
        }
      }
    } else {
      sendEmptyInit(ws, '', true);
    }
  }
};

export const gracefulTimelineShutdown = () => {
  for (const ws of runtimeConnections) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1001, 'Server shutting down');
    }
  }
  runtimeConnections.clear();
  for (const [, conn] of connections) {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.close(1001, 'Server shutting down');
    }
    cleanup(conn);
  }
  for (const [, sw] of sessionWatchers) {
    sw.stop();
  }
  sessionWatchers.clear();
  for (const [jsonlPath] of fileWatchers) {
    timelineFileWatcherService.removeFileWatcher(jsonlPath);
  }
};

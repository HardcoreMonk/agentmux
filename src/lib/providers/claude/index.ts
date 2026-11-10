import { randomUUID } from 'crypto';
import type { IAgentProvider } from '@/lib/providers/types';
import {
  buildClaudeLaunchCommand,
  buildClaudeResumeCommand,
  type IClaudeCommandOptions,
  isClaudePermissionMode,
  isValidClaudeSessionId,
} from '@/lib/claude-command';
import { getConfig } from '@/lib/config-store';
import { getClaudeProjectsDir } from '@/lib/path-validation';
import {
  detectActiveClaudeSession,
  findClaudeTranscriptById,
  findNewestClaudeJsonl,
  isClaudeRunning,
  resolveClaudeJsonlPath,
  watchClaudeSessions,
} from '@/lib/providers/claude/session-detection';
import { removeClaudeTabSettings, writeClaudeTabSettings } from '@/lib/providers/claude/tab-settings';
import {
  parseIncremental,
  parseJsonlContent,
  readEntriesBefore,
  readTailEntries,
} from '@/lib/session-parser';
import { checkJsonlIdle } from '@/lib/status/jsonl-check';
import {
  readAgentJsonlPath,
  readAgentSessionId,
  readAgentSummary,
  writeAgentJsonlPath,
  writeAgentSessionId,
  writeAgentSummary,
} from '@/lib/agent-tab-fields';

interface IClaudeTabIdentity {
  tabId?: string;
  sessionName?: string;
}

const assertClaudeSessionId = (sessionId: unknown): string => {
  if (!isValidClaudeSessionId(sessionId)) throw new Error('Claude Code needs a valid session id');
  return sessionId;
};

const readClaudeCommandOptions = async ({ tabId, sessionName }: IClaudeTabIdentity): Promise<IClaudeCommandOptions> => {
  if (!tabId || !sessionName) throw new Error('Claude Code needs a tab id and session name');
  const config = await getConfig();
  const settingsPath = await writeClaudeTabSettings({ tabId, sessionName });
  return {
    settingsPath,
    model: config.claudeModel?.trim() || undefined,
    permissionMode: isClaudePermissionMode(config.claudePermissionMode) ? config.claudePermissionMode : undefined,
  };
};

export const claudeProvider: IAgentProvider = {
  jsonlRoots: (homeDir) => [getClaudeProjectsDir(homeDir)],
  id: 'claude',
  displayName: 'Claude Code',
  panelType: 'claude',
  statusBehavior: {
    watchJsonlWhenBound: false,
    deferStopHookUntilJsonlIdle: false,
    reconcileStateFromJsonl: false,
    recoverPaneInput: false,
    bindSessionFromHook: true,
    leaveNeedsInputOnJsonlGrowth: true,
  },

  matchesProcess: (commandName) => commandName === 'claude',
  isValidSessionId: isValidClaudeSessionId,

  detectActiveSession: (panePid, childPids) => detectActiveClaudeSession(panePid, childPids),
  isAgentRunning: (panePid, childPids) => isClaudeRunning(panePid, childPids),
  watchSessions: (panePid, onChange, options) => watchClaudeSessions(panePid, onChange, options),

  buildResumeCommand: async (sessionId, options) => {
    const validSessionId = assertClaudeSessionId(sessionId);
    const commandOptions = await readClaudeCommandOptions(options);
    // Claude writes no transcript until the first prompt, so `--resume` would fail for an unused session.
    return await findClaudeTranscriptById(validSessionId)
      ? buildClaudeResumeCommand(validSessionId, commandOptions)
      : buildClaudeLaunchCommand(validSessionId, commandOptions);
  },
  buildLaunchCommand: async (options) => {
    const sessionId = assertClaudeSessionId(options.sessionId);
    return buildClaudeLaunchCommand(sessionId, await readClaudeCommandOptions(options));
  },
  createLaunchSessionId: () => randomUUID(),
  cleanupTab: (tab) => removeClaudeTabSettings(tab.id),

  resolveJsonlPath: (sessionId, cwd) => resolveClaudeJsonlPath(sessionId, cwd),
  resolveLatestJsonlPath: (cwd) => findNewestClaudeJsonl(cwd),
  parseJsonlContent,
  readTailEntries,
  readEntriesBefore,
  parseIncremental,
  readJsonlStatus: async (jsonlPath) => ({ ...(await checkJsonlIdle(jsonlPath)), rateLimits: null }),

  readSessionId: readAgentSessionId,
  writeSessionId: writeAgentSessionId,
  readJsonlPath: readAgentJsonlPath,
  writeJsonlPath: writeAgentJsonlPath,
  readSummary: readAgentSummary,
  writeSummary: writeAgentSummary,
};

import type { IAgentProvider } from '@/lib/providers/types';
import {
  buildCodexLaunchCommand,
  buildCodexResumeCommand,
  type ICodexCommandOptions,
  isValidCodexThreadId,
} from '@/lib/codex-command';
import { getConfig } from '@/lib/config-store';
import { getCodexSessionsDir } from '@/lib/path-validation';
import {
  detectActiveCodexSession,
  findCodexSessionJsonlByPromptClaim,
  findCodexSessionJsonl,
  isCodexRunning,
  watchCodexSessions,
} from '@/lib/codex-session-detection';
import {
  parseCodexIncremental,
  parseCodexJsonlContent,
  readCodexEntriesBefore,
  readCodexTailEntries,
} from '@/lib/codex-session-parser';
import {
  readAgentJsonlPath,
  readAgentSessionId,
  readAgentSummary,
  writeAgentJsonlPath,
  writeAgentSessionId,
  writeAgentSummary,
} from '@/lib/agent-tab-fields';
import { checkCodexJsonlState } from '@/lib/codex-jsonl-state';
import { buildCodexSessionHookConfigs } from '@/lib/providers/codex/session-hooks';

const readCodexCommandOptions = async (): Promise<ICodexCommandOptions> => {
  const config = await getConfig();
  return {
    model: config.codexModel?.trim() || undefined,
    sandbox: config.codexSandbox ?? undefined,
    approvalPolicy: config.codexApprovalPolicy ?? undefined,
    search: config.codexSearchEnabled ?? false,
  };
};

const readLaunchOptions = async (options: { tabId?: string; sessionName?: string }): Promise<ICodexCommandOptions> => {
  const commandOptions = await readCodexCommandOptions();
  if (!options.tabId || !options.sessionName) return commandOptions;
  return {
    ...commandOptions,
    hookConfigs: buildCodexSessionHookConfigs({
      tabId: options.tabId,
      sessionName: options.sessionName,
    }),
  };
};

export const codexProvider: IAgentProvider = {
  jsonlRoots: (homeDir) => [getCodexSessionsDir(homeDir)],
  id: 'codex',
  displayName: 'Codex',
  panelType: 'codex',
  statusBehavior: {
    watchJsonlWhenBound: true,
    deferStopHookUntilJsonlIdle: true,
    reconcileStateFromJsonl: true,
    recoverPaneInput: true,
    bindSessionFromHook: false,
    leaveNeedsInputOnJsonlGrowth: false,
  },

  matchesProcess: (commandName) => commandName === 'codex',
  isValidSessionId: isValidCodexThreadId,

  detectActiveSession: (panePid, childPids) => detectActiveCodexSession(panePid, childPids),
  isAgentRunning: (panePid, childPids) => isCodexRunning(panePid, childPids),
  watchSessions: (panePid, onChange, options) => watchCodexSessions(panePid, onChange, options),

  buildResumeCommand: async (sessionId, options) => buildCodexResumeCommand(sessionId, await readLaunchOptions(options)),
  buildLaunchCommand: async (options) => buildCodexLaunchCommand(await readLaunchOptions(options)),
  resolveJsonlPath: async (sessionId, cwd) => {
    const meta = await findCodexSessionJsonl(sessionId, cwd);
    return meta?.jsonlPath ?? null;
  },
  resolveLatestJsonlPath: async (cwd) => {
    const meta = await findCodexSessionJsonl(null, cwd, { allowCwdFallback: true });
    return meta
      ? {
          sessionId: meta.sessionId,
          jsonlPath: meta.jsonlPath,
          mtimeMs: meta.mtimeMs,
          startedAt: meta.startedAt,
        }
      : null;
  },
  resolveJsonlPathForClaim: async (cwd, claim) => {
    const meta = await findCodexSessionJsonlByPromptClaim(cwd, claim);
    return meta
      ? {
          sessionId: meta.sessionId,
          jsonlPath: meta.jsonlPath,
          mtimeMs: meta.mtimeMs,
          startedAt: meta.startedAt,
        }
      : null;
  },
  parseJsonlContent: parseCodexJsonlContent,
  readTailEntries: readCodexTailEntries,
  readEntriesBefore: readCodexEntriesBefore,
  parseIncremental: parseCodexIncremental,
  readJsonlStatus: async (jsonlPath) => {
    const result = await checkCodexJsonlState(jsonlPath);
    return {
      idle: result.idle,
      stale: result.stale,
      lastAssistantSnippet: result.lastAssistantSnippet,
      currentAction: result.currentAction,
      reset: result.reset,
      lastEntryTs: result.lastEntryTs,
      staleMs: 0,
      interrupted: result.interrupted,
      completionTurnId: result.completionTurnId,
      rateLimits: result.rateLimits,
    };
  },

  readSessionId: readAgentSessionId,
  writeSessionId: writeAgentSessionId,
  readJsonlPath: readAgentJsonlPath,
  writeJsonlPath: writeAgentJsonlPath,
  readSummary: readAgentSummary,
  writeSummary: writeAgentSummary,
};

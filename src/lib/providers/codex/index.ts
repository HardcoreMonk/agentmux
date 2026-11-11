import type { IAgentLaunchCommandOptions, IAgentProvider } from '@/lib/providers/types';
import {
  buildCodexLaunchCommand,
  buildCodexResumeCommand,
  CODEX_COMMAND_SAFE_BYTES,
  type ICodexCommandOptions,
  isValidCodexThreadId,
} from '@/lib/codex-command';
import { getConfig, type IConfigData } from '@/lib/config-store';
import {
  buildDelegationEnvPrefix,
  buildDelegationGuide,
  ensureDelegationAssets,
  getDelegationShimDir,
  isDelegationGuideEnabled,
} from '@/lib/delegation-guide';
import { createLogger } from '@/lib/logger';
import { getSessionCwd } from '@/lib/tmux';
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
import {
  mergeCodexDeveloperInstructions,
  readCodexDeveloperInstructions,
} from '@/lib/providers/codex/developer-instructions';
import { buildCodexSessionHookConfigs } from '@/lib/providers/codex/session-hooks';

const log = createLogger('delegation');

const readCodexCommandOptions = (config: IConfigData): ICodexCommandOptions => ({
  model: config.codexModel?.trim() || undefined,
  sandbox: config.codexSandbox ?? undefined,
  approvalPolicy: config.codexApprovalPolicy ?? undefined,
  search: config.codexSearchEnabled ?? false,
});

const readDeveloperInstructions = async (cwd: string | null): Promise<string | undefined> => {
  // The project config layer is found from the cwd, so without it the existing value is unknown.
  if (!cwd) {
    log.warn('codex tab cwd unknown: delegation guide skipped');
    return undefined;
  }
  const existing = await readCodexDeveloperInstructions({ cwd });
  if (!existing.ok) {
    log.warn(`codex developer_instructions ${existing.reason}: delegation guide skipped (${existing.detail})`);
    return undefined;
  }
  return mergeCodexDeveloperInstructions(existing.value, buildDelegationGuide('codex'));
};

const readLaunchOptions = async ({
  workspaceId,
  tabId,
  sessionName,
  cwd,
}: IAgentLaunchCommandOptions): Promise<ICodexCommandOptions> => {
  const config = await getConfig();
  const commandOptions = readCodexCommandOptions(config);
  if (!tabId || !sessionName) return commandOptions;
  const launchOptions = { ...commandOptions, hookConfigs: buildCodexSessionHookConfigs({ tabId, sessionName }) };
  if (!workspaceId || !isDelegationGuideEnabled(config)) return launchOptions;

  try {
    await ensureDelegationAssets();
  } catch (err) {
    log.warn(`delegation shim not written: ${err instanceof Error ? err.message : err}`);
  }
  // `cwd` only locates project config; passing it on would add --cd to the command.
  return {
    ...launchOptions,
    envPrefix: buildDelegationEnvPrefix({ workspaceId, tabId, shimDir: getDelegationShimDir() }),
    developerInstructions: await readDeveloperInstructions(cwd ?? await getSessionCwd(sessionName)),
  };
};

const buildWithinSafeBytes = (
  build: (options: ICodexCommandOptions) => string,
  options: ICodexCommandOptions,
): string => {
  const command = build(options);
  const bytes = Buffer.byteLength(command);
  if (!options.developerInstructions || bytes <= CODEX_COMMAND_SAFE_BYTES) return command;
  log.warn(`codex command is ${bytes} bytes: delegation guide skipped`);
  return build({ ...options, developerInstructions: undefined });
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

  buildResumeCommand: async (sessionId, options) => buildWithinSafeBytes(
    (commandOptions) => buildCodexResumeCommand(sessionId, commandOptions),
    await readLaunchOptions(options),
  ),
  buildLaunchCommand: async (options) => buildWithinSafeBytes(buildCodexLaunchCommand, await readLaunchOptions(options)),
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

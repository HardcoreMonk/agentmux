import { codexProvider } from '@/lib/providers/codex';
import { claudeProvider } from '@/lib/providers/claude';
import { isJsonlPathUnderRoots } from '@/lib/path-validation';
import { clearProviders, listProviders, registerProvider } from '@/lib/providers/registry';
import type { IAgentProvider } from '@/lib/providers/types';
import type { ISessionInfo } from '@/types/timeline';

clearProviders();
registerProvider(codexProvider);
registerProvider(claudeProvider);

export interface IProviderSessionScan {
  provider: IAgentProvider | null;
  info: ISessionInfo;
}

const NOT_RUNNING: ISessionInfo = {
  status: 'not-running',
  sessionId: null,
  jsonlPath: null,
  pid: null,
  startedAt: null,
  cwd: null,
};

const NOT_INSTALLED: ISessionInfo = {
  status: 'not-installed',
  sessionId: null,
  jsonlPath: null,
  pid: null,
  startedAt: null,
  cwd: null,
};

export const detectAnyActiveSession = async (
  panePid: number,
  childPids?: number[],
): Promise<IProviderSessionScan> => {
  const providers = listProviders();
  let allNotInstalled = providers.length > 0;

  for (const provider of providers) {
    const info = await provider.detectActiveSession(panePid, childPids);
    if (info.status === 'running') return { provider, info };
    if (info.status !== 'not-installed') allNotInstalled = false;
  }

  return { provider: null, info: allNotInstalled ? NOT_INSTALLED : NOT_RUNNING };
};

export const isAllowedAgentJsonlPath = (filePath: string, homeDir?: string): boolean =>
  isJsonlPathUnderRoots(
    filePath,
    listProviders().flatMap((provider) => provider.jsonlRoots(homeDir)),
  );

export const isAnyAgentRunning = async (
  panePid: number,
  childPids?: number[],
): Promise<boolean> => {
  for (const provider of listProviders()) {
    if (await provider.isAgentRunning(panePid, childPids)) return true;
  }
  return false;
};

export {
  getProvider,
  getProviderByPanelType,
  getProviderByProcessName,
  listProviders,
  registerProvider,
} from '@/lib/providers/registry';
export type {
  IAgentProvider,
  IAgentProviderStatusBehavior,
  TAgentHookStatusBehavior,
  IAgentJsonlResolution,
  IAgentPromptClaim,
  IAgentLaunchCommandOptions,
  IAgentResumeCommandOptions,
  IAgentSessionWatchOptions,
} from '@/lib/providers/types';

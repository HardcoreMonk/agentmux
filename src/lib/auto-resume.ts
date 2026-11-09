import { readLayoutFile, resolveLayoutFile, collectAllTabs } from '@/lib/layout-store';
import { hasSession, createSession, getPaneCurrentCommand, sendKeys } from '@/lib/tmux';
import { getWorkspaces } from '@/lib/workspace-store';
import { getProviderByPanelType, getProviderByProcessName } from '@/lib/providers';
import type { IAgentProvider } from '@/lib/providers';
import { createLogger } from '@/lib/logger';

const log = createLogger('auto-resume');

const SHELL_READY_DELAY_MS = 500;
const SAFE_SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'dash']);

export interface IAutoResumeTarget {
  workspaceId: string;
  tabId: string;
  tmuxSession: string;
  sessionId: string;
  provider: IAgentProvider;
}

export interface IAutoResumeResult {
  created: string[];
  resumed: string[];
}

const findAutoResumeTargets = async (): Promise<IAutoResumeTarget[]> => {
  const { workspaces } = await getWorkspaces();
  const targets: IAutoResumeTarget[] = [];

  for (const ws of workspaces) {
    const layout = await readLayoutFile(resolveLayoutFile(ws.id));
    if (!layout) continue;

    const tabs = collectAllTabs(layout.root);
    for (const tab of tabs) {
      const provider = getProviderByPanelType(tab.panelType);
      if (!provider) continue;
      const sessionId = provider.readSessionId(tab);
      if (!sessionId) continue;
      targets.push({
        workspaceId: ws.id,
        tabId: tab.id,
        tmuxSession: tab.sessionName,
        sessionId,
        provider,
      });
    }
  }

  return targets;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

type TResumeSendOutcome = 'sent' | 'skipped' | 'failed';

const sendResumeKeys = async (target: IAutoResumeTarget): Promise<TResumeSendOutcome> => {
  try {
    const command = await getPaneCurrentCommand(target.tmuxSession);
    if (!command) {
      log.warn(`Cannot check process: ${target.tmuxSession}`);
      return 'failed';
    }

    if (!SAFE_SHELLS.has(command)) {
      const runningProvider = getProviderByProcessName(command);
      if (runningProvider && runningProvider.id === target.provider.id) {
        log.debug(`${target.provider.displayName} already running, skip: ${target.tmuxSession}`);
        return 'skipped';
      }
      log.debug(`Non-shell process running (${command}), skip: ${target.tmuxSession}`);
      return 'skipped';
    }

    const resumeCmd = await target.provider.buildResumeCommand(target.sessionId, {
      workspaceId: target.workspaceId,
      tabId: target.tabId,
      sessionName: target.tmuxSession,
    });
    log.debug(`Sending resume: ${target.tmuxSession} → ${target.sessionId}`);
    await sendKeys(target.tmuxSession, resumeCmd);

    return 'sent';
  } catch (err) {
    log.error(`Failed: ${target.tmuxSession} — ${err instanceof Error ? err.message : err}`);
    return 'failed';
  }
};

export const executeAutoResume = async (
  targets: IAutoResumeTarget[],
  preexistingSessions: ReadonlySet<string> = new Set(),
): Promise<IAutoResumeResult> => {
  // Phase 1: Sequential session creation — first createSession cold-starts tmux server, so avoid race
  const created: string[] = [];
  for (const target of targets) {
    if (!(await hasSession(target.tmuxSession))) {
      log.debug(`No tmux session, creating new: ${target.tmuxSession}`);
      await createSession(target.tmuxSession, 80, 24);
      created.push(target.tmuxSession);
    }
  }

  // Phase 2: Wait for shell initialization if new sessions were created (once)
  if (created.length > 0) {
    await sleep(SHELL_READY_DELAY_MS);
  }

  // Phase 3: Send resume commands in parallel only to sessions absent at startup
  const targetsToResume = targets.filter(
    (target) => !preexistingSessions.has(target.tmuxSession),
  );
  const outcomes = await Promise.all(
    targetsToResume.map(async (target) => ({
      session: target.tmuxSession,
      outcome: await sendResumeKeys(target),
    })),
  );
  const resumed = outcomes
    .filter((entry) => entry.outcome === 'sent')
    .map((entry) => entry.session);

  return { created, resumed };
};

export const autoResumeOnStartup = async (options: {
  preexistingSessions: ReadonlySet<string>;
}): Promise<void> => {
  const targets = await findAutoResumeTargets();
  if (targets.length === 0) return;

  log.debug(`${targets.length} surface(s) auto-resume started`);
  executeAutoResume(targets, options.preexistingSessions).then(() => {
    log.debug('Auto-resume complete');
  }).catch((err) => {
    log.error(`Auto-resume error: ${err instanceof Error ? err.message : err}`);
  });
};

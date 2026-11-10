import { resolveTabRuntimeVersion } from '@/lib/runtime/terminal-mode';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';
import { killSession } from '@/lib/tmux';
import { listProviders } from '@/lib/providers';
import { createLogger } from '@/lib/logger';
import type { ITab } from '@/types/terminal';

const log = createLogger('tab-cleanup');

type TCleanupTab = Pick<ITab, 'id' | 'sessionName' | 'panelType' | 'runtimeVersion'>;

// panelType is only the tab's current view; an earlier provider may still own files for this tab.
const cleanupProviderTabs = async (tab: TCleanupTab): Promise<void> => {
  await Promise.all(listProviders().map(async (provider) => {
    try {
      await provider.cleanupTab?.(tab);
    } catch (err) {
      log.warn(`${provider.id} tab cleanup failed: ${tab.id} — ${err instanceof Error ? err.message : err}`);
    }
  }));
};

const closeTabSession = async (tab: TCleanupTab): Promise<void> => {
  if (tab.panelType === 'web-browser') return;
  if (resolveTabRuntimeVersion(tab) === 2) {
    const supervisor = getRuntimeSupervisor();
    await supervisor.ensureStarted();
    await supervisor.deleteTerminalTab(tab.id);
    return;
  }
  await killSession(tab.sessionName);
};

export const cleanupTabSession = async (tab: TCleanupTab): Promise<void> => {
  await closeTabSession(tab);
  await cleanupProviderTabs(tab);
};

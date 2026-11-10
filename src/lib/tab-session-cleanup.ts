import { resolveTabRuntimeVersion } from '@/lib/runtime/terminal-mode';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';
import { killSession } from '@/lib/tmux';
import { getProviderByPanelType } from '@/lib/providers';
import { createLogger } from '@/lib/logger';
import type { ITab } from '@/types/terminal';

const log = createLogger('tab-cleanup');

type TCleanupTab = Pick<ITab, 'id' | 'sessionName' | 'panelType' | 'runtimeVersion'>;

const cleanupProviderTab = async (tab: TCleanupTab): Promise<void> => {
  try {
    await getProviderByPanelType(tab.panelType)?.cleanupTab?.(tab);
  } catch (err) {
    log.warn(`provider tab cleanup failed: ${tab.id} — ${err instanceof Error ? err.message : err}`);
  }
};

export const cleanupTabSession = async (tab: TCleanupTab): Promise<void> => {
  if (tab.panelType === 'web-browser') return;
  if (resolveTabRuntimeVersion(tab) === 2) {
    const supervisor = getRuntimeSupervisor();
    await supervisor.ensureStarted();
    await supervisor.deleteTerminalTab(tab.id);
  } else {
    await killSession(tab.sessionName);
  }
  await cleanupProviderTab(tab);
};

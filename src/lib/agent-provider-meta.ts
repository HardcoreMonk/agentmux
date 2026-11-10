import type { TAgentPanelType } from '@/types/terminal';
import { isAgentPanelType } from '@/lib/panel-type';

// Client-safe provider metadata. Do not import server-only modules (providers, fs, child_process) here.
export interface IAgentProviderMeta {
  panelType: TAgentPanelType;
  label: string;
  newTabCommand: string;
  restartCommands: readonly string[];
  exitCommand: string;
  interruptSequence: string;
  keepTimelineOnSessionEnd: boolean;
}

export const AGENT_PROVIDER_META: Readonly<Record<TAgentPanelType, IAgentProviderMeta>> = {
  codex: {
    panelType: 'codex',
    label: 'Codex',
    newTabCommand: 'codex-new',
    restartCommands: ['/new', '/clear'],
    exitCommand: '/exit',
    interruptSequence: '\x1b\x1b',
    keepTimelineOnSessionEnd: true,
  },
};

export const getAgentProviderMeta = (panelType: unknown): IAgentProviderMeta | null =>
  isAgentPanelType(panelType) ? AGENT_PROVIDER_META[panelType] : null;

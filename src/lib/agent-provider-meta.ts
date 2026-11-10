import type { TAgentPanelType } from '@/types/terminal';
import { DEFAULT_AGENT_PANEL_TYPE, isAgentPanelType } from '@/lib/panel-type';

// Client-safe provider metadata. Do not import server-only modules (providers, fs, child_process) here.
export interface IAgentProviderMeta {
  panelType: TAgentPanelType;
  label: string;
  // Compact uppercase label for the view switch.
  shortLabel: string;
  // Home-relative config directory shown in the install hint.
  configDir: string;
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
    shortLabel: 'CODEX',
    configDir: '~/.codex',
    newTabCommand: 'codex-new',
    restartCommands: ['/new', '/clear'],
    exitCommand: '/exit',
    interruptSequence: '\x1b\x1b',
    keepTimelineOnSessionEnd: true,
  },
  claude: {
    panelType: 'claude',
    label: 'Claude Code',
    shortLabel: 'CLAUDE',
    configDir: '~/.claude',
    newTabCommand: 'claude-new',
    restartCommands: ['/clear'],
    exitCommand: '/exit',
    interruptSequence: '\x1b',
    keepTimelineOnSessionEnd: true,
  },
};

export const getAgentProviderMeta = (panelType: unknown): IAgentProviderMeta | null =>
  isAgentPanelType(panelType) ? AGENT_PROVIDER_META[panelType] : null;

// Falls back to the default agent when the panel is not an agent panel or has no type yet.
export const getAgentLabel = (panelType: unknown): string =>
  (getAgentProviderMeta(panelType) ?? AGENT_PROVIDER_META[DEFAULT_AGENT_PANEL_TYPE]).label;

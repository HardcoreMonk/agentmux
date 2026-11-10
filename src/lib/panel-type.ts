import type { TAgentPanelType, TPanelType } from '@/types/terminal';

export const AGENT_PANEL_TYPES = ['codex', 'claude'] as const satisfies readonly TAgentPanelType[];

// Compile-time guard: fails when a TAgentPanelType member is missing from AGENT_PANEL_TYPES.
type TMissingAgentPanelType = Exclude<TAgentPanelType, (typeof AGENT_PANEL_TYPES)[number]>;
const assertAgentPanelTypesExhaustive: [TMissingAgentPanelType] extends [never] ? true : never = true;
void assertAgentPanelTypesExhaustive;

export const PANEL_TYPES = ['terminal', ...AGENT_PANEL_TYPES, 'web-browser', 'diff'] as const satisfies readonly TPanelType[];

export const DEFAULT_AGENT_PANEL_TYPE: TAgentPanelType = 'codex';

const PANEL_TYPE_SET = new Set<string>(PANEL_TYPES);
const AGENT_PANEL_TYPE_SET = new Set<string>(AGENT_PANEL_TYPES);

export const isPanelType = (panelType: unknown): panelType is TPanelType =>
  typeof panelType === 'string' && PANEL_TYPE_SET.has(panelType);

export const isAgentPanelType = (panelType: unknown): panelType is TAgentPanelType =>
  typeof panelType === 'string' && AGENT_PANEL_TYPE_SET.has(panelType);

export const normalizePanelType = (panelType: TPanelType | string | null | undefined): TPanelType | undefined =>
  isPanelType(panelType) ? panelType : undefined;

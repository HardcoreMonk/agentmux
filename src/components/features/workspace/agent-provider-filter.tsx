import AgentProviderIcon from '@/components/icons/agent-provider-icon';
import { AGENT_PANEL_TYPES } from '@/lib/panel-type';
import { AGENT_PROVIDER_META } from '@/lib/agent-provider-meta';
import { cn } from '@/lib/utils';
import type { TAgentPanelType } from '@/types/terminal';

export type TAgentProviderFilter = 'all' | TAgentPanelType;

const AGENT_PROVIDER_FILTERS: readonly TAgentProviderFilter[] = ['all', ...AGENT_PANEL_TYPES];

interface IAgentProviderFilterProps {
  value: TAgentProviderFilter;
  onChange: (filter: TAgentProviderFilter) => void;
  ariaLabel: string;
  allLabel: string;
  className?: string;
  buttonClassName?: string;
}

// Segmented "All / Codex / Claude Code" filter shared by the session list and Session Explorer.
const AgentProviderFilter = ({
  value,
  onChange,
  ariaLabel,
  allLabel,
  className,
  buttonClassName,
}: IAgentProviderFilterProps) => (
  <div role="group" aria-label={ariaLabel} className={cn('flex gap-1', className)}>
    {AGENT_PROVIDER_FILTERS.map((option) => {
      const selected = value === option;
      return (
        <button
          key={option}
          type="button"
          aria-pressed={selected}
          data-filter={option}
          onClick={() => onChange(option)}
          className={cn(
            'inline-flex min-h-11 min-w-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 text-sm [word-break:keep-all] transition-colors',
            'hover:bg-agent-active/5 active:bg-agent-active/15 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
            selected
              ? 'border-agent-active bg-agent-active/10 font-medium text-foreground'
              : 'border-border text-muted-foreground',
            buttonClassName,
          )}
        >
          {option !== 'all' && <AgentProviderIcon panelType={option} className="h-3.5 w-3.5 shrink-0" />}
          {option === 'all' ? allLabel : AGENT_PROVIDER_META[option].label}
        </button>
      );
    })}
  </div>
);

export default AgentProviderFilter;

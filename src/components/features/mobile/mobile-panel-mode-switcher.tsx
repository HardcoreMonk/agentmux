import { useState } from 'react';
import { GitCompareArrows, Terminal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import AgentProviderIcon from '@/components/icons/agent-provider-icon';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { AGENT_PANEL_TYPES } from '@/lib/panel-type';
import { AGENT_PROVIDER_META } from '@/lib/agent-provider-meta';
import type { TPanelType } from '@/types/terminal';

// Below 440px the four 44px mode buttons leave no room for the tab name next to the
// copy/new/close actions, so they collapse into one button that opens a mode list.
const PANEL_MODES = [
  { type: 'terminal' as const, label: 'Terminal', icon: <Terminal size={16} /> },
  ...AGENT_PANEL_TYPES.map((type) => ({
    type: type as TPanelType,
    label: AGENT_PROVIDER_META[type].label,
    icon: <AgentProviderIcon panelType={type} className="h-4 w-4" />,
  })),
  { type: 'diff' as const, label: 'Diff', icon: <GitCompareArrows size={16} /> },
];

const MODE_BUTTON_CLASS =
  'flex h-11 w-11 touch-manipulation items-center justify-center rounded transition-colors active:bg-accent/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

interface IPanelModeOptionsProps {
  panelType: TPanelType;
  onSelect: (type: TPanelType) => void;
}

export const PanelModeOptions = ({ panelType, onSelect }: IPanelModeOptionsProps) => (
  <div className="flex flex-col">
    {PANEL_MODES.map((mode) => (
      <button
        key={mode.type}
        type="button"
        className={cn(
          'flex h-11 w-full touch-manipulation items-center gap-3 rounded px-3 text-left text-sm transition-colors active:bg-accent/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          panelType === mode.type
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
        )}
        onClick={() => onSelect(mode.type)}
        aria-pressed={panelType === mode.type}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
          {mode.icon}
        </span>
        <span className="truncate">{mode.label}</span>
      </button>
    ))}
  </div>
);

interface IMobilePanelModeSwitcherProps {
  panelType: TPanelType;
  onSwitchPanelType: (type: TPanelType) => void;
}

const MobilePanelModeSwitcher = ({ panelType, onSwitchPanelType }: IMobilePanelModeSwitcherProps) => {
  const t = useTranslations('mobile');
  const [menuOpen, setMenuOpen] = useState(false);
  const current = PANEL_MODES.find((mode) => mode.type === panelType) ?? PANEL_MODES[0];
  const menuLabel = t('panelModeMenu', { mode: current.label });

  const handleSelect = (type: TPanelType) => {
    setMenuOpen(false);
    onSwitchPanelType(type);
  };

  return (
    <>
      <div className="flex items-center gap-px max-[440px]:hidden" data-slot="panel-mode-buttons">
        {PANEL_MODES.map((mode) => (
          <button
            key={mode.type}
            type="button"
            className={cn(
              MODE_BUTTON_CLASS,
              panelType === mode.type
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground/60 hover:bg-accent/40 hover:text-muted-foreground',
            )}
            onClick={() => onSwitchPanelType(mode.type)}
            aria-pressed={panelType === mode.type}
            aria-label={mode.label}
            title={mode.label}
          >
            {mode.icon}
          </button>
        ))}
      </div>

      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className={cn(MODE_BUTTON_CLASS, 'hidden bg-accent text-foreground max-[440px]:flex')}
              aria-label={menuLabel}
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              title={menuLabel}
              data-slot="panel-mode-menu-trigger"
            />
          }
        >
          {current.icon}
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" className="w-48 gap-0 p-1">
          <PanelModeOptions panelType={panelType} onSelect={handleSelect} />
        </PopoverContent>
      </Popover>
    </>
  );
};

export default MobilePanelModeSwitcher;

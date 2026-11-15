import { useTranslations } from 'next-intl';
import { GitCompareArrows } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface IGitPanelToggleButtonProps {
  open: boolean;
  onToggle: () => void;
}

const GitPanelToggleButton = ({ open, onToggle }: IGitPanelToggleButtonProps) => {
  const t = useTranslations('terminal');
  const label = open ? t('gitPanelClose') : t('gitPanelOpen');

  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded transition-colors',
          open
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )}
        onClick={onToggle}
        aria-pressed={open}
        aria-label={label}
      >
        <GitCompareArrows className="h-3.5 w-3.5" />
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
};

export default GitPanelToggleButton;

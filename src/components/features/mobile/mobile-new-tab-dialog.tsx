import { useState } from 'react';
import { Terminal, GitCompareArrows } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Spinner from '@/components/ui/spinner';
import AgentProviderIcon from '@/components/icons/agent-provider-icon';
import { AGENT_NEW_TAB_ITEMS } from '@/lib/agent-new-tab-items';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { TPanelType } from '@/types/terminal';

interface IMobileNewTabDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateTab: (panelType?: TPanelType, options?: { command?: string }) => Promise<void>;
}

const MobileNewTabDialog = ({ open, onOpenChange, onCreateTab }: IMobileNewTabDialogProps) => {
  const tm = useTranslations('mobile');
  const [creatingKey, setCreatingKey] = useState<string | null>(null);

  const MENU_ITEMS: Array<{ key: string; type: TPanelType; icon: React.ReactNode; label: string; startAgent?: boolean }> = [
    ...AGENT_NEW_TAB_ITEMS.map((item) => ({
      key: item.key,
      type: item.type as TPanelType,
      icon: <AgentProviderIcon panelType={item.type} className="h-5 w-5 text-muted-foreground" />,
      label: item.label,
      startAgent: true,
    })),
    { key: 'terminal', type: 'terminal', icon: <Terminal className="h-5 w-5 text-muted-foreground" />, label: 'Terminal' },
    { key: 'diff', type: 'diff', icon: <GitCompareArrows className="h-5 w-5 text-muted-foreground" />, label: 'Diff' },
  ];

  const handleSelect = async (item: (typeof MENU_ITEMS)[number]) => {
    setCreatingKey(item.key);
    if (item.startAgent) {
      await onCreateTab(item.type, { command: item.key });
    } else {
      await onCreateTab(item.type);
    }
    setCreatingKey(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-xs gap-2 rounded-xl p-4">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium">{tm('newTab')}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {MENU_ITEMS.map((item) => (
            <button
              key={item.key}
              className="flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border border-border bg-background text-foreground transition-colors active:bg-accent disabled:pointer-events-none disabled:opacity-50"
              disabled={creatingKey !== null}
              onClick={() => handleSelect(item)}
            >
              {creatingKey === item.key ? <Spinner className="h-4 w-4" /> : item.icon}
              <span className="text-xs">{item.label}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MobileNewTabDialog;

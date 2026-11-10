import { useTranslations } from 'next-intl';
import { getAgentLabel } from '@/lib/agent-provider-meta';
import type { TPanelType } from '@/types/terminal';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface IInterruptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  panelType?: TPanelType;
}

const InterruptDialog = ({ open, onOpenChange, onConfirm, panelType }: IInterruptDialogProps) => {
  const t = useTranslations('terminal');
  const tc = useTranslations('common');
  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('interruptTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('interruptDescription', { agent: getAgentLabel(panelType) })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleConfirm}>
            {t('interruptConfirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default InterruptDialog;

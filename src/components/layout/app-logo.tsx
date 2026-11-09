import { Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';

interface IAppLogoProps {
  shimmer?: boolean;
  size?: 'sm' | 'xl';
  className?: string;
}

const AppLogo = ({ shimmer = false, size = 'sm', className }: IAppLogoProps) => {
  const iconSize = size === 'xl' ? 'h-6 w-6' : 'h-4 w-4';
  const textSize = size === 'xl' ? 'text-xl' : 'text-sm';

  return (
    <div className={cn('flex items-center gap-1.5', size === 'xl' && 'gap-2.5', className)}>
      <Terminal className={cn(iconSize, 'shrink-0 text-brand')} />
      <span className={cn(textSize, shimmer ? 'animate-shimmer' : 'text-brand')}>
        <span className="font-bold">agent</span>
        <span className="font-normal">mux</span>
      </span>
    </div>
  );
};

export default AppLogo;

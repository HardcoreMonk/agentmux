import { RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import useIsMobileDevice from '@/hooks/use-is-mobile-device';
import usePageVisible from '@/hooks/use-page-visible';
import { shouldOfferReloadRecovery } from '@/lib/reload-recovery';

interface IMobileReloadRecoveryBannerProps {
  failures: number;
}

const MobileReloadRecoveryBanner = ({ failures }: IMobileReloadRecoveryBannerProps) => {
  const t = useTranslations('connection');
  const isMobile = useIsMobileDevice();
  const visible = usePageVisible();

  if (!shouldOfferReloadRecovery({ isMobile, visible, failures })) {
    return null;
  }

  return (
    <div
      role="status"
      className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-card/95 px-3 py-2 text-sm shadow-sm backdrop-blur-xs"
    >
      <span className="min-w-0 flex-1 text-foreground [word-break:keep-all]">
        {t('reloadRecoveryMessage')}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={t('reloadRecoveryAction')}
        className="min-h-11 shrink-0 gap-1.5 px-3 [word-break:keep-all]"
        onClick={() => window.location.reload()}
      >
        <RotateCw className="h-3.5 w-3.5" />
        {t('reloadRecoveryAction')}
      </Button>
    </div>
  );
};

export default MobileReloadRecoveryBanner;

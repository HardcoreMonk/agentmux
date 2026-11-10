import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FolderCode } from 'lucide-react';
import Spinner from '@/components/ui/spinner';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { AGENT_PROVIDER_META } from '@/lib/agent-provider-meta';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { TLayoutNode, TPanelType } from '@/types/terminal';
import { collectPanes } from '@/hooks/use-layout';
import useTabMetadataStore from '@/hooks/use-tab-metadata-store';
import useConfigStore from '@/hooks/use-config-store';
import useIsMac from '@/hooks/use-is-mac';
import useShortcutHints from '@/hooks/use-shortcut-hints';
import ShortcutKey from '@/components/shortcut-key';
import isElectron from '@/hooks/use-is-electron';
import SystemResources from '@/components/layout/system-resources';
import { buildEditorUrl, isSafeEditorTarget, isWebEditorUrl } from '@/lib/editor-url';
import { EditorIcon } from '@/components/icons/editor-icons';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);
const isLocalAccess = typeof window !== 'undefined'
  && LOCAL_HOSTNAMES.has(window.location.hostname);

const EqualizeIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="4" x2="8" y2="20" />
    <line x1="16" y1="4" x2="16" y2="20" />
  </svg>
);

const SplitVerticalIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="12" y1="3" x2="12" y2="21" />
  </svg>
);

const SplitHorizontalIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="12" x2="21" y2="12" />
  </svg>
);

interface IContentHeaderProps {
  activePaneId: string | null;
  root: TLayoutNode;
  paneCount: number;
  canSplit: boolean;
  isSplitting: boolean;
  onSplitPane: (paneId: string, orientation: 'horizontal' | 'vertical') => void;
  onEqualizeRatios: () => void;
  onUpdateTabPanelType: (paneId: string, tabId: string, panelType: TPanelType) => void;
}

const ContentHeader = ({
  activePaneId,
  root,
  paneCount,
  canSplit,
  isSplitting,
  onSplitPane,
  onEqualizeRatios,
  onUpdateTabPanelType,
}: IContentHeaderProps) => {
  const t = useTranslations('terminal');
  const isMac = useIsMac();
  const mod = isMac ? '⌘' : 'Ctrl+';
  const splitRightShortcut = isMac ? '⌘D' : 'Ctrl+Alt+D';
  const showShortcuts = useShortcutHints();
  const [isToggling, setIsToggling] = useState(false);

  const panes = collectPanes(root);
  const focusedPane = panes.find((p) => p.id === activePaneId) ?? panes[0];
  const activeTab = focusedPane?.tabs.find((t) => t.id === focusedPane.activeTabId);
  const activePanelType: TPanelType = activeTab?.panelType ?? 'terminal';

  const activeTabCwd = useTabMetadataStore(
    (state) => (activeTab?.id ? state.metadata[activeTab.id]?.cwd : undefined),
  );

  const editorUrl = useConfigStore((state) => state.editorUrl);
  const editorPreset = useConfigStore((state) => state.editorPreset);

  const editorTarget = useMemo(
    () => buildEditorUrl(editorPreset, editorUrl, activeTabCwd || '/'),
    [editorPreset, editorUrl, activeTabCwd],
  );
  const editorTargetIsSafe = !!editorTarget && isSafeEditorTarget(editorTarget);
  const editorTargetIsWeb = !!editorTarget && isWebEditorUrl(editorTarget);
  const remoteNotSupported = editorTargetIsSafe && !editorTargetIsWeb && !isLocalAccess;
  const editorTooltipLabel = remoteNotSupported ? t('editorRemoteNotSupported') : t('openEditor');

  const handlePanelSwitch = (value: string) => {
    if (isToggling || !focusedPane || !activeTab) return;
    const next = value as TPanelType;
    if (next === activePanelType) return;
    setIsToggling(true);
    onUpdateTabPanelType(focusedPane.id, activeTab.id, next);
    setTimeout(() => setIsToggling(false), 150);
  };

  const paneId = focusedPane?.id;
  const panelButtons: Array<{ value: TPanelType; label: string; mac?: string; other?: string }> = [
    { value: 'terminal', label: 'TERMINAL', mac: '⌘⇧T', other: '^⇧T' },
    { value: 'codex', label: AGENT_PROVIDER_META.codex.shortLabel },
    { value: 'claude', label: AGENT_PROVIDER_META.claude.shortLabel },
    { value: 'diff', label: 'DIFF', mac: '⌘⇧F', other: '^⇧F' },
  ];

  return (
    <div className="shrink-0 bg-background">
      <div
        className="relative z-40 flex h-12 shrink-0 items-center border-b border-border px-3"
        {...(isElectron ? { style: { WebkitAppRegion: 'drag' } as React.CSSProperties } : {})}
      >
      <div className="mr-auto" {...(isElectron ? { style: { WebkitAppRegion: 'no-drag' } as React.CSSProperties } : {})}>
        <SystemResources />
      </div>
      <TooltipProvider>
        <div
          className="flex items-center gap-1"
          {...(isElectron ? { style: { WebkitAppRegion: 'no-drag' } as React.CSSProperties } : {})}
        >
          <div className={cn('flex items-center gap-px border-r border-border pr-2', isToggling && 'pointer-events-none opacity-80')}>
            {panelButtons.map((item) => (
              <div key={item.value} className="relative">
                <button
                  className={cn(
                    'w-[3.75rem] rounded px-1.5 py-0.5 text-center text-[10px] font-medium tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    activePanelType === item.value
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground/60 hover:text-muted-foreground',
                  )}
                  onClick={() => handlePanelSwitch(item.value)}
                  aria-pressed={activePanelType === item.value}
                >
                  {item.label}
                </button>
                {activePanelType !== item.value && item.mac && item.other && (
                  <ShortcutKey
                    mac={item.mac}
                    other={item.other}
                    className={cn(
                      'absolute -right-0.5 -top-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-medium leading-none text-muted-foreground transition-opacity duration-200 pointer-events-none',
                      showShortcuts ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                )}
              </div>
            ))}
          </div>
          {editorPreset !== 'off' && (
          <Tooltip>
            <TooltipTrigger
              className={cn(
                'flex h-7 w-7 items-center justify-center text-muted-foreground',
                remoteNotSupported
                  ? 'cursor-not-allowed opacity-30'
                  : 'hover:text-foreground',
              )}
              aria-disabled={remoteNotSupported || undefined}
              onClick={() => {
                if (remoteNotSupported) return;
                if (!editorTarget) {
                  toast.info(t('editorUrlNotSet'));
                  return;
                }
                if (!editorTargetIsSafe) {
                  toast.error(t('editorUrlNotSet'));
                  return;
                }
                if (editorTargetIsWeb) {
                  window.open(editorTarget, '_blank', 'noopener,noreferrer');
                  return;
                }
                const api = (window as unknown as { electronAPI?: { openExternal: (url: string) => void } }).electronAPI;
                if (api?.openExternal) {
                  api.openExternal(editorTarget);
                  return;
                }
                const iframe = document.createElement('iframe');
                iframe.style.display = 'none';
                iframe.src = editorTarget;
                document.body.appendChild(iframe);
                setTimeout(() => iframe.remove(), 1000);
              }}
              aria-label={t('openEditor')}
            >
              {editorTarget
                ? <EditorIcon preset={editorPreset} className="h-3.5 w-3.5" />
                : <FolderCode className="h-3.5 w-3.5" />}
            </TooltipTrigger>
            <TooltipContent side="bottom">{editorTooltipLabel}</TooltipContent>
          </Tooltip>
          )}

          {editorPreset !== 'off' && <div className="h-5 w-px bg-border" />}

          <div className="relative">
            <Tooltip>
              <TooltipTrigger
                className={cn(
                  'flex h-7 w-7 items-center justify-center text-muted-foreground',
                  canSplit
                    ? 'hover:text-foreground'
                    : 'cursor-not-allowed opacity-30',
                )}
                onClick={canSplit && paneId ? () => onSplitPane(paneId, 'horizontal') : undefined}
                disabled={!canSplit}
                aria-label={t('splitVertical')}
              >
                {isSplitting ? (
                  <Spinner className="h-3 w-3" />
                ) : (
                  <SplitVerticalIcon className="h-3.5 w-3.5" />
                )}
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('splitVerticalShortcut', { shortcut: splitRightShortcut })}</TooltipContent>
            </Tooltip>
            <ShortcutKey
              mac="⌘D"
              other="^⌥D"
              className={cn(
                'absolute -right-0.5 -top-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-medium leading-none text-muted-foreground transition-opacity duration-200 pointer-events-none',
                showShortcuts ? 'opacity-100' : 'opacity-0',
              )}
            />
          </div>

          <div className="relative">
            <Tooltip>
              <TooltipTrigger
                className={cn(
                  'flex h-7 w-7 items-center justify-center text-muted-foreground',
                  canSplit
                    ? 'hover:text-foreground'
                    : 'cursor-not-allowed opacity-30',
                )}
                onClick={canSplit && paneId ? () => onSplitPane(paneId, 'vertical') : undefined}
                disabled={!canSplit}
                aria-label={t('splitHorizontal')}
              >
                {isSplitting ? (
                  <Spinner className="h-3 w-3" />
                ) : (
                  <SplitHorizontalIcon className="h-3.5 w-3.5" />
                )}
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('splitHorizontalShortcut', { shortcut: `${mod}⇧D` })}</TooltipContent>
            </Tooltip>
            <ShortcutKey
              mac="⌘⇧D"
              other="^⇧D"
              className={cn(
                'absolute -right-0.5 -top-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-medium leading-none text-muted-foreground transition-opacity duration-200 pointer-events-none',
                showShortcuts ? 'opacity-100' : 'opacity-0',
              )}
            />
          </div>

          {paneCount >= 2 && (
            <div className="relative">
              <Tooltip>
                <TooltipTrigger
                  className="flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-foreground"
                  onClick={onEqualizeRatios}
                  aria-label={t('equalSplit')}
                >
                  <EqualizeIcon className="h-3.5 w-3.5" />
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('equalSplit')}</TooltipContent>
              </Tooltip>
              <ShortcutKey
                mac="⌘⌥="
                other="^⌥="
                className={cn(
                  'absolute -right-0.5 -top-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-medium leading-none text-muted-foreground transition-opacity duration-200 pointer-events-none',
                  showShortcuts ? 'opacity-100' : 'opacity-0',
                )}
              />
            </div>
          )}
        </div>
      </TooltipProvider>
      </div>
    </div>
  );
};

export default ContentHeader;

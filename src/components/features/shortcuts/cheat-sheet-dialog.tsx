import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Keyboard, RotateCcw, Search, X as XIcon } from 'lucide-react';
import {
  BsArrowDown,
  BsArrowLeft,
  BsArrowRight,
  BsArrowUp,
  BsCommand,
  BsOption,
  BsShift,
} from 'react-icons/bs';
import { PiControl } from 'react-icons/pi';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import useWorkspaceStore from '@/hooks/use-workspace-store';
import useKeybindingsStore, { useResolvedKey } from '@/hooks/use-keybindings-store';
import {
  ACTIONS,
  getActionIds,
  isActionEditable,
  type TActionCategory,
  type TActionId,
} from '@/lib/keyboard-shortcuts';
import {
  eventToHotkey,
  findConflict,
  getReservedWarning,
} from '@/lib/keybinding-helpers';
import { cn } from '@/lib/utils';

const CATEGORY_ORDER: TActionCategory[] = [
  'workspace',
  'tab',
  'pane',
  'panel',
  'view',
  'app',
];

const ICON_CLASS = 'h-2.5 w-2.5';
const PLATFORM_STORAGE_KEY = 'codexmux-shortcut-platform'; // product-name-allow: persisted browser preference

type TShortcutDisplayPlatform = 'windows' | 'mac';

const readDisplayPlatform = (): TShortcutDisplayPlatform => {
  if (typeof window === 'undefined') return 'windows';
  try {
    return localStorage.getItem(PLATFORM_STORAGE_KEY) === 'mac' ? 'mac' : 'windows';
  } catch {
    return 'windows';
  }
};

const saveDisplayPlatform = (platform: TShortcutDisplayPlatform) => {
  try {
    localStorage.setItem(PLATFORM_STORAGE_KEY, platform);
  } catch {
    // ignore storage failures
  }
};

const formatPlainKey = (key: string): string => {
  const lower = key.toLowerCase();
  if (lower === 'bracketleft') return '[';
  if (lower === 'bracketright') return ']';
  if (lower === 'comma') return ',';
  if (lower === 'period') return '.';
  if (lower === 'slash') return '/';
  if (lower === 'equal') return '=';
  if (lower === 'minus') return '-';
  if (lower === 'space') return 'Space';
  if (lower === 'enter' || lower === 'return') return 'Enter';
  if (lower === 'escape' || lower === 'esc') return 'Esc';
  if (lower === 'tab') return 'Tab';
  if (lower === 'backspace') return '⌫';
  if (/^[a-z]$/.test(lower)) return lower.toUpperCase();
  return key;
};

const renderHotkeyPart = (
  part: string,
  platform: TShortcutDisplayPlatform,
  key: number,
): ReactNode => {
  const isMac = platform === 'mac';
  const lower = part.toLowerCase();
  if (lower === 'meta' || lower === 'cmd' || lower === 'super') {
    return isMac ? (
      <BsCommand key={key} className={ICON_CLASS} />
    ) : (
      <span key={key}>Super</span>
    );
  }
  if (lower === 'ctrl' || lower === 'control') {
    return isMac ? (
      <PiControl key={key} className={ICON_CLASS} />
    ) : (
      <span key={key}>Ctrl</span>
    );
  }
  if (lower === 'alt' || lower === 'opt' || lower === 'option') {
    return isMac ? (
      <BsOption key={key} className={ICON_CLASS} />
    ) : (
      <span key={key}>Alt</span>
    );
  }
  if (lower === 'shift') {
    return isMac ? (
      <BsShift key={key} className={ICON_CLASS} />
    ) : (
      <span key={key}>Shift</span>
    );
  }
  if (lower === 'arrowup') return <BsArrowUp key={key} className={ICON_CLASS} />;
  if (lower === 'arrowdown') return <BsArrowDown key={key} className={ICON_CLASS} />;
  if (lower === 'arrowleft') return <BsArrowLeft key={key} className={ICON_CLASS} />;
  if (lower === 'arrowright') return <BsArrowRight key={key} className={ICON_CLASS} />;
  return <span key={key}>{formatPlainKey(part)}</span>;
};

const renderHotkey = (hotkey: string, platform: TShortcutDisplayPlatform): ReactNode[] => {
  const parts = hotkey.split('+').map((s) => s.trim()).filter(Boolean);
  return parts.map((p, i) => renderHotkeyPart(p, platform, i));
};

const KeyBadge = ({
  hotkey,
  displayLabel,
  platform,
  disabled,
  overridden,
  recording,
  className,
}: {
  hotkey: string | null;
  displayLabel?: string;
  platform: TShortcutDisplayPlatform;
  disabled?: boolean;
  overridden?: boolean;
  recording?: boolean;
  className?: string;
}) => {
  const t = useTranslations('shortcuts');

  if (recording) {
    return (
      <kbd
        className={cn(
          'inline-flex h-6 shrink-0 items-center rounded border border-primary/50 bg-primary/10 px-1.5 font-mono text-[11px] text-primary',
          className,
        )}
      >
        {t('recording')}
      </kbd>
    );
  }

  if (disabled || (!hotkey && !displayLabel)) {
    return (
      <kbd
        className={cn(
          'inline-flex h-6 shrink-0 items-center rounded border border-dashed border-border bg-transparent px-1.5 font-mono text-[11px] text-muted-foreground/60',
          className,
        )}
      >
        {t('disabled')}
      </kbd>
    );
  }

  if (displayLabel) {
    return (
      <kbd
        className={cn(
          'inline-flex h-6 shrink-0 items-center rounded border border-border bg-muted px-1.5 font-mono text-[11px] text-muted-foreground',
          className,
        )}
      >
        {displayLabel}
      </kbd>
    );
  }

  if (!hotkey) return null;

  const hotkeys = hotkey.split(',').map((s) => s.trim()).filter(Boolean);
  const rendered =
    hotkeys.length > 2
      ? [
          { key: 'first', tokens: renderHotkey(hotkeys[0], platform) },
          { key: 'sep', tokens: ['–'] as ReactNode[] },
          { key: 'last', tokens: renderHotkey(hotkeys[hotkeys.length - 1], platform) },
        ]
      : hotkeys.map((h, i) => ({ key: `h-${i}`, tokens: renderHotkey(h, platform) }));
  return (
    <kbd
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1 rounded border px-1.5 font-mono text-[11px]',
        overridden
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border bg-muted text-muted-foreground',
        className,
      )}
    >
      {rendered.map((group, idx) => (
        <Fragment key={group.key}>
          {idx > 0 && group.key !== 'sep' && <span className="mx-0.5">,</span>}
          <span className="inline-flex items-center gap-0.5">
            {group.tokens}
          </span>
        </Fragment>
      ))}
    </kbd>
  );
};

interface IActionRowProps {
  id: TActionId;
  isEditing: boolean;
  captured: string | null;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onCapture: (hotkey: string) => void;
  onSave: () => void;
  onDisable: () => void;
  onReset: () => void;
  displayPlatform: TShortcutDisplayPlatform;
}

const ActionRow = ({
  id,
  isEditing,
  captured,
  onStartEdit,
  onCancelEdit,
  onCapture,
  onSave,
  onDisable,
  onReset,
  displayPlatform,
}: IActionRowProps) => {
  const t = useTranslations('shortcuts');
  const action = ACTIONS[id];
  const resolved = useResolvedKey(id);
  const overridden = useKeybindingsStore(
    (s) => s.overrides[id] !== undefined,
  );
  const isDisabled = resolved === null;
  const editable = isActionEditable(id);
  const inputRef = useRef<HTMLDivElement>(null);
  const defaultDisplayLabel = !overridden && !isDisabled
    ? action.display[displayPlatform === 'mac' ? 'mac' : 'other']
    : undefined;

  const conflict = useMemo(
    () => (captured ? findConflict(captured, id) : null),
    [captured, id],
  );
  const reserved = useMemo(
    () => (captured ? getReservedWarning(captured) : null),
    [captured],
  );

  useEffect(() => {
    if (!isEditing || captured) return;
    inputRef.current?.focus();
  }, [isEditing, captured]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancelEdit();
      return;
    }
    const hotkey = eventToHotkey(e.nativeEvent);
    if (!hotkey) return;
    e.preventDefault();
    e.stopPropagation();
    onCapture(hotkey);
  };

  const actionMode: 'none' | 'reset' | 'disable' = !editable
    ? 'none'
    : overridden
    ? 'reset'
    : 'disable';

  const handleActionClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (actionMode === 'reset') onReset();
    else if (actionMode === 'disable') onDisable();
  };

  const actionTitle =
    actionMode === 'reset'
      ? t('resetToDefault')
      : actionMode === 'disable'
      ? t('disable')
      : t('notEditable');

  const ActionIcon = actionMode === 'reset' ? RotateCcw : XIcon;

  if (isEditing && !captured) {
    return (
      <li className="flex items-center gap-1 rounded">
        <div className="flex flex-1 items-center gap-2 px-2 py-1.5">
          <span className="truncate text-sm">{action.label}</span>
          <div
            ref={inputRef}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            className="ml-auto"
          >
            <KeyBadge
              hotkey={null}
              platform={displayPlatform}
              recording
              className="cursor-text outline-none ring-2 ring-primary/20"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={onCancelEdit}
          title={t('cancel')}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <XIcon className="h-3 w-3" />
        </button>
      </li>
    );
  }

  if (isEditing && captured) {
    return (
      <li className="flex flex-col gap-1 rounded">
        <div className="flex items-center gap-1 px-0">
          <div className="flex flex-1 items-center gap-2 px-2 py-1.5">
            <span className="truncate text-sm">{action.label}</span>
            <KeyBadge hotkey={captured} platform={displayPlatform} overridden className="ml-auto" />
          </div>
          <Button
            size="sm"
            variant="default"
            className="h-6 px-2 text-xs"
            onClick={onSave}
          >
            {conflict ? t('saveAnyway') : t('save')}
          </Button>
          <button
            type="button"
            onClick={onCancelEdit}
            title={t('cancel')}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <XIcon className="h-3 w-3" />
          </button>
        </div>
        {(conflict || reserved) && (
          <div className="flex flex-col gap-0.5 px-2 text-[11px]">
            {conflict && (
              <div className="flex items-center gap-1 text-amber-500">
                <AlertTriangle className="h-3 w-3" />
                {t('conflictWarning', { label: conflict.label })}
              </div>
            )}
            {reserved && (
              <div className="flex items-center gap-1 text-amber-500">
                <AlertTriangle className="h-3 w-3" />
                {t('reservedWarning', { reason: reserved })}
              </div>
            )}
          </div>
        )}
      </li>
    );
  }

  return (
    <li className="group flex items-center gap-1 rounded">
      <button
        type="button"
        onClick={editable ? onStartEdit : undefined}
        disabled={!editable}
        title={!editable ? t('notEditable') : undefined}
        className={cn(
          'flex flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
          editable
            ? 'cursor-pointer hover:bg-muted/50'
            : 'cursor-not-allowed opacity-70',
        )}
      >
        <span className="truncate">{action.label}</span>
        <KeyBadge
          hotkey={resolved}
          displayLabel={defaultDisplayLabel}
          platform={displayPlatform}
          disabled={isDisabled}
          overridden={overridden && !isDisabled}
          className="ml-auto"
        />
      </button>
      <button
        type="button"
        onClick={handleActionClick}
        disabled={actionMode === 'none'}
        title={actionTitle}
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-opacity',
          actionMode === 'none'
            ? 'opacity-20 cursor-not-allowed'
            : 'opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground',
        )}
      >
        <ActionIcon className="h-3 w-3" />
      </button>
    </li>
  );
};

const CheatSheetDialog = () => {
  const t = useTranslations('shortcuts');
  const open = useWorkspaceStore((s) => s.isCheatSheetOpen);
  const setOpen = useWorkspaceStore((s) => s.setCheatSheetOpen);
  const setBinding = useKeybindingsStore((s) => s.setBinding);
  const resetBinding = useKeybindingsStore((s) => s.resetBinding);
  const resetAll = useKeybindingsStore((s) => s.resetAll);
  const hasOverrides = useKeybindingsStore(
    (s) => Object.keys(s.overrides).length > 0,
  );

  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<TActionId | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [displayPlatform, setDisplayPlatform] = useState<TShortcutDisplayPlatform>(readDisplayPlatform);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const ids = getActionIds();
    const filtered = q
      ? ids.filter((id) => {
          const a = ACTIONS[id];
          return (
            a.label.toLowerCase().includes(q) ||
            id.toLowerCase().includes(q) ||
            a.display.mac.toLowerCase().includes(q) ||
            a.display.other.toLowerCase().includes(q)
          );
        })
      : ids;

    const map = new Map<TActionCategory, TActionId[]>();
    for (const id of filtered) {
      const category = ACTIONS[id].category;
      const list = map.get(category) ?? [];
      list.push(id);
      map.set(category, list);
    }
    return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({
      category: c,
      ids: map.get(c) ?? [],
    }));
  }, [query]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery('');
      setEditingId(null);
      setCaptured(null);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setCaptured(null);
  };

  const saveEdit = async () => {
    if (!editingId || !captured) return;
    await setBinding(editingId, captured);
    cancelEdit();
  };

  const handleDisplayPlatformChange = (next: TShortcutDisplayPlatform) => {
    setDisplayPlatform(next);
    saveDisplayPlatform(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-5xl p-0 gap-0">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2 pr-11">
          <Keyboard className="h-4 w-4 text-muted-foreground" />
          <DialogTitle className="text-sm font-medium">
            {t('title')}
          </DialogTitle>
          <div className="ml-auto flex items-center gap-2">
            <div
              role="group"
              aria-label={t('platformLabel')}
              className="inline-flex h-7 rounded-md bg-muted p-0.5"
            >
              {(['windows', 'mac'] as const).map((platform) => (
                <button
                  key={platform}
                  type="button"
                  aria-pressed={displayPlatform === platform}
                  onClick={() => handleDisplayPlatformChange(platform)}
                  className={cn(
                    'rounded px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
                    displayPlatform === platform && 'bg-background text-foreground shadow-sm',
                  )}
                >
                  {t(platform === 'windows' ? 'platformWindows' : 'platformMac')}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-7 text-xs',
                !hasOverrides && 'invisible',
              )}
              onClick={resetAll}
              disabled={!hasOverrides}
            >
              <RotateCcw className="h-3 w-3" />
              {t('resetAll')}
            </Button>
          </div>
        </div>

        <div className="px-4 pt-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>

        <div className="max-h-[min(70vh,520px)] overflow-y-auto px-4 py-3">
          {grouped.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {t('noResults', { query })}
            </p>
          ) : (
            <div className="columns-1 gap-x-6 md:columns-2 lg:columns-3">
              {grouped.map(({ category, ids }) => (
                <section
                  key={category}
                  className="mb-4 flex break-inside-avoid flex-col gap-1"
                >
                  <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t(`category.${category}`)}
                  </h3>
                  <ul className="flex flex-col">
                    {ids.map((id) => (
                      <ActionRow
                        key={id}
                        id={id}
                        isEditing={editingId === id}
                        captured={editingId === id ? captured : null}
                        onStartEdit={() => {
                          setEditingId(id);
                          setCaptured(null);
                        }}
                        onCancelEdit={cancelEdit}
                        onCapture={(hotkey) => setCaptured(hotkey)}
                        onSave={saveEdit}
                        onDisable={() => setBinding(id, null)}
                        onReset={() => resetBinding(id)}
                        displayPlatform={displayPlatform}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CheatSheetDialog;

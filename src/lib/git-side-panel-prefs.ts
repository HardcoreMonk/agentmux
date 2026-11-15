export const GIT_SIDE_PANEL_DEFAULT_SIZE = 35;
export const GIT_SIDE_PANEL_MIN_SIZE = 20;
export const GIT_SIDE_PANEL_MAX_SIZE = 60;

export interface IGitSidePanelPrefs {
  open: boolean;
  size: number;
}

const getStorageKey = (workspaceId: string): string => `agentmux:git-side-panel:${workspaceId}`;

const defaultPrefs = (): IGitSidePanelPrefs => ({
  open: false,
  size: GIT_SIDE_PANEL_DEFAULT_SIZE,
});

export const clampGitSidePanelSize = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return GIT_SIDE_PANEL_DEFAULT_SIZE;
  }
  return Math.min(GIT_SIDE_PANEL_MAX_SIZE, Math.max(GIT_SIDE_PANEL_MIN_SIZE, value));
};

export const readGitSidePanelPrefs = (
  workspaceId: string,
  storage?: Pick<Storage, 'getItem'> | null,
): IGitSidePanelPrefs => {
  try {
    const resolved = storage === undefined
      ? (typeof window !== 'undefined' ? window.localStorage : null)
      : storage;
    if (!resolved) return defaultPrefs();
    const raw = resolved.getItem(getStorageKey(workspaceId));
    if (!raw) return defaultPrefs();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaultPrefs();
    const record = parsed as Record<string, unknown>;
    return {
      open: typeof record.open === 'boolean' ? record.open : false,
      size: clampGitSidePanelSize(record.size),
    };
  } catch {
    return defaultPrefs();
  }
};

export const writeGitSidePanelPrefs = (
  workspaceId: string,
  prefs: IGitSidePanelPrefs,
  storage?: Pick<Storage, 'setItem'> | null,
): void => {
  try {
    const resolved = storage === undefined
      ? (typeof window !== 'undefined' ? window.localStorage : null)
      : storage;
    if (!resolved) return;
    resolved.setItem(
      getStorageKey(workspaceId),
      JSON.stringify({
        open: Boolean(prefs.open),
        size: clampGitSidePanelSize(prefs.size),
      }),
    );
  } catch {
    // Ignore storage access or quota failures.
  }
};

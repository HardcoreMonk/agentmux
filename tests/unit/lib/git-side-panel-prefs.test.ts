import { describe, expect, it } from 'vitest';
import {
  clampGitSidePanelSize,
  GIT_SIDE_PANEL_DEFAULT_SIZE,
  GIT_SIDE_PANEL_MAX_SIZE,
  GIT_SIDE_PANEL_MIN_SIZE,
  readGitSidePanelPrefs,
  writeGitSidePanelPrefs,
} from '@/lib/git-side-panel-prefs';

const makeFakeStorage = (initial: Record<string, string> = {}) => {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    dump: () => Object.fromEntries(map.entries()),
  };
};

describe('git-side-panel-prefs', () => {
  it('returns default prefs when storage is empty or missing', () => {
    const storage = makeFakeStorage();
    expect(readGitSidePanelPrefs('ws-1', storage)).toEqual({
      open: false,
      size: GIT_SIDE_PANEL_DEFAULT_SIZE,
    });
    expect(readGitSidePanelPrefs('ws-1', null)).toEqual({
      open: false,
      size: GIT_SIDE_PANEL_DEFAULT_SIZE,
    });
  });

  it('returns default prefs when stored JSON is malformed or open is not boolean', () => {
    const broken = makeFakeStorage({ 'agentmux:git-side-panel:ws-1': '{not-json' });
    expect(readGitSidePanelPrefs('ws-1', broken)).toEqual({
      open: false,
      size: GIT_SIDE_PANEL_DEFAULT_SIZE,
    });

    const nonBooleanOpen = makeFakeStorage({
      'agentmux:git-side-panel:ws-1': JSON.stringify({ open: 'yes', size: 42 }),
    });
    expect(readGitSidePanelPrefs('ws-1', nonBooleanOpen)).toEqual({
      open: false,
      size: 42,
    });
  });

  it('clamps size to bounds and falls back to default for non-finite values', () => {
    expect(clampGitSidePanelSize(90)).toBe(GIT_SIDE_PANEL_MAX_SIZE);
    expect(clampGitSidePanelSize(5)).toBe(GIT_SIDE_PANEL_MIN_SIZE);
    expect(clampGitSidePanelSize('x')).toBe(GIT_SIDE_PANEL_DEFAULT_SIZE);
    expect(clampGitSidePanelSize(NaN)).toBe(GIT_SIDE_PANEL_DEFAULT_SIZE);
    expect(clampGitSidePanelSize(Infinity)).toBe(GIT_SIDE_PANEL_DEFAULT_SIZE);
  });

  it('round-trips prefs through write and read with clamping', () => {
    const storage = makeFakeStorage();
    writeGitSidePanelPrefs('ws-1', { open: true, size: 45 }, storage);
    expect(readGitSidePanelPrefs('ws-1', storage)).toEqual({ open: true, size: 45 });

    writeGitSidePanelPrefs('ws-1', { open: true, size: 99 }, storage);
    expect(readGitSidePanelPrefs('ws-1', storage)).toEqual({
      open: true,
      size: GIT_SIDE_PANEL_MAX_SIZE,
    });
  });

  it('tolerates throwing storage on read and write', () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota exceeded');
      },
    };
    expect(readGitSidePanelPrefs('ws-1', throwingStorage)).toEqual({
      open: false,
      size: GIT_SIDE_PANEL_DEFAULT_SIZE,
    });
    expect(() =>
      writeGitSidePanelPrefs('ws-1', { open: true, size: 40 }, throwingStorage),
    ).not.toThrow();
  });
});

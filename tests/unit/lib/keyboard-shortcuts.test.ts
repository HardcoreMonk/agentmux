import { describe, expect, it } from 'vitest';

import {
  ACTIONS,
  isAppShortcut,
  isTerminalEofShortcut,
  parseHotkeyToEventCode,
} from '@/lib/keyboard-shortcuts';

const keyEvent = (overrides: Partial<KeyboardEvent>): KeyboardEvent => ({
  type: 'keydown',
  key: 'd',
  code: 'KeyD',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
} as KeyboardEvent);

describe('keyboard shortcuts', () => {
  it('treats plain Ctrl+D as terminal EOF input', () => {
    expect(isTerminalEofShortcut(keyEvent({ ctrlKey: true }))).toBe(true);
  });

  it('does not treat modified Ctrl+D variants as terminal EOF input', () => {
    expect(isTerminalEofShortcut(keyEvent({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isTerminalEofShortcut(keyEvent({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isTerminalEofShortcut(keyEvent({ ctrlKey: true, metaKey: true }))).toBe(false);
    expect(isTerminalEofShortcut(keyEvent({ type: 'keyup', ctrlKey: true }))).toBe(false);
  });

  it('keeps Linux and Windows split-right away from Ctrl+D by default', () => {
    expect(ACTIONS['pane.split_right'].defaultKey).toBe('ctrl+alt+d');
    expect(parseHotkeyToEventCode(ACTIONS['pane.split_right'].defaultKey)).toBe('ctrl+alt+KeyD');
    expect(isAppShortcut(keyEvent({ ctrlKey: true }))).toBe(false);
    expect(isAppShortcut(keyEvent({ ctrlKey: true, altKey: true }))).toBe(true);
  });

  it('gives every action a unique default key and binds Claude mode to mod+shift+l', () => {
    const keys = Object.values(ACTIONS).map((action) => action.defaultKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(ACTIONS['view.mode_claude'].defaultKey).toMatch(/\+shift\+l$/);
    expect(ACTIONS['view.mode_claude'].display).toEqual({ mac: '⌘⇧L', other: 'Ctrl+Shift+L' });
  });
});

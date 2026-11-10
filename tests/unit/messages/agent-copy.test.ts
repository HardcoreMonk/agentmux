import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readJson = (path: string) => JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf-8'));

const getPath = (obj: Record<string, unknown>, path: string): unknown =>
  path.split('.').reduce<unknown>((acc, key) => (acc as Record<string, unknown> | undefined)?.[key], obj);

// [namespace file, dotted key, extra placeholders]
const AGENT_KEYS: Array<[string, string, string[]]> = [
  ['terminal', 'interruptDescription', []],
  ['terminal', 'inputDisabledPlaceholder', []],
  ['terminal', 'inputAriaLabel', []],
  ['terminal', 'agentConnecting', []],
  ['terminal', 'attachmentNotConfirmed', []],
  ['timeline', 'installAgent', []],
  ['timeline', 'installAgentHint', ['{path}']],
  ['timeline', 'timelineAria', []],
  ['timeline', 'richNotice', []],
  ['session', 'empty.startNewSession', []],
  ['diff', 'askAgent', []],
  ['settings', 'notification.enableDescription', []],
];

const REMOVED_KEYS: Array<[string, string]> = [
  ['terminal', 'switchToCodexMode'],
  ['terminal', 'resumingSession'],
  ['terminal', 'creatingConversation'],
  ['timeline', 'installCodex'],
  ['timeline', 'installCodexHint'],
  ['timeline', 'notRunningTitle'],
  ['timeline', 'notRunningHint'],
  ['timeline', 'notRunningHint2'],
  ['diff', 'askCodex'],
  ['onboarding', 'skipPermissionsDescription'],
];

describe('agent-neutral copy', () => {
  for (const locale of ['ko', 'en'] as const) {
    for (const [file, key, extra] of AGENT_KEYS) {
      it(`${locale}/${file}.${key} names the active agent`, () => {
        const value = getPath(readJson(`messages/${locale}/${file}.json`), key);
        expect(value).toBeTypeOf('string');
        expect(value).toContain('{agent}');
        for (const placeholder of extra) expect(value).toContain(placeholder);
      });
    }

    for (const [file, key] of REMOVED_KEYS) {
      it(`${locale}/${file}.${key} is removed`, () => {
        expect(getPath(readJson(`messages/${locale}/${file}.json`), key)).toBeUndefined();
      });
    }
  }
});

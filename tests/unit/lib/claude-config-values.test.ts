import { describe, expect, it } from 'vitest';

import {
  CLAUDE_PERMISSION_MODES,
  isClaudePermissionMode,
  isValidClaudeModel,
} from '@/lib/claude-config-values';

describe('claude config values', () => {
  it('lists the six permission modes', () => {
    expect([...CLAUDE_PERMISSION_MODES]).toEqual(['acceptEdits', 'auto', 'bypassPermissions', 'manual', 'dontAsk', 'plan']);
    expect(isClaudePermissionMode('plan')).toBe(true);
    expect(isClaudePermissionMode('Plan')).toBe(false);
    expect(isClaudePermissionMode(null)).toBe(false);
  });

  it('accepts model names and null, rejects unsafe ones', () => {
    expect(isValidClaudeModel('claude-sonnet-4.5')).toBe(true);
    expect(isValidClaudeModel('opus:1m')).toBe(true);
    expect(isValidClaudeModel(null)).toBe(true);
    expect(isValidClaudeModel('')).toBe(false);
    expect(isValidClaudeModel('a'.repeat(129))).toBe(false);
    expect(isValidClaudeModel('sonnet; rm -rf ~')).toBe(false);
    expect(isValidClaudeModel(42)).toBe(false);
  });
});

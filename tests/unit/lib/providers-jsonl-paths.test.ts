import { describe, expect, it } from 'vitest';
import { codexProvider } from '@/lib/providers/codex';
import { isAllowedAgentJsonlPath } from '@/lib/providers';

const homeDir = '/home/test';

describe('isAllowedAgentJsonlPath', () => {
  it('allows JSONL files under the Codex sessions root', () => {
    expect(isAllowedAgentJsonlPath('/home/test/.codex/sessions/2026/11/10/rollout-a.jsonl', homeDir)).toBe(true);
  });

  it('rejects traversal, non-jsonl files and the root itself', () => {
    expect(isAllowedAgentJsonlPath('/home/test/.codex/sessions/../secret.jsonl', homeDir)).toBe(false);
    expect(isAllowedAgentJsonlPath('/home/test/.codex/sessions/2026/a.json', homeDir)).toBe(false);
    expect(isAllowedAgentJsonlPath('/home/test/.codex/sessions', homeDir)).toBe(false);
  });

  it('allows JSONL files under the Claude projects root', () => {
    expect(isAllowedAgentJsonlPath('/home/test/.claude/projects/x/a.jsonl', homeDir)).toBe(true);
    expect(isAllowedAgentJsonlPath('/home/test/.claude/settings.jsonl', homeDir)).toBe(false);
  });

  it('exposes the Codex JSONL root', () => {
    expect(codexProvider.jsonlRoots('/home/test')).toEqual(['/home/test/.codex/sessions']);
  });
});

import { describe, expect, it } from 'vitest';
import { extractClaudeUserPromptText, isClaudeUserPrompt } from '@/lib/providers/claude/user-prompt';

const user = (content: unknown, extra: Record<string, unknown> = {}) => ({
  type: 'user',
  message: { role: 'user', content },
  ...extra,
});

describe('claude user prompt', () => {
  it('accepts string and text piece prompts', () => {
    expect(isClaudeUserPrompt(user('hello'))).toBe(true);
    expect(isClaudeUserPrompt(user([{ type: 'text', text: 'hello' }]))).toBe(true);
    expect(extractClaudeUserPromptText(user([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]))).toBe('ab');
  });

  it('rejects tool results, meta and sidechain lines', () => {
    expect(isClaudeUserPrompt(user([{ type: 'tool_result', tool_use_id: 't', content: 'x' }]))).toBe(false);
    expect(isClaudeUserPrompt(user('hello', { isMeta: true }))).toBe(false);
    expect(isClaudeUserPrompt(user('hello', { isSidechain: true }))).toBe(false);
  });

  it('rejects command wrapper messages', () => {
    expect(isClaudeUserPrompt(user('<command-name>/clear</command-name>'))).toBe(false);
    expect(isClaudeUserPrompt(user('<local-command-stdout>ok</local-command-stdout>'))).toBe(false);
    expect(isClaudeUserPrompt(user([{ type: 'text', text: '<local-command-caveat>x</local-command-caveat>' }]))).toBe(false);
  });

  it('rejects assistant lines and non-objects', () => {
    expect(isClaudeUserPrompt({ type: 'assistant', message: { content: 'hi' } })).toBe(false);
    expect(isClaudeUserPrompt(null)).toBe(false);
    expect(extractClaudeUserPromptText('x')).toBeNull();
  });
});

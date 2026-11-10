import { describe, expect, it } from 'vitest';
import { buildClaudeLaunchCommand, buildClaudeResumeCommand, isValidClaudeSessionId } from '@/lib/claude-command';
import { getClaudeProjectsDir } from '@/lib/path-validation';

const id = '11111111-2222-4333-8444-555555555555';

describe('claude command', () => {
  it('validates UUID session ids', () => {
    expect(isValidClaudeSessionId(id)).toBe(true);
    expect(isValidClaudeSessionId('not-a-uuid')).toBe(false);
    expect(isValidClaudeSessionId(undefined)).toBe(false);
  });

  it('builds the launch command with a quoted settings path', () => {
    expect(buildClaudeLaunchCommand(id, { settingsPath: '/tmp/a b/s.json' }))
      .toBe(`claude --settings '/tmp/a b/s.json' --session-id ${id}`);
  });

  it('appends model and permission mode in order', () => {
    expect(buildClaudeLaunchCommand(id, { settingsPath: '/s.json', model: "o'pus", permissionMode: 'plan' }))
      .toBe(`claude --settings '/s.json' --session-id ${id} --model 'o'\\''pus' --permission-mode plan`);
  });

  it('builds the resume command with --resume', () => {
    expect(buildClaudeResumeCommand(id, { settingsPath: '/s.json' }))
      .toBe(`claude --settings '/s.json' --resume ${id}`);
  });

  it('throws for an invalid session id', () => {
    expect(() => buildClaudeLaunchCommand('x; rm -rf /', { settingsPath: '/s.json' })).toThrow();
    expect(() => buildClaudeResumeCommand('bad', { settingsPath: '/s.json' })).toThrow();
  });

  it('resolves the projects directory under the given home', () => {
    expect(getClaudeProjectsDir('/home/test')).toBe('/home/test/.claude/projects');
  });
});

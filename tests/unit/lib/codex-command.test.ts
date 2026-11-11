import { describe, expect, it } from 'vitest';

import {
  buildCodexLaunchCommand,
  buildCodexResumeCommand,
  isValidCodexThreadId,
} from '@/lib/codex-command';

const threadId = '019dcf1f-3a02-73a0-a79e-8703b99a2f30';

describe('codex command helpers', () => {
  it('validates Codex thread ids', () => {
    expect(isValidCodexThreadId('019dcf1f-3a02-73a0-a79e-8703b99a2f30')).toBe(true);
    expect(isValidCodexThreadId('latest')).toBe(false);
    expect(isValidCodexThreadId(null)).toBe(false);
  });

  it('builds a launch command with common runtime options', () => {
    expect(buildCodexLaunchCommand({
      cwd: '/tmp/my project',
      model: 'gpt-5.5',
      sandbox: 'danger-full-access',
      approvalPolicy: 'on-request',
      search: true,
    })).toBe(
      "codex --cd '/tmp/my project' --model 'gpt-5.5' --sandbox danger-full-access --ask-for-approval on-request --search",
    );
  });

  it('adds only explicitly supplied native session-layer hooks', () => {
    expect(buildCodexLaunchCommand({ hookConfigs: ['hooks.Stop=[]'] }))
      .toBe("codex -c 'hooks.Stop=[]'");
  });

  it('builds a resume command for a valid thread id', () => {
    expect(buildCodexResumeCommand('019dcf1f-3a02-73a0-a79e-8703b99a2f30', {
      cwd: '/work',
    })).toBe(
      "codex resume 019dcf1f-3a02-73a0-a79e-8703b99a2f30 --cd '/work'",
    );
  });

  it('keeps the command unchanged without delegation values', () => {
    expect(buildCodexLaunchCommand({ hookConfigs: ['hooks.Stop=[]'], model: 'gpt-5.5' }))
      .toBe("codex -c 'hooks.Stop=[]' --model 'gpt-5.5'");
    expect(buildCodexResumeCommand(threadId, { hookConfigs: ['hooks.Stop=[]'] }))
      .toBe(`codex -c 'hooks.Stop=[]' resume ${threadId}`);
  });

  it('adds developer_instructions as a TOML string after the hook configs', () => {
    const options = { hookConfigs: ['hooks.Stop=[]'], developerInstructions: "a'b\nc", model: 'gpt-5.5' };
    expect(buildCodexLaunchCommand(options)).toBe(
      `codex -c 'hooks.Stop=[]' -c 'developer_instructions="a'\\''b\\nc"' --model 'gpt-5.5'`,
    );
    expect(buildCodexResumeCommand(threadId, options)).toBe(
      `codex -c 'hooks.Stop=[]' -c 'developer_instructions="a'\\''b\\nc"' resume ${threadId} --model 'gpt-5.5'`,
    );
  });

  it('prefixes the env vars', () => {
    const envPrefix = `AMUX_WORKSPACE_ID='ws-1' AMUX_TAB_ID='tab-1' PATH='/d/bin':"$PATH" `;
    expect(buildCodexLaunchCommand({ envPrefix })).toBe(`${envPrefix}codex`);
    expect(buildCodexResumeCommand(threadId, { envPrefix })).toBe(`${envPrefix}codex resume ${threadId}`);
  });

  it('rejects invalid resume ids', () => {
    expect(() => buildCodexResumeCommand('last')).toThrow(/Invalid Codex thread ID/);
  });
});

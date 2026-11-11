import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getSessionCwd: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/lib/config-store', () => ({ getConfig: mocks.getConfig }));
vi.mock('@/lib/cli-token', () => ({ getCliToken: () => 'test-token' }));
vi.mock('@/lib/tmux', () => ({ getSessionCwd: mocks.getSessionCwd }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: mocks.warn, error: vi.fn() }),
}));

import { buildCodexLaunchCommand, buildCodexResumeCommand, CODEX_COMMAND_SAFE_BYTES } from '@/lib/codex-command';
import { buildDelegationGuide } from '@/lib/delegation-guide';
import { codexProvider } from '@/lib/providers/codex';
import { buildCodexSessionHookConfigs } from '@/lib/providers/codex/session-hooks';

const threadId = '019dcf1f-3a02-73a0-a79e-8703b99a2f30';
const tab = { workspaceId: 'ws-1', tabId: 'tab-1', sessionName: 'pt-ws-1-pane-1-tab-1' };

let root: string;
let codexHome: string;
let project: string;

const writeConfig = async (dir: string, content: string): Promise<void> => {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'config.toml'), content);
};

const quotedConfig = (value: string): string =>
  `'developer_instructions=${JSON.stringify(value).replace(/'/g, `'\\''`)}'`;

describe('codex provider launch command', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmux-codex-launch-'));
    codexHome = path.join(root, 'codex-home');
    project = path.join(root, 'project');
    await fs.mkdir(codexHome);
    await fs.mkdir(project);
    vi.stubEnv('HOME', root);
    vi.stubEnv('AGENTMUX_DATA_DIR', path.join(root, 'data'));
    vi.stubEnv('CODEX_HOME', codexHome);
    mocks.getConfig.mockResolvedValue({});
    mocks.getSessionCwd.mockResolvedValue(project);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('builds the previous command when delegation is off', async () => {
    mocks.getConfig.mockResolvedValue({ agentDelegationGuideEnabled: false });
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-11T00:00:00Z') });
    const expectedOptions = { search: false, hookConfigs: buildCodexSessionHookConfigs(tab) };

    const launch = await codexProvider.buildLaunchCommand({ ...tab, cwd: project });
    const resume = await codexProvider.buildResumeCommand(threadId, { ...tab, cwd: project });

    expect(launch).toBe(buildCodexLaunchCommand(expectedOptions));
    expect(resume).toBe(buildCodexResumeCommand(threadId, expectedOptions));
    for (const command of [launch, resume]) {
      expect(command).not.toContain('--cd');
      expect(command).not.toContain('AMUX_');
      expect(command).not.toContain('developer_instructions');
    }
  });

  it('appends the guide to the user value on an auto-resume launch', async () => {
    await writeConfig(codexHome, 'developer_instructions = "user rule"\n');

    const command = await codexProvider.buildResumeCommand(threadId, tab);

    expect(mocks.getSessionCwd).toHaveBeenCalledWith(tab.sessionName);
    expect(command.startsWith(`AMUX_WORKSPACE_ID='ws-1' AMUX_TAB_ID='tab-1' PATH=`)).toBe(true);
    expect(command).toContain(`${quotedConfig(`user rule\n\n${buildDelegationGuide('codex')}`)} resume ${threadId}`);
    expect(command).not.toContain('--cd');
  });

  it('never copies a project value found from the session cwd into the command', async () => {
    await writeConfig(codexHome, 'developer_instructions = "project rule"\n');
    await writeConfig(path.join(project, '.codex'), 'developer_instructions = "project rule"\n');

    const command = await codexProvider.buildResumeCommand(threadId, tab);

    expect(mocks.getSessionCwd).toHaveBeenCalledWith(tab.sessionName);
    expect(command).toContain("AMUX_TAB_ID='tab-1'");
    expect(command).not.toContain('developer_instructions');
    expect(command).not.toContain('project rule');
    expect(mocks.warn).toHaveBeenCalledWith(
      `codex developer_instructions project-defined: delegation guide skipped (${path.join(project, '.codex', 'config.toml')})`,
    );
  });

  it('uses the given cwd without asking tmux and never passes it as --cd', async () => {
    const command = await codexProvider.buildLaunchCommand({ ...tab, cwd: project });

    expect(mocks.getSessionCwd).not.toHaveBeenCalled();
    expect(command).toContain(quotedConfig(buildDelegationGuide('codex')));
    expect(command).not.toContain('--cd');
  });

  it('keeps the env vars but skips the guide when the cwd is unknown', async () => {
    mocks.getSessionCwd.mockResolvedValue(null);

    const command = await codexProvider.buildResumeCommand(threadId, tab);

    expect(command).toContain("AMUX_TAB_ID='tab-1'");
    expect(command).not.toContain('developer_instructions');
    expect(mocks.warn).toHaveBeenCalled();
  });

  it('skips the guide when the existing value is ambiguous', async () => {
    await writeConfig(codexHome, 'profile = "p"\ndeveloper_instructions = "user rule"\n\n[profiles.p]\ndeveloper_instructions = "x"\n');

    const command = await codexProvider.buildLaunchCommand(tab);

    expect(command).toContain("AMUX_TAB_ID='tab-1'");
    expect(command).not.toContain('developer_instructions');
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^codex developer_instructions ambiguous: delegation guide skipped/),
    );
  });

  it('drops the guide when the command would be too long for tmux', async () => {
    await writeConfig(codexHome, `developer_instructions = "${'x'.repeat(13 * 1024)}"\n`);

    const command = await codexProvider.buildLaunchCommand(tab);

    expect(command).toContain("AMUX_TAB_ID='tab-1'");
    expect(command).not.toContain('developer_instructions');
    expect(Buffer.byteLength(command)).toBeLessThanOrEqual(CODEX_COMMAND_SAFE_BYTES);
    expect(mocks.warn).toHaveBeenCalled();
  });
});

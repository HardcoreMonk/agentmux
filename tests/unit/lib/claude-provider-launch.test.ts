import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/lib/config-store', () => ({ getConfig: mocks.getConfig }));
vi.mock('@/lib/cli-token', () => ({ getCliToken: () => 'test-token' }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: mocks.warn, error: vi.fn() }),
}));

import { buildClaudeLaunchCommand } from '@/lib/claude-command';
import { buildDelegationGuide } from '@/lib/delegation-guide';
import { buildHookSettings } from '@/lib/hook-settings';
import { claudeProvider } from '@/lib/providers/claude';
import { getClaudeTabSettingsPath } from '@/lib/providers/claude/tab-settings';

const sessionId = '11111111-2222-4333-8444-555555555555';
const resumeOptions = { workspaceId: 'ws-1', tabId: 'tab-1', sessionName: 'pt-ws-1-pane-1-tab-1' };

let root: string;
let dataDir: string;

const readSettings = async (): Promise<Record<string, unknown>> =>
  JSON.parse(await fs.readFile(getClaudeTabSettingsPath('tab-1'), 'utf-8')) as Record<string, unknown>;

describe('claude provider launch command', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmux-claude-launch-'));
    dataDir = path.join(root, 'data');
    await fs.mkdir(dataDir);
    vi.stubEnv('HOME', root);
    vi.stubEnv('AGENTMUX_DATA_DIR', dataDir);
    await fs.writeFile(path.join(dataDir, 'hooks.json'), `${JSON.stringify(buildHookSettings(), null, 2)}\n`);
    mocks.getConfig.mockResolvedValue({});
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.chmod(path.join(dataDir, 'delegation'), 0o700).catch(() => undefined);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('creates the delegation assets and attaches them on an auto-resume launch', async () => {
    const command = await claudeProvider.buildResumeCommand(sessionId, resumeOptions);

    const guidePath = path.join(dataDir, 'delegation', 'claude.md');
    expect(await fs.readFile(guidePath, 'utf-8')).toBe(buildDelegationGuide('claude'));
    expect(await fs.readFile(path.join(dataDir, 'bin', 'agentmux'), 'utf-8')).toContain('agentmux.js');
    expect(command.startsWith(`AMUX_WORKSPACE_ID='ws-1' AMUX_TAB_ID='tab-1' PATH='${path.join(dataDir, 'bin')}':"$PATH" claude `))
      .toBe(true);
    expect(command).toContain(`--session-id ${sessionId} --append-system-prompt-file '${guidePath}'`);
    expect(await readSettings()).toHaveProperty('permissions.allow');
  });

  it('leaves out the guide file when it cannot be written', async () => {
    await fs.mkdir(path.join(dataDir, 'delegation'), { mode: 0o500 });

    const command = await claudeProvider.buildResumeCommand(sessionId, resumeOptions);

    expect(command).toContain("AMUX_TAB_ID='tab-1'");
    expect(command).not.toContain('--append-system-prompt-file');
    expect(mocks.warn).toHaveBeenCalled();
  });

  it('builds the previous command when delegation is off', async () => {
    mocks.getConfig.mockResolvedValue({ agentDelegationGuideEnabled: false });

    const command = await claudeProvider.buildLaunchCommand({ ...resumeOptions, sessionId });

    expect(command).toBe(buildClaudeLaunchCommand(sessionId, { settingsPath: getClaudeTabSettingsPath('tab-1') }));
    expect(command).toBe(`claude --settings '${getClaudeTabSettingsPath('tab-1')}' --session-id ${sessionId}`);
    expect(await readSettings()).not.toHaveProperty('permissions');
    await expect(fs.access(path.join(dataDir, 'bin'))).rejects.toThrow();
  });

  it('adds nothing for delegation without a workspace id', async () => {
    const command = await claudeProvider.buildLaunchCommand({ tabId: 'tab-1', sessionName: 'pt-x', sessionId });

    expect(command.startsWith('claude --settings ')).toBe(true);
    expect(command).not.toContain('--append-system-prompt-file');
    expect(await readSettings()).not.toHaveProperty('permissions');
  });
});

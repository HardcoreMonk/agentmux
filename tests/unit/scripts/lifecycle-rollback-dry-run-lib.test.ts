import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { describe, expect, it } from 'vitest';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/lifecycle-rollback-dry-run-lib.mjs')).href);

const createDropIn = async (content: string) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-rollback-dry-run-'));
  const filePath = path.join(dir, 'runtime-v2-shadow.conf');
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
};

describe('lifecycle rollback dry-run helper', () => {
  it('resolves the default drop-in path under agentmux.service.d', async () => {
    const { getDefaultRuntimeDropInPath } = await loadLib();

    expect(getDefaultRuntimeDropInPath('/home/tester')).toBe(
      path.join('/home/tester', '.config', 'systemd', 'user', 'agentmux.service.d', 'runtime-v2-shadow.conf'),
    );
  });

  it('parses runtime environment values from a systemd drop-in', async () => {
    const { parseRuntimeDropIn } = await loadLib();

    expect(parseRuntimeDropIn([
      '[Service]',
      'Environment=AGENTMUX_RUNTIME_V2=1',
      'Environment=CODEXMUX_RUNTIME_STORAGE_V2_MODE=default',
      'Environment=PATH=/usr/bin',
    ].join('\n'))).toEqual({
      AGENTMUX_RUNTIME_V2: '1',
      CODEXMUX_RUNTIME_STORAGE_V2_MODE: 'default',
    });
  });

  it('returns a no-mutation rollback plan with explicit runtime-off environment', async () => {
    const { buildLifecycleRollbackDryRun, runtimeV2RollbackEnv } = await loadLib();
    const dropInPath = await createDropIn([
      '[Service]',
      'Environment=AGENTMUX_RUNTIME_V2=1',
      'Environment=AGENTMUX_RUNTIME_TERMINAL_V2_MODE=new-tabs',
      'Environment=CODEXMUX_RUNTIME_STORAGE_V2_MODE=default',
      'Environment=CODEXMUX_RUNTIME_TIMELINE_V2_MODE=default',
      'Environment=CODEXMUX_RUNTIME_STATUS_V2_MODE=default',
    ].join('\n'));

    expect(runtimeV2RollbackEnv).toEqual({
      AGENTMUX_RUNTIME_V2: '0',
      AGENTMUX_RUNTIME_TERMINAL_V2_MODE: 'off',
      AGENTMUX_RUNTIME_STORAGE_V2_MODE: 'off',
      AGENTMUX_RUNTIME_TIMELINE_V2_MODE: 'off',
      AGENTMUX_RUNTIME_STATUS_V2_MODE: 'off',
    });

    await expect(buildLifecycleRollbackDryRun({ dropInPath })).resolves.toMatchObject({
      service: 'agentmux.service',
      dropInExists: true,
      runtimeEnv: {
        AGENTMUX_RUNTIME_V2: '1',
        CODEXMUX_RUNTIME_STORAGE_V2_MODE: 'default',
      },
      rollbackEnv: runtimeV2RollbackEnv,
      commands: [
        `rm ${dropInPath}`,
        'systemctl --user daemon-reload',
        'systemctl --user restart agentmux.service',
      ],
      mutates: false,
      warnings: [],
    });
  });

  it('still returns rollback environment when the drop-in is absent', async () => {
    const { buildLifecycleRollbackDryRun, runtimeV2RollbackEnv } = await loadLib();

    await expect(buildLifecycleRollbackDryRun({
      dropInPath: path.join(os.tmpdir(), 'codexmux-missing-runtime-v2-shadow.conf'),
    })).resolves.toMatchObject({
      service: 'agentmux.service',
      dropInExists: false,
      rollbackEnv: runtimeV2RollbackEnv,
      commands: [
        'systemctl --user daemon-reload',
        'systemctl --user restart agentmux.service',
      ],
      mutates: false,
      warnings: ['runtime drop-in not found; rollback may already be applied'],
    });
  });
});

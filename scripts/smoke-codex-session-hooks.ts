import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';
import { getShellPath } from '@/lib/preflight';
import { buildCodexSessionHookConfigs } from '@/lib/providers/codex/session-hooks';

const execFile = promisify(execFileCallback);

const main = async (): Promise<void> => {
  const hookConfigs = buildCodexSessionHookConfigs();
  const resolvedPath = await getShellPath();

  await execFile('codex', [
    '--strict-config',
    ...hookConfigs.flatMap((config) => ['-c', config]),
    'doctor',
    '--summary',
  ], {
    env: {
      ...process.env,
      PATH: resolvedPath,
      Path: resolvedPath,
    },
    timeout: 15_000,
    windowsHide: true,
  });

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'session-hook-config-schema',
      'posix-command',
      'windows-command',
    ],
  }, null, 2));
};

main().catch(() => {
  console.error('Codex session hook strict-config smoke failed.');
  process.exit(1);
});

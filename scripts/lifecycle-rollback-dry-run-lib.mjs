import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const runtimeEnvRe = /^Environment=((?:AGENTMUX|CODEXMUX)_RUNTIME_[A-Z0-9_]+)=(.*)$/;

export const runtimeV2RollbackEnv = {
  AGENTMUX_RUNTIME_V2: '0',
  AGENTMUX_RUNTIME_TERMINAL_V2_MODE: 'off',
  AGENTMUX_RUNTIME_STORAGE_V2_MODE: 'off',
  AGENTMUX_RUNTIME_TIMELINE_V2_MODE: 'off',
  AGENTMUX_RUNTIME_STATUS_V2_MODE: 'off',
};

export const getDefaultRuntimeDropInPath = (homeDir = os.homedir()) =>
  path.join(homeDir, '.config', 'systemd', 'user', 'agentmux.service.d', 'runtime-v2-shadow.conf');

export const parseRuntimeDropIn = (content) => {
  const env = {};
  for (const line of content.split('\n')) {
    const match = line.trim().match(runtimeEnvRe);
    if (match) env[match[1]] = match[2];
  }
  return env;
};

export const buildLifecycleRollbackDryRun = async ({
  dropInPath = getDefaultRuntimeDropInPath(),
} = {}) => {
  let dropInExists = false;
  let runtimeEnv = {};

  try {
    const content = await fs.readFile(dropInPath, 'utf8');
    dropInExists = true;
    runtimeEnv = parseRuntimeDropIn(content);
  } catch {
    dropInExists = false;
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    service: 'agentmux.service',
    dropInPath,
    dropInExists,
    runtimeEnv,
    rollbackEnv: runtimeV2RollbackEnv,
    mutates: false,
    commands: dropInExists
      ? [
        `rm ${dropInPath}`,
        'systemctl --user daemon-reload',
        'systemctl --user restart agentmux.service',
      ]
      : [
        'systemctl --user daemon-reload',
        'systemctl --user restart agentmux.service',
      ],
    warnings: dropInExists ? [] : ['runtime drop-in not found; rollback may already be applied'],
  };
};

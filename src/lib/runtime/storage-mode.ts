export type TRuntimeStorageV2Mode = 'off' | 'shadow' | 'write' | 'default';
const defaultRuntimeStorageV2Mode: TRuntimeStorageV2Mode = 'default';

export interface IRuntimeStorageV2ModeOptions {
  runtimeV2Enabled?: boolean;
  storageMode?: unknown;
}

export const parseRuntimeStorageV2Mode = (value: unknown): TRuntimeStorageV2Mode => {
  if (value === 'off') return 'off';
  if (value === 'shadow' || value === 'write' || value === 'default') return value;
  return 'off';
};

export const resolveRuntimeStorageV2Mode = (
  options: IRuntimeStorageV2ModeOptions = {},
): TRuntimeStorageV2Mode => {
  const runtimeV2Enabled = options.runtimeV2Enabled ?? process.env.AGENTMUX_RUNTIME_V2 === '1';
  const storageMode = Object.hasOwn(options, 'storageMode')
    ? options.storageMode
    : process.env.AGENTMUX_RUNTIME_STORAGE_V2_MODE;
  if (storageMode === undefined && runtimeV2Enabled) return defaultRuntimeStorageV2Mode;
  return parseRuntimeStorageV2Mode(storageMode);
};

export const getRuntimeStorageV2Mode = (env: NodeJS.ProcessEnv = process.env): TRuntimeStorageV2Mode =>
  resolveRuntimeStorageV2Mode({
    runtimeV2Enabled: env.AGENTMUX_RUNTIME_V2 === '1',
    storageMode: env.AGENTMUX_RUNTIME_STORAGE_V2_MODE,
  });

export const shouldMirrorLegacyStorageToRuntimeV2 = ({
  runtimeV2Enabled = process.env.AGENTMUX_RUNTIME_V2 === '1',
  storageMode = process.env.AGENTMUX_RUNTIME_STORAGE_V2_MODE,
}: IRuntimeStorageV2ModeOptions = {}): boolean => {
  if (!runtimeV2Enabled) return false;
  const mode = resolveRuntimeStorageV2Mode({ runtimeV2Enabled, storageMode });
  return mode === 'write' || mode === 'default';
};

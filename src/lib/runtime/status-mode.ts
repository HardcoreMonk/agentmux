export type TRuntimeStatusV2Mode = 'off' | 'shadow' | 'default';
const defaultRuntimeStatusV2Mode: TRuntimeStatusV2Mode = 'default';

export interface IRuntimeStatusV2ModeOptions {
  runtimeV2Enabled?: boolean;
  statusMode?: unknown;
}

export const parseRuntimeStatusV2Mode = (value: unknown): TRuntimeStatusV2Mode => {
  if (value === 'off') return 'off';
  if (value === 'shadow' || value === 'default') return value;
  return 'off';
};

export const resolveRuntimeStatusV2Mode = (
  options: IRuntimeStatusV2ModeOptions = {},
): TRuntimeStatusV2Mode => {
  const runtimeV2Enabled = options.runtimeV2Enabled ?? process.env.AGENTMUX_RUNTIME_V2 === '1';
  const statusMode = Object.hasOwn(options, 'statusMode')
    ? options.statusMode
    : process.env.AGENTMUX_RUNTIME_STATUS_V2_MODE;
  if (statusMode === undefined && runtimeV2Enabled) return defaultRuntimeStatusV2Mode;
  return parseRuntimeStatusV2Mode(statusMode);
};

export const getRuntimeStatusV2Mode = (env: NodeJS.ProcessEnv = process.env): TRuntimeStatusV2Mode =>
  resolveRuntimeStatusV2Mode({
    runtimeV2Enabled: env.AGENTMUX_RUNTIME_V2 === '1',
    statusMode: env.AGENTMUX_RUNTIME_STATUS_V2_MODE,
  });

export const shouldUseRuntimeStatusV2Live = ({
  runtimeV2Enabled = process.env.AGENTMUX_RUNTIME_V2 === '1',
  statusMode = process.env.AGENTMUX_RUNTIME_STATUS_V2_MODE,
}: IRuntimeStatusV2ModeOptions = {}): boolean => {
  if (!runtimeV2Enabled) return false;
  return resolveRuntimeStatusV2Mode({ runtimeV2Enabled, statusMode }) === 'default';
};

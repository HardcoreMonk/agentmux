export type TRuntimeTimelineV2Mode = 'off' | 'shadow' | 'default';
const defaultRuntimeTimelineV2Mode: TRuntimeTimelineV2Mode = 'default';

export interface IRuntimeTimelineV2ModeOptions {
  runtimeV2Enabled?: boolean;
  timelineMode?: unknown;
}

export const parseRuntimeTimelineV2Mode = (value: unknown): TRuntimeTimelineV2Mode => {
  if (value === 'off') return 'off';
  if (value === 'shadow' || value === 'default') return value;
  return 'off';
};

export const resolveRuntimeTimelineV2Mode = (
  options: IRuntimeTimelineV2ModeOptions = {},
): TRuntimeTimelineV2Mode => {
  const runtimeV2Enabled = options.runtimeV2Enabled ?? process.env.AGENTMUX_RUNTIME_V2 === '1';
  const timelineMode = Object.hasOwn(options, 'timelineMode')
    ? options.timelineMode
    : process.env.AGENTMUX_RUNTIME_TIMELINE_V2_MODE;
  if (timelineMode === undefined && runtimeV2Enabled) return defaultRuntimeTimelineV2Mode;
  return parseRuntimeTimelineV2Mode(timelineMode);
};

export const getRuntimeTimelineV2Mode = (env: NodeJS.ProcessEnv = process.env): TRuntimeTimelineV2Mode =>
  resolveRuntimeTimelineV2Mode({
    runtimeV2Enabled: env.AGENTMUX_RUNTIME_V2 === '1',
    timelineMode: env.AGENTMUX_RUNTIME_TIMELINE_V2_MODE,
  });

export const shouldUseRuntimeTimelineV2Live = ({
  runtimeV2Enabled = process.env.AGENTMUX_RUNTIME_V2 === '1',
  timelineMode = process.env.AGENTMUX_RUNTIME_TIMELINE_V2_MODE,
}: IRuntimeTimelineV2ModeOptions = {}): boolean => {
  if (!runtimeV2Enabled) return false;
  return resolveRuntimeTimelineV2Mode({ runtimeV2Enabled, timelineMode }) === 'default';
};

export const shouldUseRuntimeTimelineV2Reads = ({
  runtimeV2Enabled = process.env.AGENTMUX_RUNTIME_V2 === '1',
  timelineMode = process.env.AGENTMUX_RUNTIME_TIMELINE_V2_MODE,
}: IRuntimeTimelineV2ModeOptions = {}): boolean => {
  if (!runtimeV2Enabled) return false;
  return resolveRuntimeTimelineV2Mode({ runtimeV2Enabled, timelineMode }) === 'default';
};

export const shouldRunRuntimeTimelineV2Shadow = ({
  runtimeV2Enabled = process.env.AGENTMUX_RUNTIME_V2 === '1',
  timelineMode = process.env.AGENTMUX_RUNTIME_TIMELINE_V2_MODE,
}: IRuntimeTimelineV2ModeOptions = {}): boolean => {
  if (!runtimeV2Enabled) return false;
  return resolveRuntimeTimelineV2Mode({ runtimeV2Enabled, timelineMode }) === 'shadow';
};

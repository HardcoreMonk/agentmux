import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PRODUCT_NAME = 'agentmux';
export const LEGACY_PRODUCT_NAME = 'codexmux';
export const DATA_DIR_NAME = '.agentmux';
export const LEGACY_DATA_DIR_NAME = '.codexmux';

export type TDataDirConflictReason =
  | 'both-real'
  | 'unexpected-symlink'
  | 'dangling-symlink'
  | 'not-directory';

export type TDataDirLayout =
  | { kind: 'fresh' }
  | { kind: 'legacy-only' }
  | { kind: 'aliased' }
  | { kind: 'agentmux-only' }
  | {
      kind: 'conflict';
      reason: TDataDirConflictReason;
    };

export interface IDataDirConflictError extends Error {
  code: 'data-dir-conflict';
  reason: TDataDirConflictReason;
  agentmuxPath: string;
  legacyPath: string;
}

export type TAppIdentityEnv =
  | NodeJS.ProcessEnv
  | Record<string, string | undefined>;

export interface IPrepareDataDirOptions {
  homeDir?: string;
  env?: TAppIdentityEnv;
  platform?: NodeJS.Platform;
}

const safeLstat = (targetPath: string): fs.Stats | null => {
  try {
    return fs.lstatSync(targetPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return null;
    }
    throw error;
  }
};

const readDataDirOverride = (env: TAppIdentityEnv = process.env): string | undefined => {
  const agentmuxOverride = env.AGENTMUX_DATA_DIR?.trim();
  if (agentmuxOverride) {
    return agentmuxOverride;
  }
  const legacyOverride = env.CODEXMUX_DATA_DIR?.trim();
  if (legacyOverride) {
    return legacyOverride;
  }
  return undefined;
};

export const inspectDataDirLayout = (homeDir: string): TDataDirLayout => {
  const agentmuxPath = path.join(homeDir, DATA_DIR_NAME);
  const legacyPath = path.join(homeDir, LEGACY_DATA_DIR_NAME);

  const legacyStat = safeLstat(legacyPath);
  const agentmuxStat = safeLstat(agentmuxPath);

  if (legacyStat?.isSymbolicLink()) {
    const linkTarget = fs.readlinkSync(legacyPath);
    const resolvedTarget = path.resolve(homeDir, linkTarget);
    const targetStat = safeLstat(resolvedTarget);

    if (targetStat === null) {
      return { kind: 'conflict', reason: 'dangling-symlink' };
    }

    const isExpectedMigratedTarget =
      linkTarget === DATA_DIR_NAME || linkTarget === agentmuxPath;

    if (isExpectedMigratedTarget && agentmuxStat?.isDirectory()) {
      return { kind: 'agentmux-only' };
    }

    return { kind: 'conflict', reason: 'unexpected-symlink' };
  }

  if (legacyStat !== null && !legacyStat.isDirectory()) {
    return { kind: 'conflict', reason: 'not-directory' };
  }

  if (agentmuxStat === null) {
    if (legacyStat === null) {
      return { kind: 'fresh' };
    }
    return { kind: 'legacy-only' };
  }

  if (agentmuxStat.isSymbolicLink()) {
    const linkTarget = fs.readlinkSync(agentmuxPath);
    const resolvedTarget = path.resolve(homeDir, linkTarget);
    const targetStat = safeLstat(resolvedTarget);

    if (targetStat === null) {
      return { kind: 'conflict', reason: 'dangling-symlink' };
    }

    const isExpectedAliasTarget =
      linkTarget === LEGACY_DATA_DIR_NAME || linkTarget === legacyPath;

    if (!isExpectedAliasTarget) {
      return { kind: 'conflict', reason: 'unexpected-symlink' };
    }

    if (!targetStat.isDirectory()) {
      return { kind: 'conflict', reason: 'not-directory' };
    }

    return { kind: 'aliased' };
  }

  if (!agentmuxStat.isDirectory()) {
    return { kind: 'conflict', reason: 'not-directory' };
  }

  if (legacyStat === null) {
    return { kind: 'agentmux-only' };
  }

  return { kind: 'conflict', reason: 'both-real' };
};

export const resolveDataDirPath = (
  homeDir: string,
  env: TAppIdentityEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string => {
  const override = readDataDirOverride(env);
  if (override) {
    return override;
  }

  if (platform === 'win32') {
    return path.join(homeDir, LEGACY_DATA_DIR_NAME);
  }

  const agentmuxPath = path.join(homeDir, DATA_DIR_NAME);
  const legacyPath = path.join(homeDir, LEGACY_DATA_DIR_NAME);
  const layout = inspectDataDirLayout(homeDir);

  if (layout.kind === 'legacy-only' || layout.kind === 'aliased') {
    return legacyPath;
  }

  if (layout.kind === 'fresh' || layout.kind === 'agentmux-only') {
    return agentmuxPath;
  }

  const legacyStat = safeLstat(legacyPath);
  if (legacyStat?.isDirectory()) {
    return legacyPath;
  }

  return agentmuxPath;
};

const createConflictError = (
  reason: TDataDirConflictReason,
  agentmuxPath: string,
  legacyPath: string,
): IDataDirConflictError => {
  const error = new Error(
    `Data directory conflict (${reason}): agentmux=${agentmuxPath}, legacy=${legacyPath}`,
  ) as IDataDirConflictError;
  error.code = 'data-dir-conflict';
  error.reason = reason;
  error.agentmuxPath = agentmuxPath;
  error.legacyPath = legacyPath;
  return error;
};

export const prepareDataDir = (options?: IPrepareDataDirOptions): string => {
  const env = options?.env ?? process.env;
  const override = readDataDirOverride(env);
  if (override) {
    fs.mkdirSync(override, { recursive: true, mode: 0o700 });
    return override;
  }

  const homeDir = options?.homeDir ?? (env.HOME?.trim() || os.homedir());
  if ((options?.platform ?? process.platform) === 'win32') {
    const windowsPath = path.join(homeDir, LEGACY_DATA_DIR_NAME);
    fs.mkdirSync(windowsPath, { recursive: true, mode: 0o700 });
    return windowsPath;
  }

  const agentmuxPath = path.join(homeDir, DATA_DIR_NAME);
  const legacyPath = path.join(homeDir, LEGACY_DATA_DIR_NAME);
  const layout = inspectDataDirLayout(homeDir);

  switch (layout.kind) {
    case 'fresh': {
      fs.mkdirSync(agentmuxPath, { recursive: true, mode: 0o700 });
      fs.chmodSync(agentmuxPath, 0o700);
      return agentmuxPath;
    }
    case 'legacy-only': {
      try {
        fs.symlinkSync(LEGACY_DATA_DIR_NAME, agentmuxPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }
        const raced = inspectDataDirLayout(homeDir);
        if (raced.kind === 'aliased') {
          return legacyPath;
        }
        if (raced.kind === 'conflict') {
          throw createConflictError(raced.reason, agentmuxPath, legacyPath);
        }
        throw error;
      }
      return legacyPath;
    }
    case 'aliased': {
      return legacyPath;
    }
    case 'agentmux-only': {
      return agentmuxPath;
    }
    case 'conflict': {
      throw createConflictError(layout.reason, agentmuxPath, legacyPath);
    }
  }
};

export const getDataDir = (): string =>
  resolveDataDirPath(os.homedir(), process.env, process.platform);

export const getDisplayDataDir = (env: TAppIdentityEnv = process.env): string =>
  readDataDirOverride(env) ?? '~/.agentmux';

export const getServiceUnitName = (): string => 'agentmux.service';

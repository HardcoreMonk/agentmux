export type TLegacyEnvMap = NodeJS.ProcessEnv | Record<string, string | undefined>;

interface IEnvKeyPair {
  newKey: string;
  legacyKey: string;
}

const FIXED_PAIRS: readonly IEnvKeyPair[] = [
  { newKey: 'AMUX_PORT', legacyKey: 'CMUX_PORT' },
  { newKey: 'AMUX_TOKEN', legacyKey: 'CMUX_TOKEN' },
];

const NEW_PREFIX = 'AGENTMUX_';
const LEGACY_PREFIX = 'CODEXMUX_';

export const normalizeLegacyEnv = (
  env: TLegacyEnvMap,
  warn?: (message: string) => void,
): string[] => {
  const pairs = new Map<string, IEnvKeyPair>();

  for (const pair of FIXED_PAIRS) {
    if (env[pair.newKey] !== undefined || env[pair.legacyKey] !== undefined) {
      pairs.set(pair.newKey, pair);
    }
  }

  for (const key of Object.keys(env)) {
    if (env[key] === undefined) continue;
    if (key.startsWith(NEW_PREFIX) && key.length > NEW_PREFIX.length) {
      const suffix = key.slice(NEW_PREFIX.length);
      const newKey = `${NEW_PREFIX}${suffix}`;
      pairs.set(newKey, { newKey, legacyKey: `${LEGACY_PREFIX}${suffix}` });
    } else if (key.startsWith(LEGACY_PREFIX) && key.length > LEGACY_PREFIX.length) {
      const suffix = key.slice(LEGACY_PREFIX.length);
      const newKey = `${NEW_PREFIX}${suffix}`;
      pairs.set(newKey, { newKey, legacyKey: `${LEGACY_PREFIX}${suffix}` });
    }
  }

  const changed: string[] = [];

  for (const { newKey, legacyKey } of pairs.values()) {
    const newValue = env[newKey];
    const legacyValue = env[legacyKey];

    if (newValue !== undefined && legacyValue === undefined) {
      env[legacyKey] = newValue;
      changed.push(legacyKey);
    } else if (newValue === undefined && legacyValue !== undefined) {
      env[newKey] = legacyValue;
      changed.push(newKey);
    } else if (newValue !== undefined && legacyValue !== undefined && newValue !== legacyValue) {
      env[legacyKey] = newValue;
      changed.push(legacyKey);
      warn?.(
        `[env] Both ${newKey} and ${legacyKey} are set with different values; using ${newKey} and overwriting ${legacyKey}.`,
      );
    }
  }

  return changed;
};

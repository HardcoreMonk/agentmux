export type TSessionCatalogMode = 'off' | 'shadow' | 'default';

export interface ISessionCatalogModeOptions {
  runtimeV2Enabled?: boolean;
  catalogMode?: unknown;
}

export const parseSessionCatalogMode = (value: unknown): TSessionCatalogMode => {
  if (value === 'shadow' || value === 'default') return value;
  return 'off';
};

export const resolveSessionCatalogMode = (
  options: ISessionCatalogModeOptions = {},
): TSessionCatalogMode => {
  const runtimeV2Enabled = options.runtimeV2Enabled ?? process.env.AGENTMUX_RUNTIME_V2 === '1';
  if (!runtimeV2Enabled) return 'off';
  const catalogMode = Object.hasOwn(options, 'catalogMode')
    ? options.catalogMode
    : process.env.AGENTMUX_SESSION_CATALOG_MODE;
  if (catalogMode === undefined) return 'shadow';
  return parseSessionCatalogMode(catalogMode);
};

export const getSessionCatalogMode = (env: NodeJS.ProcessEnv = process.env): TSessionCatalogMode =>
  resolveSessionCatalogMode({
    runtimeV2Enabled: env.AGENTMUX_RUNTIME_V2 === '1',
    catalogMode: env.AGENTMUX_SESSION_CATALOG_MODE,
  });

export const shouldRunSessionCatalogShadow = (options: ISessionCatalogModeOptions = {}): boolean =>
  resolveSessionCatalogMode(options) === 'shadow';

export const shouldServeSessionCatalog = (options: ISessionCatalogModeOptions = {}): boolean =>
  resolveSessionCatalogMode(options) === 'default';

interface ISessionCatalogShadowEntry {
  sessionId: string;
  lastActivityAt: string;
  turnCount: number;
}

export interface ISessionCatalogShadowComparison {
  legacyCount: number;
  catalogCount: number;
  mismatchCount: number;
  categories: {
    missingInCatalog: number;
    missingInLegacy: number;
    metadataMismatch: number;
  };
}

export const compareSessionCatalogShadow = (
  legacy: readonly ISessionCatalogShadowEntry[],
  catalog: readonly ISessionCatalogShadowEntry[],
): ISessionCatalogShadowComparison => {
  const legacyById = new Map(legacy.map((entry) => [entry.sessionId, entry]));
  const catalogById = new Map(catalog.map((entry) => [entry.sessionId, entry]));
  let missingInCatalog = 0;
  let missingInLegacy = 0;
  let metadataMismatch = 0;

  for (const entry of legacy) {
    const projected = catalogById.get(entry.sessionId);
    if (!projected) missingInCatalog++;
    else if (projected.lastActivityAt !== entry.lastActivityAt || projected.turnCount !== entry.turnCount) {
      metadataMismatch++;
    }
  }
  for (const entry of catalog) {
    if (!legacyById.has(entry.sessionId)) missingInLegacy++;
  }

  return {
    legacyCount: legacy.length,
    catalogCount: catalog.length,
    mismatchCount: missingInCatalog + missingInLegacy + metadataMismatch,
    categories: { missingInCatalog, missingInLegacy, metadataMismatch },
  };
};

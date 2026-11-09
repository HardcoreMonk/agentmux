import { describe, expect, it } from 'vitest';
import {
  compareSessionCatalogShadow,
  getSessionCatalogMode,
  parseSessionCatalogMode,
  shouldRunSessionCatalogShadow,
  shouldServeSessionCatalog,
} from '@/lib/runtime/session-catalog-mode';

describe('session catalog runtime mode', () => {
  it('parses supported modes and fails closed', () => {
    expect(parseSessionCatalogMode('shadow')).toBe('shadow');
    expect(parseSessionCatalogMode('default')).toBe('default');
    expect(parseSessionCatalogMode('write')).toBe('off');
    expect(parseSessionCatalogMode(undefined)).toBe('off');
  });

  it('defaults to shadow when Runtime v2 is enabled', () => {
    expect(getSessionCatalogMode({ AGENTMUX_RUNTIME_V2: '1' } as unknown as NodeJS.ProcessEnv)).toBe('shadow');
    expect(getSessionCatalogMode({
      AGENTMUX_RUNTIME_V2: '1',
      AGENTMUX_SESSION_CATALOG_MODE: 'default',
    } as unknown as NodeJS.ProcessEnv)).toBe('default');
    expect(getSessionCatalogMode({} as unknown as NodeJS.ProcessEnv)).toBe('off');
  });

  it('separates shadow comparison from API-serving ownership', () => {
    expect(shouldRunSessionCatalogShadow({ runtimeV2Enabled: true, catalogMode: 'shadow' })).toBe(true);
    expect(shouldServeSessionCatalog({ runtimeV2Enabled: true, catalogMode: 'shadow' })).toBe(false);
    expect(shouldServeSessionCatalog({ runtimeV2Enabled: true, catalogMode: 'default' })).toBe(true);
    expect(shouldServeSessionCatalog({ runtimeV2Enabled: false, catalogMode: 'default' })).toBe(false);
  });

  it('reports shadow mismatches as sanitized counts only', () => {
    const result = compareSessionCatalogShadow(
      [
        { sessionId: 'private-a', lastActivityAt: '2026-08-21T08:00:00.000Z', turnCount: 1 },
        { sessionId: 'private-b', lastActivityAt: '2026-08-21T08:01:00.000Z', turnCount: 2 },
      ],
      [
        { sessionId: 'private-a', lastActivityAt: '2026-08-21T08:00:00.000Z', turnCount: 3 },
        { sessionId: 'private-c', lastActivityAt: '2026-08-21T08:02:00.000Z', turnCount: 1 },
      ],
    );

    expect(result).toEqual({
      legacyCount: 2,
      catalogCount: 2,
      mismatchCount: 3,
      categories: { missingInCatalog: 1, missingInLegacy: 1, metadataMismatch: 1 },
    });
    expect(JSON.stringify(result)).not.toMatch(/private-[abc]/);
  });
});

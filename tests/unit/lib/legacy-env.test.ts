import { describe, expect, it, vi } from 'vitest';
import { normalizeLegacyEnv } from '@/lib/legacy-env';

describe('normalizeLegacyEnv', () => {
  it('copies CODEXMUX_<X> to AGENTMUX_<X> when only legacy is set', () => {
    const env: Record<string, string | undefined> = { CODEXMUX_RUNTIME_V2: '1' };
    const changed = normalizeLegacyEnv(env);

    expect(env.AGENTMUX_RUNTIME_V2).toBe('1');
    expect(env.CODEXMUX_RUNTIME_V2).toBe('1');
    expect(changed).toEqual(['AGENTMUX_RUNTIME_V2']);
  });

  it('copies AGENTMUX_<X> to CODEXMUX_<X> when only new is set', () => {
    const env: Record<string, string | undefined> = { AGENTMUX_GOVERNANCE_WRITES: '1' };
    const changed = normalizeLegacyEnv(env);

    expect(env.CODEXMUX_GOVERNANCE_WRITES).toBe('1');
    expect(env.AGENTMUX_GOVERNANCE_WRITES).toBe('1');
    expect(changed).toEqual(['CODEXMUX_GOVERNANCE_WRITES']);
  });

  it('prefers AGENTMUX_<X> over CODEXMUX_<X> on conflict and warns once without leaking values', () => {
    const env: Record<string, string | undefined> = {
      AGENTMUX_RUNTIME_DB: '/a',
      CODEXMUX_RUNTIME_DB: '/b',
    };
    const warn = vi.fn();
    const changed = normalizeLegacyEnv(env, warn);

    expect(env.AGENTMUX_RUNTIME_DB).toBe('/a');
    expect(env.CODEXMUX_RUNTIME_DB).toBe('/a');
    expect(changed).toEqual(['CODEXMUX_RUNTIME_DB']);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0] ?? '');
    expect(message).toContain('AGENTMUX_RUNTIME_DB');
    expect(message).toContain('CODEXMUX_RUNTIME_DB');
    expect(message).not.toContain('/a');
    expect(message).not.toContain('/b');
  });

  it('mirrors CMUX_PORT/AMUX_PORT and CMUX_TOKEN/AMUX_TOKEN pairs', () => {
    const env: Record<string, string | undefined> = {
      CMUX_TOKEN: 't',
      AMUX_PORT: '4100',
    };
    const changed = normalizeLegacyEnv(env);

    expect(env.AMUX_TOKEN).toBe('t');
    expect(env.CMUX_PORT).toBe('4100');
    expect(changed).toEqual(expect.arrayContaining(['AMUX_TOKEN', 'CMUX_PORT']));
  });

  it('does not touch __CMUX_* internal variables or matching pairs', () => {
    const env: Record<string, string | undefined> = {
      __CMUX_APP_DIR: '/x',
      __CMUX_PRISTINE_ENV: '{"HOME":"/tmp"}',
      AGENTMUX_RUNTIME_V2: '1',
      CODEXMUX_RUNTIME_V2: '1',
    };
    const warn = vi.fn();
    const changed = normalizeLegacyEnv(env, warn);

    expect(env.__CMUX_APP_DIR).toBe('/x');
    expect(env.__CMUX_PRISTINE_ENV).toBe('{"HOME":"/tmp"}');
    expect(changed).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

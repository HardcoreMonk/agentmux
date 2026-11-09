import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { resolveHostPaths } from '@/lib/host-paths';
import { resolveWindowsHostDiagnostics } from '@/lib/windows-host-diagnostics';

const env = {
  USERPROFILE: 'C:\\Users\\cmux',
  LOCALAPPDATA: 'C:\\Users\\cmux\\AppData\\Local',
  HOST: '0.0.0.0',
  PORT: '9123',
};

describe('Windows host diagnostics', () => {
  it('aligns Windows data and log paths with the service host plan', () => {
    const paths = resolveHostPaths({
      platform: 'win32',
      env,
    });

    expect(paths.dataDir).toBe(path.win32.join('C:\\Users\\cmux', '.codexmux'));
    expect(paths.codexDir).toBe(path.win32.join('C:\\Users\\cmux', '.codex'));
    expect(paths.logDir).toBe(path.win32.join('C:\\Users\\cmux\\AppData\\Local', 'codexmux', 'logs'));
  });

  it('keeps non-Windows log paths compatible with the existing data directory and uses .agentmux on fresh hosts', () => {
    const freshPaths = resolveHostPaths({
      platform: 'linux',
      env: {
        HOME: '/home/cmux',
      },
    });

    expect(freshPaths.dataDir).toBe('/home/cmux/.agentmux');
    expect(freshPaths.codexDir).toBe('/home/cmux/.codex');
    expect(freshPaths.logDir).toBe('/home/cmux/.agentmux/logs');

    const legacyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmux-host-paths-legacy-'));
    try {
      fs.mkdirSync(path.join(legacyHome, '.codexmux'));
      const legacyPaths = resolveHostPaths({
        platform: 'linux',
        env: {
          HOME: legacyHome,
        },
      });
      expect(legacyPaths.dataDir).toBe(path.posix.join(legacyHome, '.codexmux'));
      expect(legacyPaths.codexDir).toBe(path.posix.join(legacyHome, '.codex'));
      expect(legacyPaths.logDir).toBe(path.posix.join(legacyHome, '.codexmux', 'logs'));
    } finally {
      fs.rmSync(legacyHome, { recursive: true, force: true });
    }
  });

  it('reports Windows logs and health probes without mutating the host', () => {
    const diagnostics = resolveWindowsHostDiagnostics({
      platform: 'win32',
      env,
      appDir: 'D:\\apps\\codexmux',
    });

    expect(diagnostics).toMatchObject({
      platform: 'win32',
      skipped: false,
      reason: null,
      mutatesSystem: false,
      health: {
        baseUrl: 'http://127.0.0.1:9123',
        healthUrl: 'http://127.0.0.1:9123/api/health',
        runtimeHealthUrl: 'http://127.0.0.1:9123/api/v2/runtime/health',
        authenticatedRuntimeHealth: true,
      },
      serviceHost: {
        owner: 'tray',
        hostModel: 'tray-first-service-capable',
      },
    });
    expect(diagnostics.paths.logDir).toBe(path.win32.join('C:\\Users\\cmux\\AppData\\Local', 'codexmux', 'logs'));
    expect(diagnostics.paths.supportBundleDir).toBe(path.win32.join('C:\\Users\\cmux\\AppData\\Local', 'codexmux', 'support'));
  });

  it('returns a skipped dry-run result outside win32', () => {
    expect(resolveWindowsHostDiagnostics({
      platform: 'linux',
      env: {
        HOME: '/home/cmux',
      },
      appDir: '/srv/codexmux',
    })).toMatchObject({
      platform: 'linux',
      skipped: true,
      reason: 'windows-host-diagnostics-only-runs-on-win32',
      mutatesSystem: false,
    });
  });
});

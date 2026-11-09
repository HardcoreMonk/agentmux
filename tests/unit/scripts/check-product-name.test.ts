import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/check-product-name-lib.mjs')).href);

describe('check-product-name', () => {
  it('flags visible codexmux and bare cmux', async () => {
    const { findProductNameViolations } = await loadLib();
    const violations = findProductNameViolations([
      { path: 'README.md', content: 'codexmux는 세션 매니저입니다\nagentmux는 정상입니다' },
      { path: 'bin/cli.js', content: 'Usage: cmux tab' },
    ]);
    expect(violations).toEqual([
      { path: 'README.md', line: 1, text: 'codexmux는 세션 매니저입니다' },
      { path: 'bin/cli.js', line: 1, text: 'Usage: cmux tab' },
    ]);
  });

  it('allows preserved runtime, token, env, global, and compatibility markers', async () => {
    const { findProductNameViolations } = await loadLib();
    const violations = findProductNameViolations([
      {
        path: 'docs/TMUX.md',
        content: [
          'export CODEXMUX_PORT=3000',
          'export CMUX_PORT=3000',
          'cookie codexmux-session-token',
          'header x-cmux-token',
          "headers: { 'X-Cmux-Token': TOKEN }",
          'tmux -L codexmux list-sessions',
          'tmux -L codexmux-runtime-v2 list-sessions',
          'globalThis.__codexmuxStore',
          'globalThis.__cmuxStore',
          'applicationId "com.hardcoremonk.codexmux"',
          'CODEXMUX: managed block',
          '# Codexmux Managed section',
          'temp dir .codexmux-stage-1234',
          'keep bin/codexmux.js wrapper',
          'preserve codexwinmux history',
          'log codexmux@0.4.22 release',
          '이전 이름 codexmux와 호환됩니다.',
          'cmux는 별칭으로 유지됩니다.',
          'Formerly codexmux in earlier releases.',
          'legacy codexmux path // product-name-allow',
          'custom codexmux reference // product-name-allow',
        ].join('\n'),
      },
    ]);
    expect(violations).toEqual([]);
  });

  it('allows the preserved cmux.lock lock file name but still flags bare cmux', async () => {
    const { findProductNameViolations } = await loadLib();
    const violations = findProductNameViolations([
      {
        path: 'landing-src/docs/data-directory.md',
        content: '| `cmux.lock` | 단일 인스턴스 guard |\n`cmux` 명령을 실행합니다',
      },
    ]);
    expect(violations.map((v: { line: number }) => v.line)).toEqual([2]);
  });

  it('allows the preserved Windows data directory path', async () => {
    const { findProductNameViolations } = await loadLib();
    const violations = findProductNameViolations([
      {
        path: 'landing-src/docs/troubleshooting.md',
        content: '$path = Join-Path $HOME ".codexmux\\config.json"\nRun codexmux',
      },
    ]);
    expect(violations.map((v: { line: number }) => v.line)).toEqual([2]);
  });

  it('ignores files outside the product name scan scope and binary assets in public/', async () => {
    const { findProductNameViolations, isProductNameScanTarget } = await loadLib();
    expect(isProductNameScanTarget('README.md')).toBe(true);
    expect(isProductNameScanTarget('docs/TMUX.md')).toBe(true);
    expect(isProductNameScanTarget('docs/agents/domain.md')).toBe(true);
    expect(isProductNameScanTarget('public/sw.js')).toBe(true);
    expect(isProductNameScanTarget('public/favicon.ico')).toBe(false);
    expect(isProductNameScanTarget('public/android-chrome-192x192.png')).toBe(false);
    expect(isProductNameScanTarget('public/fonts/PretendardVariable.woff2')).toBe(false);
    expect(isProductNameScanTarget('docs/ADR.md')).toBe(false);
    expect(isProductNameScanTarget('docs/WINDOWS-ONLY-GAP-AUDIT.md')).toBe(false);
    expect(isProductNameScanTarget('src/lib/tmux.ts')).toBe(false);

    const violations = findProductNameViolations([
      { path: 'docs/ADR.md', content: 'codexmux architecture decision' },
      { path: 'public/favicon.ico', content: 'codexmux' },
      { path: 'src/lib/tmux.ts', content: 'codexmux' },
    ]);
    expect(violations).toEqual([]);
  });
});

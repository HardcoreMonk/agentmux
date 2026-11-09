import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { describe, expect, it } from 'vitest';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/npm-package-smoke-lib.mjs')).href);

describe('npm package smoke helpers', () => {
  it('extracts the single tarball filename from npm pack JSON', async () => {
    const { parsePackedFilename } = await loadLib();

    expect(parsePackedFilename('[{"filename":"hardcoremonk-agentmux-0.5.0.tgz"}]'))
      .toBe('hardcoremonk-agentmux-0.5.0.tgz');
    expect(() => parsePackedFilename('[]')).toThrow('exactly one');
    expect(() => parsePackedFilename('not-json')).toThrow('valid JSON');
  });

  it('validates the installed CLI package surface', async () => {
    const { assertInstalledPackage } = await loadLib();
    const packageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmux-npm-contract-'));
    const requiredFiles = [
      'bin/agentmux.js',
      'bin/codexmux.js',
      'bin/cli.js',
      'dist/server.js',
      'dist/workers/governance-worker.js',
      '.next/standalone/server.js',
      'src/config/tmux.conf',
      'scripts/postinstall-node-pty.mjs',
      'scripts/postinstall-node-pty-lib.mjs',
    ];

    try {
      await Promise.all(requiredFiles.map(async (relativePath) => {
        const file = path.join(packageDir, relativePath);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, 'fixture', 'utf8');
      }));
      await fs.writeFile(path.join(packageDir, 'package.json'), JSON.stringify({
        name: '@hardcoremonk/agentmux',
        bin: {
          agentmux: 'bin/agentmux.js',
          amux: 'bin/agentmux.js',
          codexmux: 'bin/agentmux.js',
          cmux: 'bin/agentmux.js',
        },
        scripts: {
          postinstall: 'node scripts/postinstall-node-pty.mjs',
        },
      }), 'utf8');

      await expect(assertInstalledPackage(packageDir)).resolves.toMatchObject({
        name: '@hardcoremonk/agentmux',
      });

      await fs.rm(path.join(packageDir, 'dist/server.js'));
      await expect(assertInstalledPackage(packageDir)).rejects.toThrow('dist/server.js');
    } finally {
      await fs.rm(packageDir, { recursive: true, force: true });
    }
  });
});

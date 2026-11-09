import fs from 'fs/promises';
import path from 'path';

const REQUIRED_PACKAGE_FILES = [
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

export const parsePackedFilename = (raw) => {
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    throw new Error('npm pack did not return valid JSON.');
  }

  if (!Array.isArray(result) || result.length !== 1) {
    throw new Error('npm pack must return exactly one tarball.');
  }

  const filename = result[0]?.filename;
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error('npm pack result is missing a filename.');
  }
  return filename;
};

export const assertInstalledPackage = async (packageDir) => {
  const manifest = JSON.parse(
    await fs.readFile(path.join(packageDir, 'package.json'), 'utf8'),
  );

  if (manifest.name !== '@hardcoremonk/agentmux') {
    throw new Error(`unexpected installed package name: ${String(manifest.name)}`);
  }
  if (Object.hasOwn(manifest, 'main')) {
    throw new Error('the npm execution package must not expose a main entry.');
  }
  if (
    manifest.bin?.agentmux !== 'bin/agentmux.js'
    || manifest.bin?.amux !== 'bin/agentmux.js'
    || manifest.bin?.codexmux !== 'bin/agentmux.js'
    || manifest.bin?.cmux !== 'bin/agentmux.js'
  ) {
    throw new Error('installed package bin contract is invalid.');
  }
  if (manifest.scripts?.postinstall !== 'node scripts/postinstall-node-pty.mjs') {
    throw new Error('installed package postinstall contract is invalid.');
  }

  for (const relativePath of REQUIRED_PACKAGE_FILES) {
    try {
      await fs.access(path.join(packageDir, relativePath));
    } catch {
      throw new Error(`installed package is missing ${relativePath}.`);
    }
  }

  return manifest;
};

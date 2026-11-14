import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const COPY_OPTIONS = { recursive: true, force: true, verbatimSymlinks: true };

const exists = async (target) => {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
};

const listNextEntries = async (nextDir) =>
  (await readdir(nextDir)).filter((name) => name !== 'cache');

const copyNextEntries = async (from, to) => {
  await mkdir(to, { recursive: true });
  for (const name of await listNextEntries(from)) {
    await cp(path.join(from, name), path.join(to, name), COPY_OPTIONS);
  }
};

export const snapshotBuildOutputs = async (rootDir) => {
  const backupDir = path.join(rootDir, '.deploy-backup');
  const nextDir = path.join(rootDir, '.next');
  const distDir = path.join(rootDir, 'dist');

  await rm(backupDir, { recursive: true, force: true });

  const snapshot = { next: await exists(nextDir), dist: await exists(distDir) };
  if (snapshot.next) {
    await copyNextEntries(nextDir, path.join(backupDir, 'next'));
  }
  if (snapshot.dist) {
    await cp(distDir, path.join(backupDir, 'dist'), COPY_OPTIONS);
  }
  return snapshot;
};

export const restoreBuildOutputs = async (rootDir, snapshot) => {
  const backupDir = path.join(rootDir, '.deploy-backup');
  const nextDir = path.join(rootDir, '.next');

  if (snapshot.next) {
    if (await exists(nextDir)) {
      for (const name of await listNextEntries(nextDir)) {
        await rm(path.join(nextDir, name), { recursive: true, force: true });
      }
    }
    await copyNextEntries(path.join(backupDir, 'next'), nextDir);
  }
  if (snapshot.dist) {
    const distDir = path.join(rootDir, 'dist');
    await rm(distDir, { recursive: true, force: true });
    await cp(path.join(backupDir, 'dist'), distDir, COPY_OPTIONS);
  }
};

export const runDeploy = async ({ rootDir, run, waitForHealth, buildEnv, log }) => {
  const step = (cmd, args, options) => {
    log(`[deploy-local] ${cmd} ${args.join(' ')}`);
    return run(cmd, args, options);
  };

  const installStatus = await step('corepack', ['pnpm', 'install', '--frozen-lockfile']);
  if (installStatus !== 0) return installStatus;

  const tscStatus = await step('corepack', ['pnpm', 'exec', 'tsc', '--noEmit']);
  if (tscStatus !== 0) return tscStatus;

  const snapshot = await snapshotBuildOutputs(rootDir);

  const buildStatus = await step('corepack', ['pnpm', 'build'], { env: buildEnv });
  if (buildStatus !== 0) {
    await restoreBuildOutputs(rootDir, snapshot);
    log('[deploy-local] build failed; restored the previous build output; the service was not restarted');
    return buildStatus;
  }

  const restartStatus = await step('systemctl', ['--user', 'restart', 'agentmux.service']);
  if (restartStatus !== 0) return restartStatus;

  const health = await waitForHealth();
  log(`[deploy-local] healthy ${JSON.stringify(health)}`);
  return 0;
};

import fs from 'fs/promises';
import path from 'path';
import { getDataDir } from '@/lib/app-identity';

export interface IRuntimeStorageBackupInput {
  dataDir?: string;
  outputRoot?: string;
  timestamp?: string;
}

export interface IRuntimeStorageBackupEntry {
  relativePath: string;
  bytes: number;
}

export interface IRuntimeStorageBackupResult {
  backupDir: string;
  copied: IRuntimeStorageBackupEntry[];
}

const KNOWN_STORAGE_FILES = [
  'workspaces.json',
  'layout.json',
  'tabs.json',
  'runtime-v2/state.db',
  'runtime-v2/state.db-wal',
  'runtime-v2/state.db-shm',
] as const;

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

const toPosixPath = (filePath: string): string =>
  filePath.split(path.sep).join('/');

const timestampForBackup = (): string =>
  new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

const fileExists = async (filePath: string): Promise<boolean> =>
  fs.access(filePath).then(() => true).catch(() => false);

const ensurePrivateDirectory = async (directoryPath: string): Promise<void> => {
  await fs.mkdir(directoryPath, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await fs.chmod(directoryPath, PRIVATE_DIRECTORY_MODE);
};

const collectFilesRecursively = async (rootDir: string, relativeDir: string): Promise<string[]> => {
  const absoluteDir = path.join(rootDir, relativeDir);
  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
  try {
    entries = await fs.readdir(absoluteDir, { withFileTypes: true, encoding: 'utf8' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const files = await Promise.all(entries.map(async (entry) => {
    const childRelativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) return collectFilesRecursively(rootDir, childRelativePath);
    if (!entry.isFile()) return [];
    if (!entry.name.endsWith('.json')) return [];
    return [toPosixPath(childRelativePath)];
  }));

  return files.flat();
};

const collectStorageFiles = async (dataDir: string): Promise<string[]> => {
  const knownFiles: string[] = [];
  for (const relativePath of KNOWN_STORAGE_FILES) {
    const exists = await fileExists(path.join(dataDir, ...relativePath.split('/')));
    if (exists) knownFiles.push(relativePath);
  }
  const workspaceFiles = await collectFilesRecursively(dataDir, 'workspaces');
  return [...new Set([...knownFiles, ...workspaceFiles])]
    .sort((a, b) => a.localeCompare(b));
};

export const createRuntimeStorageBackup = async ({
  dataDir = getDataDir(),
  outputRoot = path.join(dataDir, 'backups'),
  timestamp = timestampForBackup(),
}: IRuntimeStorageBackupInput = {}): Promise<IRuntimeStorageBackupResult> => {
  const backupDir = path.join(outputRoot, `runtime-v2-storage-${timestamp}`);
  const relativePaths = await collectStorageFiles(dataDir);
  const copied: IRuntimeStorageBackupEntry[] = [];

  await ensurePrivateDirectory(backupDir);

  for (const relativePath of relativePaths) {
    const source = path.join(dataDir, ...relativePath.split('/'));
    const destination = path.join(backupDir, ...relativePath.split('/'));
    await ensurePrivateDirectory(path.dirname(destination));
    await fs.copyFile(source, destination);
    await fs.chmod(destination, PRIVATE_FILE_MODE);
    const stat = await fs.stat(destination);
    copied.push({ relativePath, bytes: stat.size });
  }

  return { backupDir, copied };
};

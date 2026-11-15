import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { getDataDir } from '@/lib/app-identity';
import { getCodexHookFingerprint } from '@/lib/providers/codex/session-hooks';

const getTrustFile = (): string => path.join(getDataDir(), 'codex-hook-trust.json');

export { getCodexHookFingerprint };

const readRecordedFingerprint = async (): Promise<string | null> => {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(getTrustFile(), 'utf-8'));
    const fingerprint = (parsed as { fingerprint?: unknown } | null)?.fingerprint;
    return typeof fingerprint === 'string' ? fingerprint : null;
  } catch {
    return null;
  }
};

export const isCodexHookFingerprintTrusted = async (): Promise<boolean> =>
  (await readRecordedFingerprint()) === getCodexHookFingerprint();

const writeTrustFingerprint = async (): Promise<void> => {
  const fingerprint = getCodexHookFingerprint();
  if ((await readRecordedFingerprint()) === fingerprint) return;
  const file = getTrustFile();
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(tmp, JSON.stringify({ fingerprint }), { mode: 0o600 });
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
};

let inFlight: Promise<void> | null = null;

export const recordCodexHookTrusted = (): Promise<void> => {
  inFlight ??= writeTrustFingerprint().finally(() => {
    inFlight = null;
  });
  return inFlight;
};

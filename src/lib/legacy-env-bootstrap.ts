import { normalizeLegacyEnv } from '@/lib/legacy-env';

normalizeLegacyEnv(process.env, (message) => console.warn(message));

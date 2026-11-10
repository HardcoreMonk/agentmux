import path from 'path';
import { getDataDir } from '@/lib/app-identity';

export const shQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

export const buildStatuslineScriptContent = (baseDir = getDataDir()): string => {
  const portFile = shQuote(path.join(baseDir, 'port'));
  const tokenFile = shQuote(path.join(baseDir, 'cli-token'));
  return `#!/bin/sh
PORT_FILE=${portFile}
TOKEN_FILE=${tokenFile}
[ -f "$PORT_FILE" ] || exit 0
[ -f "$TOKEN_FILE" ] || exit 0
PORT=$(cat "$PORT_FILE")
TOKEN=$(cat "$TOKEN_FILE")
curl -sf --max-time 2 -X POST \\
  -H 'Content-Type: application/json' \\
  -H "x-agentmux-token: \${TOKEN}" \\
  --data-binary @- \\
  "http://localhost:\${PORT}/api/status/statusline" 2>/dev/null || exit 0
`;
};

const BASE_DIR = getDataDir();
export const STATUSLINE_SCRIPT_PATH = path.join(BASE_DIR, 'statusline.sh');
export const RATE_LIMITS_FILE = path.join(BASE_DIR, 'rate-limits.json');
export const STATUSLINE_SCRIPT_CONTENT = buildStatuslineScriptContent(BASE_DIR);

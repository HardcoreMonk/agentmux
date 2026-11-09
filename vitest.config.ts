import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const vitestTmuxTmpDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'agentmux-vitest-tmux-'),
);
process.env.TMUX_TMPDIR = vitestTmuxTmpDir;

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    env: {
      TMUX_TMPDIR: vitestTmuxTmpDir,
    },
  },
});

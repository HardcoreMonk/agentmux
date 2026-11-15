import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const vitestTmuxTmpDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'agentmux-vitest-tmux-'),
);
process.env.TMUX_TMPDIR = vitestTmuxTmpDir;
// One directory per run; remove it when the run ends so /tmp does not fill up with them.
process.once('exit', () => {
  fs.rmSync(vitestTmuxTmpDir, { recursive: true, force: true });
});

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

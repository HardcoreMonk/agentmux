#!/usr/bin/env node

// CLI entry point inherits the parent shell environment, so Electron's login
// shell resolution does not need to run again.
process.env.AGENTMUX_CLI = '1';
process.env.CODEXMUX_CLI = '1';

if (!process.env.__CMUX_PRISTINE_ENV) {
  process.env.__CMUX_PRISTINE_ENV = JSON.stringify(process.env);
}

const path = require('path');

const CLI_COMMANDS = new Set([
  'workspaces', 'tab', 'memory', 'mem', 'api-guide', 'help',
]);

import('update-notifier')
  .then(({ default: updateNotifier }) => {
    updateNotifier({ pkg: require('../package.json') }).notify();
  })
  .catch(() => {});

const cmd = process.argv[2];

if (cmd && CLI_COMMANDS.has(cmd)) {
  require('./cli.js');
} else if (!cmd || cmd === 'start') {
  process.env.NODE_ENV = process.env.NODE_ENV || 'production';
  process.env.__CMUX_APP_DIR = path.resolve(__dirname, '..');
  require('../dist/server.js');
} else {
  process.stderr.write(`unknown command: ${cmd}\nRun 'agentmux help' for usage.\n`);
  process.exit(1);
}

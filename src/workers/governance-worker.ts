import path from 'node:path';
import { getDataDir } from '@/lib/app-identity';
import { createGovernanceWorkerService } from '@/lib/runtime/governance/worker-service';
import { createRuntimeReply, parseRuntimeMessage } from '@/lib/runtime/ipc';

const dataDirectory = getDataDir();
const indexPath = process.env.CODEXMUX_GOVERNANCE_INDEX || path.join(dataDirectory, 'governance', 'index.db');
const backupRoot = path.join(dataDirectory, 'backups', 'governance-actions');
const service = createGovernanceWorkerService({
  indexPath,
  backupRoot,
  writesEnabled: process.env.CODEXMUX_GOVERNANCE_WRITES === '1',
});
const initialization = service.initialize();

process.on('message', async (raw) => {
  try {
    const message = parseRuntimeMessage(raw);
    if (message.kind !== 'command') return;
    await initialization;
    process.send?.(await service.handleCommand(message));
  } catch (error) {
    const commandId = typeof raw === 'object' && raw && 'id' in raw && typeof raw.id === 'string'
      ? raw.id
      : null;
    if (!commandId) return;
    process.send?.(createRuntimeReply({
      commandId,
      source: 'governance',
      target: 'supervisor',
      type: 'governance.invalid-command.reply',
      ok: false,
      payload: null,
      error: {
        code: 'invalid-worker-command',
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      },
    }));
  }
});

const shutdown = (): void => {
  service.close();
  process.exit(0);
};

process.on('disconnect', shutdown);
process.on('SIGINT', shutdown);

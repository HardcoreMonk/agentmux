import '@/lib/legacy-env-bootstrap';
import { createRuntimeReply, parseRuntimeMessage } from '@/lib/runtime/ipc';
import { createStatusWorkerService } from '@/lib/runtime/status/worker-service';

const service = createStatusWorkerService({
  emitEvent: (event) => {
    process.send?.(event);
  },
});

process.on('message', async (raw) => {
  try {
    const msg = parseRuntimeMessage(raw);
    if (msg.kind !== 'command') return;
    const reply = await service.handleCommand(msg);
    process.send?.(reply);
  } catch (err) {
    const commandId = typeof raw === 'object' && raw && 'id' in raw && typeof raw.id === 'string'
      ? raw.id
      : null;
    if (!commandId) return;
    process.send?.(createRuntimeReply({
      commandId,
      source: 'status',
      target: 'supervisor',
      type: 'status.invalid-command.reply',
      ok: false,
      payload: null,
      error: {
        code: 'invalid-worker-command',
        message: err instanceof Error ? err.message : String(err),
        retryable: false,
      },
    }));
  }
});

process.on('disconnect', () => {
  service.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  service.close();
  process.exit(0);
});

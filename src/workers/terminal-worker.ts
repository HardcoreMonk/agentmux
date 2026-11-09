import '@/lib/legacy-env-bootstrap';
import { createRuntimeReply, parseRuntimeMessage } from '@/lib/runtime/ipc';
import { createTerminalRuntimeAdapter } from '@/lib/runtime/terminal/terminal-runtime-adapter-factory';
import { createTerminalWorkerService } from '@/lib/runtime/terminal/terminal-worker-service';

const service = createTerminalWorkerService({
  runtime: createTerminalRuntimeAdapter(),
  emitEvent: (event) => process.send?.(event),
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
      source: 'terminal',
      target: 'supervisor',
      type: 'terminal.invalid-command.reply',
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

process.on('disconnect', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

import '@/lib/legacy-env-bootstrap';
import { createRuntimeReply, parseRuntimeMessage } from '@/lib/runtime/ipc';
import { createTimelineWorkerService } from '@/lib/runtime/timeline/worker-service';
import {
  createTimelineCatalogService,
  createUnavailableTimelineCatalogService,
} from '@/lib/runtime/timeline/catalog-service';
import { getSessionCatalogMode } from '@/lib/runtime/session-catalog-mode';

const catalogMode = getSessionCatalogMode();
const catalog = catalogMode === 'off'
  ? undefined
  : (() => {
    try {
      return createTimelineCatalogService({ mode: catalogMode });
    } catch {
      return createUnavailableTimelineCatalogService();
    }
  })();

const service = createTimelineWorkerService({
  sendEvent: (event) => {
    process.send?.(event);
  },
  ...(catalog ? { catalog } : {}),
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
      source: 'timeline',
      target: 'supervisor',
      type: 'timeline.invalid-command.reply',
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

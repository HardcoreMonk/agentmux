import { describe, expect, it, vi } from 'vitest';
import type { ILayoutData, IPaneNode } from '@/types/terminal';

const runtimeMocks = vi.hoisted(() => ({
  readRuntimeStorageLayout: vi.fn(),
}));

vi.mock('@/lib/tmux', () => ({
  createSession: vi.fn(),
  hasSession: vi.fn(),
  killSession: vi.fn(),
  resolveExistingDir: vi.fn(async (cwd?: string) => cwd ?? '/home/test'),
  sendKeys: vi.fn(),
  workspaceSessionName: (wsId: string, paneId: string, tabId: string) => `pt-${wsId}-${paneId}-${tabId}`,
}));

vi.mock('@/lib/runtime/supervisor', () => ({
  getRuntimeSupervisor: vi.fn(),
}));

vi.mock('@/lib/sync-server', () => ({
  broadcastSync: vi.fn(),
}));

vi.mock('@/lib/runtime/storage-read-owner', () => ({
  readRuntimeStorageLayout: runtimeMocks.readRuntimeStorageLayout,
}));

import { getLayout } from '@/lib/layout-store';

describe('layout store runtime storage normalization', () => {
  it('turns an unknown panelType read from runtime storage into undefined', async () => {
    const layout: ILayoutData = {
      root: {
        type: 'pane',
        id: 'pane-a',
        tabs: [{
          id: 'tab-a',
          sessionName: 'pt-ws-normalize-pane-a-tab-a',
          name: '',
          order: 0,
          runtimeVersion: 1,
          panelType: 'future-agent' as never,
        }],
        activeTabId: 'tab-a',
      },
      activePaneId: 'pane-a',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    runtimeMocks.readRuntimeStorageLayout.mockReturnValue(layout);

    const result = await getLayout('ws-normalize');

    expect((result.root as IPaneNode).tabs[0].panelType).toBeUndefined();
  });
});

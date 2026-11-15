import { describe, expect, it, vi } from 'vitest';
import { buildAgentReport } from '@/lib/agent-report';
import {
  AGENT_REPORT_MAX_CONSECUTIVE,
  AGENT_REPORT_TTL_MS,
  AgentReportQueue,
} from '@/lib/agent-report-queue';
import {
  AGENT_REPORT_READ_DELAY_MS,
  AgentReportService,
  type IAgentReportDeps,
} from '@/lib/agent-report-service';
import type { TCliState } from '@/types/timeline';
import type { ITab } from '@/types/terminal';

const EMPTY_CLAUDE_COMPOSER = [
  '\u001b[39m❯\u00a0',
  '\u001b[38;2;136;136;136m────────────────────────────────────────',
].join('\n');

const DRAFT_CLAUDE_COMPOSER = [
  '\u001b[39m❯\u00a0typing a draft',
  '\u001b[38;2;136;136;136m────────────────────────────────────────',
].join('\n');

const EMPTY_CODEX_COMPOSER = '\u001b[1m›\u001b[0m \u001b[2mAsk Codex to do anything\u001b[0m';

const makeTab = (id: string, overrides: Partial<ITab> = {}): ITab => ({
  id,
  sessionName: `pt-${id}`,
  name: id,
  order: 0,
  panelType: 'codex',
  runtimeVersion: 1,
  ...overrides,
});

const createHarness = () => {
  let currentNow = 10_000;
  let enabled = true;
  const tabs = new Map<string, { workspaceId: string; tab: ITab }>();
  const cliStates = new Map<string, TCliState>();
  const lastMessages = new Map<string, string | null>();
  const composerScreens = new Map<string, string | null>();

  const parent = makeTab('parent-1', { name: 'planner', panelType: 'claude' });
  const child1 = makeTab('child-1', {
    name: 'worker-1',
    panelType: 'codex',
    createdByTabId: 'parent-1',
  });
  const child2 = makeTab('child-2', {
    name: 'worker-2',
    panelType: 'codex',
    createdByTabId: 'parent-1',
  });

  tabs.set(parent.id, { workspaceId: 'ws-a', tab: parent });
  tabs.set(child1.id, { workspaceId: 'ws-a', tab: child1 });
  tabs.set(child2.id, { workspaceId: 'ws-a', tab: child2 });

  cliStates.set(parent.id, 'idle');
  cliStates.set(child1.id, 'ready-for-review');
  cliStates.set(child2.id, 'ready-for-review');

  lastMessages.set(child1.id, 'Child 1 finished the task.');
  lastMessages.set(child2.id, 'Child 2 finished the task.');

  composerScreens.set(parent.id, EMPTY_CLAUDE_COMPOSER);
  composerScreens.set(child1.id, EMPTY_CODEX_COMPOSER);
  composerScreens.set(child2.id, EMPTY_CODEX_COMPOSER);

  const deps: IAgentReportDeps = {
    isEnabled: vi.fn(async () => enabled),
    findTab: vi.fn(async (tabId: string) => tabs.get(tabId) ?? null),
    readLastMessage: vi.fn(async (tab: ITab) => lastMessages.get(tab.id) ?? null),
    readCliState: vi.fn((tabId: string) => cliStates.get(tabId) ?? null),
    checkTarget: vi.fn(async () => ({ ok: true as const })),
    readComposerScreen: vi.fn(async (tab: ITab) =>
      composerScreens.has(tab.id) ? (composerScreens.get(tab.id) ?? null) : EMPTY_CLAUDE_COMPOSER,
    ),
    writeInput: vi.fn(async () => ({ followUpEnterSkipped: false })),
    notify: vi.fn(),
    now: () => currentNow,
    sleep: vi.fn(async (ms: number) => {
      currentNow += ms;
    }),
  };

  const queue = new AgentReportQueue();
  const service = new AgentReportService(deps, queue);

  return {
    deps,
    queue,
    service,
    tabs,
    cliStates,
    lastMessages,
    composerScreens,
    setNow: (value: number) => {
      currentNow = value;
    },
    advanceNow: (delta: number) => {
      currentNow += delta;
    },
    setEnabled: (value: boolean) => {
      enabled = value;
    },
  };
};

describe('AgentReportService', () => {
  it('delivers a done report to an idle parent with buildAgentReport text', async () => {
    const h = createHarness();

    await h.service.onChildStateChange('child-1', 'ready-for-review', {
      completionKey: 'turn-1',
    });

    expect(h.deps.sleep).toHaveBeenCalledWith(AGENT_REPORT_READ_DELAY_MS);
    expect(h.deps.writeInput).toHaveBeenCalledTimes(1);
    expect(h.deps.writeInput).toHaveBeenCalledWith(
      h.tabs.get('parent-1')!.tab,
      buildAgentReport({
        childTabId: 'child-1',
        childName: 'worker-1',
        provider: 'codex',
        event: 'done',
        lastMessage: 'Child 1 finished the task.',
      }),
    );
  });

  it('silent transition is not reported', async () => {
    const h = createHarness();

    await h.service.onChildStateChange('child-1', 'ready-for-review', {
      silent: true,
      completionKey: 'turn-1',
    });

    expect(h.deps.writeInput).not.toHaveBeenCalled();
    expect(h.queue.parentsWithPending()).toEqual([]);
  });

  it('dedupes the same completionKey so it is written only once', async () => {
    const h = createHarness();

    await h.service.onChildStateChange('child-1', 'ready-for-review', {
      completionKey: 'turn-dup',
    });
    h.service.onPromptSubmit('parent-1');

    await h.service.onChildStateChange('child-1', 'ready-for-review', {
      completionKey: 'turn-dup',
    });

    expect(h.deps.writeInput).toHaveBeenCalledTimes(1);
  });

  it('busy parent receives one combined report once it becomes idle', async () => {
    const h = createHarness();
    h.cliStates.set('parent-1', 'busy');

    await h.service.onChildStateChange('child-1', 'ready-for-review', {
      completionKey: 'c1-t1',
    });
    await h.service.onChildStateChange('child-2', 'ready-for-review', {
      completionKey: 'c2-t1',
    });

    expect(h.deps.writeInput).not.toHaveBeenCalled();

    h.cliStates.set('parent-1', 'idle');
    const result = await h.service.flush('parent-1');

    expect(result).toBe('delivered');
    expect(h.deps.writeInput).toHaveBeenCalledTimes(1);
    const writtenText = vi.mocked(h.deps.writeInput).mock.calls[0][1];
    expect(writtenText).toContain('[agentmux report · worker-1 (codex) · done]');
    expect(writtenText).toContain('[agentmux report · worker-2 (codex) · done]');
  });

  it('draft blocks delivery when composer is non-empty or unreadable', async () => {
    const h = createHarness();
    h.composerScreens.set('parent-1', DRAFT_CLAUDE_COMPOSER);

    await h.service.onChildStateChange('child-1', 'ready-for-review', {
      completionKey: 'c1-t1',
    });

    expect(h.deps.writeInput).not.toHaveBeenCalled();
    expect(await h.service.flush('parent-1')).toBe('waiting');

    h.composerScreens.set('parent-1', null);
    expect(await h.service.flush('parent-1')).toBe('waiting');
    expect(h.deps.writeInput).not.toHaveBeenCalled();

    h.composerScreens.set('parent-1', EMPTY_CLAUDE_COMPOSER);
    expect(await h.service.flush('parent-1')).toBe('delivered');
    expect(h.deps.writeInput).toHaveBeenCalledTimes(1);
  });

  it('waits when checkTarget fails', async () => {
    const h = createHarness();
    vi.mocked(h.deps.checkTarget).mockResolvedValueOnce({
      ok: false,
      code: 'target-needs-input',
      message: 'The target tab shows a permission prompt',
    });

    await h.service.onChildStateChange('child-1', 'ready-for-review', {
      completionKey: 'c1-t1',
    });

    expect(h.deps.writeInput).not.toHaveBeenCalled();
    expect(await h.service.flush('parent-1')).toBe('delivered');
    expect(h.deps.writeInput).toHaveBeenCalledTimes(1);
  });

  it('sends a blocked report on needs-input without reading lastMessage or sleeping', async () => {
    const h = createHarness();

    await h.service.onChildStateChange('child-1', 'needs-input', {});

    expect(h.deps.sleep).not.toHaveBeenCalled();
    expect(h.deps.readLastMessage).not.toHaveBeenCalled();
    expect(h.deps.writeInput).toHaveBeenCalledWith(
      h.tabs.get('parent-1')!.tab,
      buildAgentReport({
        childTabId: 'child-1',
        childName: 'worker-1',
        provider: 'codex',
        event: 'blocked',
        lastMessage: null,
      }),
    );
  });

  it('pauses after 5 consecutive reports, notifies once on the 6th, and resumes after human prompt-submit', async () => {
    const h = createHarness();

    for (let i = 1; i <= AGENT_REPORT_MAX_CONSECUTIVE; i += 1) {
      await h.service.onChildStateChange('child-1', 'ready-for-review', {
        completionKey: `turn-${i}`,
      });
      expect(h.service.onPromptSubmit('parent-1')).toBe('report');
    }

    expect(h.deps.writeInput).toHaveBeenCalledTimes(AGENT_REPORT_MAX_CONSECUTIVE);
    expect(h.deps.notify).not.toHaveBeenCalled();

    await h.service.onChildStateChange('child-1', 'ready-for-review', {
      completionKey: 'turn-6',
    });

    expect(h.deps.writeInput).toHaveBeenCalledTimes(AGENT_REPORT_MAX_CONSECUTIVE);
    expect(h.deps.notify).toHaveBeenCalledTimes(1);
    expect(h.deps.notify).toHaveBeenCalledWith('parent-1', 'paused', 1);

    expect(await h.service.flush('parent-1')).toBe('paused');
    expect(h.deps.notify).toHaveBeenCalledTimes(1);

    expect(h.service.onPromptSubmit('parent-1')).toBe('human');
    expect(await h.service.flush('parent-1')).toBe('delivered');
    expect(h.deps.writeInput).toHaveBeenCalledTimes(AGENT_REPORT_MAX_CONSECUTIVE + 1);
  });

  it('parent closed drops reports and onTabRemoved clears the queue', async () => {
    const h = createHarness();
    h.cliStates.set('parent-1', 'busy');

    await h.service.onChildStateChange('child-1', 'ready-for-review', {
      completionKey: 'c1',
    });
    expect(h.queue.parentsWithPending()).toEqual(['parent-1']);

    h.tabs.delete('parent-1');
    expect(await h.service.flush('parent-1')).toBe('empty');
    expect(h.deps.writeInput).not.toHaveBeenCalled();
    expect(h.queue.parentsWithPending()).toEqual([]);

    h.tabs.set('parent-1', {
      workspaceId: 'ws-a',
      tab: makeTab('parent-1', { panelType: 'claude' }),
    });
    await h.service.onChildStateChange('child-2', 'ready-for-review', {
      completionKey: 'c2',
    });
    expect(h.queue.parentsWithPending()).toEqual(['parent-1']);

    h.service.onTabRemoved('parent-1');
    expect(h.queue.parentsWithPending()).toEqual([]);
  });

  it('runtime v2 tabs are ignored as child or parent', async () => {
    const h = createHarness();
    h.tabs.set('child-1', {
      workspaceId: 'ws-a',
      tab: makeTab('child-1', {
        panelType: 'codex',
        createdByTabId: 'parent-1',
        runtimeVersion: 2,
      }),
    });

    await h.service.onChildStateChange('child-1', 'ready-for-review', {
      completionKey: 'v2-child',
    });
    expect(h.deps.writeInput).not.toHaveBeenCalled();

    h.tabs.set('child-1', {
      workspaceId: 'ws-a',
      tab: makeTab('child-1', {
        panelType: 'codex',
        createdByTabId: 'parent-1',
        runtimeVersion: 1,
      }),
    });
    h.tabs.set('parent-1', {
      workspaceId: 'ws-a',
      tab: makeTab('parent-1', {
        panelType: 'claude',
        runtimeVersion: 2,
      }),
    });

    await h.service.onChildStateChange('child-1', 'ready-for-review', {
      completionKey: 'v2-parent',
    });
    expect(h.deps.writeInput).not.toHaveBeenCalled();
  });

  it('drops queued reports when disabled and does not write them after re-enabling', async () => {
    const h = createHarness();
    h.cliStates.set('parent-1', 'busy');

    await h.service.onChildStateChange('child-1', 'ready-for-review', {
      completionKey: 'c1',
    });
    expect(h.queue.parentsWithPending()).toEqual(['parent-1']);

    h.setEnabled(false);
    h.cliStates.set('parent-1', 'idle');
    expect(await h.service.flush('parent-1')).toBe('disabled');
    expect(h.deps.writeInput).not.toHaveBeenCalled();
    expect(h.queue.parentsWithPending()).toEqual([]);

    h.setEnabled(true);
    expect(await h.service.flush('parent-1')).toBe('empty');
    expect(h.deps.writeInput).not.toHaveBeenCalled();
  });

  it('concurrent flush writes once while writeInput is in flight', async () => {
    const h = createHarness();
    h.cliStates.set('parent-1', 'busy');
    await h.service.onChildStateChange('child-1', 'ready-for-review', {
      completionKey: 'c1',
    });

    h.cliStates.set('parent-1', 'idle');
    let resolveWrite: (res: { followUpEnterSkipped: boolean }) => void = () => undefined;
    vi.mocked(h.deps.writeInput).mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveWrite = resolve;
      }),
    );

    const firstFlush = h.service.flush('parent-1');
    const secondFlush = h.service.flush('parent-1');

    await expect(secondFlush).resolves.toBe('waiting');
    resolveWrite({ followUpEnterSkipped: false });
    await expect(firstFlush).resolves.toBe('delivered');
    expect(h.deps.writeInput).toHaveBeenCalledTimes(1);
  });

  it('next report waits for the turn to start before writing a second batch', async () => {
    const h = createHarness();

    await h.service.onChildStateChange('child-1', 'ready-for-review', {
      completionKey: 'c1',
    });
    expect(h.deps.writeInput).toHaveBeenCalledTimes(1);

    await h.service.onChildStateChange('child-2', 'ready-for-review', {
      completionKey: 'c2',
    });
    expect(h.deps.writeInput).toHaveBeenCalledTimes(1);

    expect(h.service.onPromptSubmit('parent-1')).toBe('report');
    expect(await h.service.flush('parent-1')).toBe('delivered');
    expect(h.deps.writeInput).toHaveBeenCalledTimes(2);
  });

  it('reads lastMessage after the 500ms delay on done transitions', async () => {
    const h = createHarness();
    h.lastMessages.set('child-1', 'Stale message before sleep');
    vi.mocked(h.deps.sleep).mockImplementationOnce(async (ms: number) => {
      h.advanceNow(ms);
      h.lastMessages.set('child-1', 'Fresh final message after 500ms');
    });

    await h.service.onChildStateChange('child-1', 'ready-for-review', {
      completionKey: 'c1-delayed',
    });

    expect(h.deps.sleep).toHaveBeenCalledWith(500);
    const writtenText = vi.mocked(h.deps.writeInput).mock.calls[0][1];
    expect(writtenText).toContain('Fresh final message after 500ms');
  });

  it('tick expires reports older than 30 minutes and notifies', async () => {
    const h = createHarness();
    h.cliStates.set('parent-1', 'busy');

    await h.service.onChildStateChange('child-1', 'ready-for-review', {
      completionKey: 'c1-exp',
    });
    expect(h.queue.parentsWithPending()).toEqual(['parent-1']);

    h.advanceNow(AGENT_REPORT_TTL_MS + 1);
    await h.service.tick();

    expect(h.deps.notify).toHaveBeenCalledWith('parent-1', 'expired', 1);
    expect(h.queue.parentsWithPending()).toEqual([]);
  });

  it('classifies prompt-submit arriving inside writeInput as report and pauses on the 6th delivery', async () => {
    const h = createHarness();
    const submitResults: Array<'report' | 'human'> = [];
    vi.mocked(h.deps.writeInput).mockImplementation(async () => {
      submitResults.push(h.service.onPromptSubmit('parent-1'));
      return { followUpEnterSkipped: false };
    });

    for (let i = 1; i <= AGENT_REPORT_MAX_CONSECUTIVE; i += 1) {
      await h.service.onChildStateChange('child-1', 'ready-for-review', {
        completionKey: `in-write-${i}`,
      });
    }

    expect(submitResults).toEqual(['report', 'report', 'report', 'report', 'report']);
    expect(h.deps.writeInput).toHaveBeenCalledTimes(AGENT_REPORT_MAX_CONSECUTIVE);

    await h.service.onChildStateChange('child-1', 'ready-for-review', {
      completionKey: 'in-write-6',
    });

    expect(await h.service.flush('parent-1')).toBe('paused');
    expect(h.deps.writeInput).toHaveBeenCalledTimes(AGENT_REPORT_MAX_CONSECUTIVE);
    expect(h.deps.notify).toHaveBeenCalledWith('parent-1', 'paused', 1);
  });

  it('does not burn completionKey when a dependency throws before enqueue', async () => {
    const h = createHarness();
    vi.mocked(h.deps.findTab).mockRejectedValueOnce(new Error('transient disk error'));

    await h.service.onChildStateChange('child-1', 'ready-for-review', {
      completionKey: 'retry-key',
    });
    expect(h.deps.writeInput).not.toHaveBeenCalled();

    await h.service.onChildStateChange('child-1', 'ready-for-review', {
      completionKey: 'retry-key',
    });
    expect(h.deps.writeInput).toHaveBeenCalledTimes(1);
  });

  it('returns empty without calling findTab or reading the config when flushing a tab with nothing pending', async () => {
    const h = createHarness();

    const result = await h.service.flush('parent-1');

    expect(result).toBe('empty');
    expect(h.deps.findTab).not.toHaveBeenCalled();
    expect(h.deps.isEnabled).not.toHaveBeenCalled();
  });

  it('does not read the config on tick when nothing is pending', async () => {
    const h = createHarness();

    await h.service.tick();

    expect(h.deps.isEnabled).not.toHaveBeenCalled();
  });
});

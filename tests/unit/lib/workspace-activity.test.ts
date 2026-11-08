import { describe, expect, it } from 'vitest';
import { getWorkspaceActivityStatus } from '@/lib/workspace-activity';
import type { TTabDisplayStatus } from '@/types/status';

const agentTabs = (...statuses: TTabDisplayStatus[]) =>
  statuses.map((status) => ({ panelType: 'codex' as const, status }));

describe('getWorkspaceActivityStatus', () => {
  it('waits for a fresh full sync even when cached tabs look idle or busy', () => {
    expect(getWorkspaceActivityStatus([], false)).toBe('checking');
    expect(getWorkspaceActivityStatus(agentTabs('idle'), false)).toBe('checking');
    expect(getWorkspaceActivityStatus(agentTabs('busy'), false)).toBe('checking');
  });

  it('reports no active tasks for empty and idle workspaces after sync', () => {
    expect(getWorkspaceActivityStatus([], true)).toBe('idle');
    expect(getWorkspaceActivityStatus(agentTabs('idle', 'idle'), true)).toBe('idle');
  });

  it.each<TTabDisplayStatus>(['busy', 'needs-input', 'ready-for-review', 'unknown'])(
    'preserves the %s state of an agent tab',
    (status) => expect(getWorkspaceActivityStatus(agentTabs('idle', status), true)).toBe(status),
  );

  it('prioritizes input, work, review and unknown in either tab order', () => {
    const priorities: TTabDisplayStatus[] = ['needs-input', 'busy', 'ready-for-review', 'unknown', 'idle'];
    for (let i = 0; i < priorities.length; i++) {
      const statuses = priorities.slice(i);
      expect(getWorkspaceActivityStatus(agentTabs(...statuses), true)).toBe(priorities[i]);
      expect(getWorkspaceActivityStatus(agentTabs(...statuses.reverse()), true)).toBe(priorities[i]);
    }
  });

  it('excludes terminal, browser and diff panels from agent work', () => {
    expect(getWorkspaceActivityStatus([
      { panelType: 'terminal', status: 'busy' },
      { panelType: 'web-browser', status: 'needs-input' },
      { panelType: 'diff', status: 'ready-for-review' },
      { status: 'unknown' },
      ...agentTabs('idle'),
    ], true)).toBe('idle');
  });
});

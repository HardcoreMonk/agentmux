import { describe, expect, it } from 'vitest';

import { buildStatusWebPushPayload } from '@/lib/status/web-push-payload';
import type { ITabStatusEntry } from '@/types/status';

const makeEntry = (overrides: Partial<ITabStatusEntry> = {}): ITabStatusEntry => ({
  cliState: 'idle',
  workspaceId: 'ws-1',
  tabName: 'Codex tab',
  tmuxSession: 'codexmux:tab',
  agentSessionId: 'session-a',
  ...overrides,
});

describe('status Web Push payload builder', () => {
  it('builds task-complete review payload with fallback body and silent flag', () => {
    const payload = buildStatusWebPushPayload({
      tabId: 'tab-a',
      entry: makeEntry({
        lastUserMessage: 'x'.repeat(120),
      }),
      pushType: 'review',
      workspaceName: 'Workspace A',
      workspaceDir: '/workspace/a',
      soundOnCompleteEnabled: false,
    });

    expect(payload).toEqual({
      title: 'Task Complete',
      body: 'x'.repeat(100),
      silent: true,
      tabId: 'tab-a',
      workspaceId: 'ws-1',
      agentSessionId: 'session-a',
      workspaceName: 'Workspace A',
      workspaceDir: '/workspace/a',
    });
  });

  it('builds needs-input payload with approval metadata detail', () => {
    const payload = buildStatusWebPushPayload({
      tabId: 'tab-a',
      entry: makeEntry({
        lastUserMessage: 'run command',
        approvalPromptMetadata: {
          promptType: 'command',
          approvalKind: 'allow',
          riskLevel: 'high',
          commandPreview: 'rm -rf build',
          fileHints: [],
          fallbackReason: null,
        },
      }),
      pushType: 'needs-input',
      workspaceName: 'Workspace A',
      workspaceDir: null,
      soundOnCompleteEnabled: true,
    });

    expect(payload).toEqual({
      title: 'Input Required',
      body: '명령 승인 · 높음 · rm -rf build',
      silent: false,
      tabId: 'tab-a',
      workspaceId: 'ws-1',
      agentSessionId: 'session-a',
      workspaceName: 'Workspace A',
      workspaceDir: null,
      approvalKind: 'allow',
      promptType: 'command',
      riskLevel: 'high',
      approvalDetail: 'rm -rf build',
    });
  });

  it('falls back to tab name then tab id when last user message is absent', () => {
    expect(buildStatusWebPushPayload({
      tabId: 'tab-a',
      entry: makeEntry({
        lastUserMessage: null,
        tabName: 'Named tab',
      }),
      pushType: 'review',
      workspaceName: '',
      workspaceDir: null,
      soundOnCompleteEnabled: true,
    }).body).toBe('Named tab');

    expect(buildStatusWebPushPayload({
      tabId: 'tab-a',
      entry: makeEntry({
        lastUserMessage: null,
        tabName: '',
      }),
      pushType: 'review',
      workspaceName: '',
      workspaceDir: null,
      soundOnCompleteEnabled: true,
    }).body).toBe('tab-a');
  });

  it('builds agent-report-paused and agent-report-expired payloads', () => {
    const paused = buildStatusWebPushPayload({
      tabId: 'tab-parent',
      pushType: 'agent-report-paused',
      workspaceName: 'agentmux',
      workspaceDir: '/work/agentmux',
      entry: makeEntry({
        tabName: 'Parent',
        panelType: 'claude',
        agentReportNotice: { kind: 'paused', count: 3, at: 1000 },
      }),
    });
    expect(paused.title).toBe('Agent Reports Paused');
    expect(paused.body).toBe('3 report(s) waiting · Parent');
    expect(paused.silent).toBe(false);

    const expired = buildStatusWebPushPayload({
      tabId: 'tab-parent',
      pushType: 'agent-report-expired',
      workspaceName: 'agentmux',
      workspaceDir: '/work/agentmux',
      entry: makeEntry({
        tabName: 'Parent',
        panelType: 'claude',
        agentReportNotice: { kind: 'expired', count: 2, at: 2000 },
      }),
    });
    expect(expired.title).toBe('Agent Reports Dropped');
    expect(expired.body).toBe('2 report(s) not delivered in 30 min · Parent');
    expect(expired.silent).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import {
  buildStatusRemoveMessage,
  buildStatusUpdateMessage,
  toStatusClientTabEntry,
} from '@/lib/status/client-payload';
import type { ITabStatusEntry } from '@/types/status';

const entry: ITabStatusEntry = {
  cliState: 'needs-input',
  workspaceId: 'ws-1',
  tabName: 'Codex tab',
  currentProcess: 'codex',
  paneTitle: 'codex|/workspace/a',
  tmuxSession: 'codexmux:tab',
  panelType: 'codex',
  terminalStatus: 'idle',
  listeningPorts: [3000],
  agentSummary: 'summary',
  lastUserMessage: 'prompt',
  lastAssistantMessage: 'assistant',
  currentAction: { toolName: 'Bash', summary: 'running tests' },
  readyForReviewAt: 1,
  busySince: 2,
  dismissedAt: 3,
  agentSessionId: 'session-a',
  compactingSince: 4,
  processRetries: 5,
  jsonlPath: '/tmp/session.jsonl',
  lastEvent: { name: 'notification', at: 6, seq: 7 },
  eventSeq: 7,
  approvalPromptMetadata: {
    promptType: 'command',
    approvalKind: 'allow',
    riskLevel: 'medium',
    commandPreview: 'corepack pnpm test',
    fileHints: [],
    fallbackReason: null,
  },
  agentReportNotice: {
    kind: 'paused',
    count: 2,
    at: 1700000000000,
  },
};

describe('status client payload helpers', () => {
  it('projects client sync entries without private server fields', () => {
    expect(toStatusClientTabEntry(entry)).toEqual({
      cliState: 'needs-input',
      workspaceId: 'ws-1',
      tabName: 'Codex tab',
      currentProcess: 'codex',
      paneTitle: 'codex|/workspace/a',
      panelType: 'codex',
      terminalStatus: 'idle',
      listeningPorts: [3000],
      agentSummary: 'summary',
      lastUserMessage: 'prompt',
      lastAssistantMessage: 'assistant',
      currentAction: { toolName: 'Bash', summary: 'running tests' },
      readyForReviewAt: 1,
      busySince: 2,
      dismissedAt: 3,
      agentSessionId: 'session-a',
      lastEvent: { name: 'notification', at: 6, seq: 7 },
      eventSeq: 7,
      approvalPromptMetadata: entry.approvalPromptMetadata,
      agentReportNotice: entry.agentReportNotice,
    });
  });

  it('builds status update messages with compacting state', () => {
    expect(buildStatusUpdateMessage('tab-a', entry)).toEqual({
      type: 'status:update',
      tabId: 'tab-a',
      cliState: 'needs-input',
      workspaceId: 'ws-1',
      tabName: 'Codex tab',
      currentProcess: 'codex',
      paneTitle: 'codex|/workspace/a',
      panelType: 'codex',
      terminalStatus: 'idle',
      listeningPorts: [3000],
      agentSummary: 'summary',
      lastUserMessage: 'prompt',
      lastAssistantMessage: 'assistant',
      currentAction: { toolName: 'Bash', summary: 'running tests' },
      readyForReviewAt: 1,
      busySince: 2,
      dismissedAt: 3,
      agentSessionId: 'session-a',
      compactingSince: 4,
      lastEvent: { name: 'notification', at: 6, seq: 7 },
      eventSeq: 7,
      approvalPromptMetadata: entry.approvalPromptMetadata,
      agentReportNotice: entry.agentReportNotice,
    });
  });

  it('builds status remove messages', () => {
    expect(buildStatusRemoveMessage('tab-a')).toEqual({
      type: 'status:update',
      tabId: 'tab-a',
      cliState: null,
      workspaceId: '',
      tabName: '',
    });
  });
});

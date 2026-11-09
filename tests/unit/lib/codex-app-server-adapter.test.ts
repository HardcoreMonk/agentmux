import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

import { listProviders } from '@/lib/providers';
import {
  APP_SERVER_PROVIDER_ID,
  buildCodexAppServerCapability,
  parseCodexAppServerFixture,
  resolveCodexAppServerMode,
} from '@/lib/providers/codex-app-server';

const readFixture = (): Promise<string> =>
  fs.readFile(path.join(process.cwd(), 'tests/fixtures/providers/codex-app-server/session-events.json'), 'utf-8');

describe('Codex app-server fixture adapter', () => {
  it('stays disabled by default and exposes no execution capabilities', () => {
    expect(resolveCodexAppServerMode({})).toBe('disabled');
    expect(buildCodexAppServerCapability({})).toEqual({
      providerId: APP_SERVER_PROVIDER_ID,
      mode: 'disabled',
      enabled: false,
      status: 'disabled',
      capabilities: {
        healthProbe: false,
        readOnlySessions: false,
        timelineEvents: false,
        statusHints: false,
        launch: false,
        resume: false,
        approvalActions: false,
      },
    });
  });

  it('enables only read-only fixture capabilities behind the experimental env gate', () => {
    expect(resolveCodexAppServerMode({ AGENTMUX_CODEX_APP_SERVER: 'experimental' })).toBe('experimental');
    expect(buildCodexAppServerCapability({ AGENTMUX_CODEX_APP_SERVER: 'experimental' })).toEqual({
      providerId: APP_SERVER_PROVIDER_ID,
      mode: 'experimental',
      enabled: true,
      status: 'fixture-only',
      capabilities: {
        healthProbe: true,
        readOnlySessions: true,
        timelineEvents: true,
        statusHints: true,
        launch: false,
        resume: false,
        approvalActions: false,
      },
    });
  });

  it('does not register the app-server adapter as a production provider yet', () => {
    expect(listProviders().map((provider) => provider.id)).toEqual(['codex']);
  });

  it('normalizes fixture sessions, timeline entries, and status hints without raw payload leakage', async () => {
    const fixture = await readFixture();
    const result = parseCodexAppServerFixture(fixture);

    expect(result.sessions).toEqual([
      {
        providerId: APP_SERVER_PROVIDER_ID,
        sessionId: 'app-session-1',
        sourceSessionId: 'app-source-1',
        summary: 'Investigate app-server adapter',
        updatedAt: '2026-05-07T01:00:00.000Z',
        relationship: {
          providerId: APP_SERVER_PROVIDER_ID,
          sourceSessionId: 'app-source-1',
          parentSessionId: 'parent-session',
          rootSessionId: 'root-session',
          relationshipType: 'sub-agent',
          relationshipConfidence: 'high',
        },
      },
    ]);
    expect(result.timelineEntries.map((entry) => entry.type)).toEqual(['user-message', 'assistant-message']);
    expect(result.timelineEntries[0]).toMatchObject({
      type: 'user-message',
      text: 'Check adapter state',
    });
    expect(result.timelineEntries[1]).toMatchObject({
      type: 'assistant-message',
      markdown: 'Adapter is fixture-only',
    });
    expect(result.statusHints).toEqual([
      {
        providerId: APP_SERVER_PROVIDER_ID,
        sessionId: 'app-session-1',
        cliState: 'needs-input',
        currentAction: 'Waiting for operator approval',
        requiresApproval: true,
        updatedAt: '2026-05-07T01:00:03.000Z',
      },
    ]);

    const output = JSON.stringify(result);
    expect(output).not.toContain('/private/project');
    expect(output).not.toContain('rm -rf');
    expect(output).not.toContain('secret-token');
    expect(output).not.toContain('raw prompt');
  });
});
